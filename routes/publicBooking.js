const express = require('express');
const db = require('../db');
const { GST_RATE } = require('../billing');
const { HttpError } = require('../errors');
const { normalizePhone } = require('../loyalty');
const { toClock, toDisplayTime } = require('../salonHours');
const { getStoreSettings, hoursForDate, publicStorePayload } = require('../storeSettings');
const { inTransaction } = require('../transaction');
const { date, number, text, time } = require('../validation');
const { INACTIVE_STATUSES, findAppointment, scheduleBooking } = require('./appointments');

const router = express.Router();

const SLOT_STEP = 30;
const LEAD_MINUTES = Number(process.env.ONLINE_BOOKING_LEAD_MINUTES) || 60;
const DAYS_AHEAD = Number(process.env.ONLINE_BOOKING_DAYS_AHEAD) || 30;
const MAX_OPEN_PER_PHONE = 3;
const MAX_SERVICES = 4;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;

const bookingAttempts = new Map();

/** Stops one visitor from flooding the timetable: a handful of booking attempts per IP every 10 minutes. */
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

const SALON_TZ = process.env.SALON_TIMEZONE || 'Asia/Kolkata';

/** Current salon calendar day + clock minutes in India time (not the server's UTC clock). */
function salonNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const today = `${get('year')}-${get('month')}-${get('day')}`;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return { today, minutes };
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
async function dayHours(day) {
  const settings = await getStoreSettings();
  return hoursForDate(settings, day);
}

async function firstSlot(day) {
  const { today, minutes } = salonNow();
  const { opensAt } = await dayHours(day);
  const earliest = day === today ? Math.max(opensAt, minutes + LEAD_MINUTES) : opensAt;
  return opensAt + Math.ceil((earliest - opensAt) / SLOT_STEP) * SLOT_STEP;
}

function parseServiceIds(value) {
  const list = (Array.isArray(value) ? value : String(value ?? '').split(',')).filter(
    (item) => item !== '' && item != null,
  );
  if (list.length === 0) {
    throw new HttpError(400, 'Choose at least one service.');
  }
  if (list.length > MAX_SERVICES) {
    throw new HttpError(400, `You can book up to ${MAX_SERVICES} services in one visit.`);
  }
  const ids = list.map((item) => number(item, 'Service', { required: true, integer: true, min: 1 }));
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, 'Each service can only be added once.');
  }
  return ids;
}

/** Active services in the order the client picked them, plus the visit's total length. */
async function findServices(ids) {
  const [rows] = await db.query(
    'SELECT id, name, duration_minutes AS duration FROM services WHERE id IN (?) AND is_active = 1',
    [ids],
  );
  if (rows.length !== ids.length) {
    throw new HttpError(400, 'One of the chosen services is not available for online booking.');
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const services = ids.map((id) => byId.get(id));
  return { services, duration: services.reduce((sum, s) => sum + s.duration, 0) };
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
  const settings = await getStoreSettings();
  const store = publicStorePayload(settings, { today });
  res.json({
    ...store,
    today,
    lastDay: lastBookableDay(today),
    maxServices: MAX_SERVICES,
    gstRate: GST_RATE,
    services: services.map((s) => ({ ...s, price: Number(s.price) })),
    specialists,
  });
});

router.get('/availability', async (req, res) => {
  const day = date(req.query.date, 'Date', { required: true });
  const serviceIds = parseServiceIds(req.query.serviceIds ?? req.query.serviceId);
  assertBookableDay(day);
  const { duration } = await findServices(serviceIds);

  const [specialists] = await db.query('SELECT id FROM employees WHERE is_active = 1');
  const [booked] = await db.query(
    `SELECT employee_id AS employeeId, HOUR(start_time) * 60 + MINUTE(start_time) AS start,
            HOUR(end_time) * 60 + MINUTE(end_time) AS end
     FROM appointments WHERE appointment_date = ? AND status NOT IN (?)`,
    [day, INACTIVE_STATUSES],
  );

  const { opensAt, closesAt } = await dayHours(day);
  const earliestSlot = await firstSlot(day);
  const slots = [];
  for (let start = earliestSlot; start + duration <= closesAt; start += SLOT_STEP) {
    const end = start + duration;
    const free = specialists
      .filter((s) => !booked.some((b) => b.employeeId === s.id && b.start < end && b.end > start))
      .map((s) => s.id);
    if (free.length > 0) slots.push({ time: toClock(start), specialistIds: free });
  }
  res.json({
    date: day,
    duration,
    opensAt: toClock(opensAt),
    closesAt: toClock(closesAt),
    slots,
  });
});

router.post('/bookings', limitBookings, async (req, res) => {
  const body = req.body ?? {};
  const day = date(body.date, 'Date', { required: true });
  const start = time(body.startTime, 'Time', { required: true });
  const serviceIds = parseServiceIds(body.serviceIds ?? body.serviceId);
  const specialistId = number(body.specialistId, 'Specialist', { integer: true, min: 1 });
  const clientName = text(body.name, 'Your name', { required: true, max: 100 });
  let clientPhone;
  try {
    clientPhone = normalizePhone(body.phone, { required: true });
  } catch {
    throw new HttpError(400, 'Enter a valid 10-digit mobile number.');
  }
  const notes = text(body.notes, 'Notes', { max: 500 });

  assertBookableDay(day);
  const { opensAt, closesAt } = await dayHours(day);
  const earliestSlot = await firstSlot(day);
  if (start < earliestSlot || (start - opensAt) % SLOT_STEP !== 0) {
    throw new HttpError(400, 'That time is no longer available. Please choose another slot.');
  }
  const { services, duration } = await findServices(serviceIds);
  if (start + duration > closesAt) {
    throw new HttpError(
      400,
      `Your treatments take ${duration} min in total, so the visit must start by ${toDisplayTime(closesAt - duration)}.`,
    );
  }

  const id = await inTransaction(async (conn) => {
    const [[{ open }]] = await conn.query(
      `SELECT COUNT(DISTINCT COALESCE(online_ref, id)) AS open FROM appointments
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

    /** Books every service back-to-back with one specialist, or nothing if any part clashes. */
    for (const employeeId of candidates) {
      await conn.query('SAVEPOINT candidate');
      try {
        let at = start;
        let firstId = null;
        for (const service of services) {
          const row = await scheduleBooking(conn, {
            date: day,
            start: at,
            employeeId,
            serviceId: service.id,
            clientName,
            clientPhone,
            notes,
          });
          const [result] = await conn.query('INSERT INTO appointments SET ?', [
            { ...row, status: 'pending', source: 'online', online_ref: firstId },
          ]);
          if (!firstId) {
            firstId = result.insertId;
            await conn.query('UPDATE appointments SET online_ref = id WHERE id = ?', [firstId]);
          }
          at += service.duration;
        }
        return firstId;
      } catch (err) {
        if (err.status !== 409) throw err;
        await conn.query('ROLLBACK TO SAVEPOINT candidate');
      }
    }
    throw new HttpError(409, 'Sorry, that time was just taken. Please choose another slot.');
  });

  const [rows] = await db.query(
    `SELECT a.id FROM appointments a WHERE a.online_ref = ? ORDER BY a.start_time`,
    [id],
  );
  const parts = await Promise.all(rows.map((row) => findAppointment(row.id)));
  const first = parts[0];
  res.status(201).json({
    booking: {
      reference: `PS-${String(id).padStart(5, '0')}`,
      date: first.date,
      startTime: first.startTime,
      endTime: parts[parts.length - 1].endTime,
      services: parts.map((p) => ({
        name: p.serviceName,
        price: p.servicePrice,
        startTime: p.startTime,
        endTime: p.endTime,
      })),
      total: parts.reduce((sum, p) => sum + p.servicePrice, 0),
      gstRate: GST_RATE,
      specialistName: first.employeeName,
      clientName: first.clientName,
      clientPhone: first.clientPhone,
    },
  });
});

module.exports = router;
