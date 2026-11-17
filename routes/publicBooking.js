const express = require('express');
const db = require('../db');
const { HttpError } = require('../errors');
const { normalizePhone } = require('../loyalty');
const { closesAt, opensAt, toClock } = require('../salonHours');
const { inTransaction } = require('../transaction');
const { date, number, text, time } = require('../validation');
const { INACTIVE_STATUSES, findAppointment, scheduleBooking } = require('./appointments');

const router = express.Router();

const SLOT_STEP = 30;
const LEAD_MINUTES = Number(process.env.ONLINE_BOOKING_LEAD_MINUTES) || 60;
const DAYS_AHEAD = Number(process.env.ONLINE_BOOKING_DAYS_AHEAD) || 30;
const MAX_OPEN_PER_PHONE = 3;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

const bookingAttempts = new Map();

/** Stops one visitor from flooding the timetable: a few booking attempts per IP every 10 minutes. */
function limitBookings(req, res, next) {
  const now = Date.now();
  const recent = (bookingAttempts.get(req.ip) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    return next(new HttpError(429, 'Too many booking attempts. Please try again in a few minutes.'));
  }
  recent.push(now);
  bookingAttempts.set(req.ip, recent);
  if (bookingAttempts.size > 5000) {
    for (const [ip, times] of bookingAttempts) {
      if (times.every((at) => now - at >= RATE_WINDOW_MS)) bookingAttempts.delete(ip);
    }
  }
  next();
}

function salonNow() {
  const now = new Date();
  return { today: now.toLocaleDateString('en-CA'), minutes: now.getHours() * 60 + now.getMinutes() };
}

function lastBookableDay(today) {
  const day = new Date(`${today}T00:00:00`);
  day.setDate(day.getDate() + DAYS_AHEAD);
  return day.toLocaleDateString('en-CA');
}

function assertBookableDay(day) {
  const { today } = salonNow();
  if (day < today) {
    throw new HttpError(400, 'Choose today or a later date.');
  }
  if (day > lastBookableDay(today)) {
    throw new HttpError(400, `Online bookings are open up to ${DAYS_AHEAD} days ahead.`);
  }
}

/** First slot that can still be booked online, on the half-hour grid from opening time. */
function firstSlot(day) {
  const { today, minutes } = salonNow();
  const earliest = day === today ? Math.max(opensAt, minutes + LEAD_MINUTES) : opensAt;
  return opensAt + Math.ceil((earliest - opensAt) / SLOT_STEP) * SLOT_STEP;
}

async function findService(serviceId) {
  const [[service]] = await db.query(
    'SELECT id, name, duration_minutes AS duration FROM services WHERE id = ? AND is_active = 1',
    [serviceId],
  );
  if (!service) {
    throw new HttpError(400, 'This service is not available for online booking.');
  }
  return service;
}

router.get('/options', async (req, res) => {
  const [services] = await db.query(
    `SELECT id, name, category, description, duration_minutes AS duration, price
     FROM services WHERE is_active = 1 ORDER BY category, name`,
  );
  const [specialists] = await db.query(
    'SELECT id, name, designation FROM employees WHERE is_active = 1 ORDER BY name',
  );
  const { today } = salonNow();
  res.json({
    opensAt: toClock(opensAt),
    closesAt: toClock(closesAt),
    today,
    lastDay: lastBookableDay(today),
    services: services.map((s) => ({ ...s, price: Number(s.price) })),
    specialists,
  });
});

router.get('/availability', async (req, res) => {
  const day = date(req.query.date, 'Date', { required: true });
  const serviceId = number(req.query.serviceId, 'Service', { required: true, integer: true, min: 1 });
  assertBookableDay(day);
  const service = await findService(serviceId);

  const [specialists] = await db.query('SELECT id FROM employees WHERE is_active = 1');
  const [booked] = await db.query(
    `SELECT employee_id AS employeeId, HOUR(start_time) * 60 + MINUTE(start_time) AS start,
            HOUR(end_time) * 60 + MINUTE(end_time) AS end
     FROM appointments WHERE appointment_date = ? AND status NOT IN (?)`,
    [day, INACTIVE_STATUSES],
  );

  const slots = [];
  for (let start = firstSlot(day); start + service.duration <= closesAt; start += SLOT_STEP) {
    const end = start + service.duration;
    const free = specialists
      .filter((s) => !booked.some((b) => b.employeeId === s.id && b.start < end && b.end > start))
      .map((s) => s.id);
    if (free.length > 0) slots.push({ time: toClock(start), specialistIds: free });
  }
  res.json({ date: day, duration: service.duration, slots });
});

router.post('/bookings', limitBookings, async (req, res) => {
  const body = req.body ?? {};
  const day = date(body.date, 'Date', { required: true });
  const start = time(body.startTime, 'Time', { required: true });
  const serviceId = number(body.serviceId, 'Service', { required: true, integer: true, min: 1 });
  const specialistId = number(body.specialistId, 'Specialist', { integer: true, min: 1 });
  const clientName = text(body.name, 'Your name', { required: true, max: 100 });
  const clientPhone = normalizePhone(body.phone, { required: true });
  const notes = text(body.notes, 'Notes', { max: 500 });

  assertBookableDay(day);
  if (start < firstSlot(day) || (start - opensAt) % SLOT_STEP !== 0) {
    throw new HttpError(400, 'That time is no longer available. Please choose another slot.');
  }

  const id = await inTransaction(async (conn) => {
    const [[{ open }]] = await conn.query(
      `SELECT COUNT(*) AS open FROM appointments
       WHERE source = 'online' AND client_phone = ? AND appointment_date >= CURDATE()
         AND status IN ('pending', 'confirmed')`,
      [clientPhone],
    );
    if (open >= MAX_OPEN_PER_PHONE) {
      throw new HttpError(
        409,
        `You already have ${MAX_OPEN_PER_PHONE} upcoming online bookings. Please call the salon to book more.`,
      );
    }

    let candidates = [specialistId];
    if (!specialistId) {
      const [rows] = await conn.query(
        `SELECT e.id FROM employees e
         LEFT JOIN appointments a
           ON a.employee_id = e.id AND a.appointment_date = ? AND a.status NOT IN (?)
         WHERE e.is_active = 1
         GROUP BY e.id
         ORDER BY COUNT(a.id), e.name`,
        [day, INACTIVE_STATUSES],
      );
      candidates = rows.map((row) => row.id);
    }

    for (const employeeId of candidates) {
      let row;
      try {
        row = await scheduleBooking(conn, { date: day, start, employeeId, serviceId, clientName, clientPhone, notes });
      } catch (err) {
        if (err.status === 409) continue;
        throw err;
      }
      const [result] = await conn.query('INSERT INTO appointments SET ?', [
        { ...row, status: 'pending', source: 'online' },
      ]);
      return result.insertId;
    }
    throw new HttpError(409, 'Sorry, that time was just taken. Please choose another slot.');
  });

  const appointment = await findAppointment(id);
  res.status(201).json({
    booking: {
      reference: `PS-${String(id).padStart(5, '0')}`,
      date: appointment.date,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      serviceName: appointment.serviceName,
      servicePrice: appointment.servicePrice,
      specialistName: appointment.employeeName,
      clientName: appointment.clientName,
      clientPhone: appointment.clientPhone,
    },
  });
});

module.exports = router;
