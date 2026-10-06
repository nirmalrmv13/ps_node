const express = require('express');
const db = require('../db');
const { HttpError } = require('../errors');
const { closesAt, opensAt, toClock, toDisplayTime } = require('../salonHours');
const { inTransaction } = require('../transaction');
const { date, number, text, time } = require('../validation');

const router = express.Router();

const MANUAL_STATUSES = ['pending', 'confirmed', 'checked_in', 'in_service', 'cancelled', 'no_show'];
const INACTIVE_STATUSES = ['cancelled', 'no_show'];

const selectAppointments = `
  SELECT a.id, DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS date,
         TIME_FORMAT(a.start_time, '%H:%i') AS startTime, TIME_FORMAT(a.end_time, '%H:%i') AS endTime,
         a.employee_id AS employeeId, e.name AS employeeName, e.designation AS employeeDesignation,
         a.service_id AS serviceId, s.name AS serviceName, s.category AS serviceCategory,
         s.price AS servicePrice, a.client_name AS clientName, a.client_phone AS clientPhone,
         a.status, a.notes, a.invoice_id AS invoiceId, i.invoice_number AS invoiceNumber
  FROM appointments a
  JOIN employees e ON e.id = a.employee_id
  JOIN services s ON s.id = a.service_id
  LEFT JOIN invoices i ON i.id = a.invoice_id`;

function formatAppointment(row) {
  return { ...row, servicePrice: Number(row.servicePrice) };
}

async function findAppointment(id) {
  const [rows] = await db.query(`${selectAppointments} WHERE a.id = ?`, [id]);
  return rows[0] ? formatAppointment(rows[0]) : null;
}

function parseBooking(body = {}) {
  const phone = text(body.clientPhone, 'Mobile number', { max: 20 })?.replace(/[\s-]/g, '') ?? null;
  if (phone && !/^\+?[0-9]{10,15}$/.test(phone)) {
    throw new HttpError(400, 'Mobile number must have 10 to 15 digits.');
  }

  return {
    date: date(body.date, 'Date', { required: true }),
    start: time(body.startTime, 'Start time', { required: true }),
    employeeId: number(body.employeeId, 'Specialist', { required: true, integer: true, min: 1 }),
    serviceId: number(body.serviceId, 'Service', { required: true, integer: true, min: 1 }),
    clientName: text(body.clientName, 'Client name', { required: true, max: 100 }),
    clientPhone: phone,
    notes: text(body.notes, 'Notes', { max: 1000 }),
  };
}

/** Locks the specialist's row so two bookings for the same person can't race each other. */
async function lockEmployee(conn, employeeId) {
  const [[employee]] = await conn.query(
    'SELECT id, name, is_active FROM employees WHERE id = ? FOR UPDATE',
    [employeeId],
  );
  if (!employee || !employee.is_active) {
    throw new HttpError(400, 'Choose an active specialist.');
  }
  return employee;
}

async function assertSlotFree(conn, employee, day, start, end, excludeId) {
  const [clashes] = await conn.query(
    `SELECT client_name AS clientName, HOUR(start_time) * 60 + MINUTE(start_time) AS start,
            HOUR(end_time) * 60 + MINUTE(end_time) AS end
     FROM appointments
     WHERE employee_id = ? AND appointment_date = ? AND status NOT IN (?)
       AND start_time < ? AND end_time > ? AND id <> ?
     LIMIT 1`,
    [employee.id, day, INACTIVE_STATUSES, toClock(end), toClock(start), excludeId ?? 0],
  );
  const clash = clashes[0];
  if (clash) {
    throw new HttpError(
      409,
      `${employee.name} is already booked from ${toDisplayTime(clash.start)} to ${toDisplayTime(clash.end)} (${clash.clientName}).`,
    );
  }
}

async function scheduleBooking(conn, booking, { checkClash = true, excludeId } = {}) {
  const employee = await lockEmployee(conn, booking.employeeId);
  const [[service]] = await conn.query(
    'SELECT id, name, duration_minutes AS duration, is_active FROM services WHERE id = ?',
    [booking.serviceId],
  );
  if (!service || !service.is_active) {
    throw new HttpError(400, 'Choose an active service.');
  }

  const end = booking.start + service.duration;
  if (booking.start < opensAt || end > closesAt) {
    throw new HttpError(
      400,
      `${service.name} takes ${service.duration} min, so it must start between ${toDisplayTime(opensAt)} and ${toDisplayTime(Math.max(opensAt, closesAt - service.duration))}.`,
    );
  }
  if (checkClash) {
    await assertSlotFree(conn, employee, booking.date, booking.start, end, excludeId);
  }

  return {
    appointment_date: booking.date,
    start_time: toClock(booking.start),
    end_time: toClock(end),
    employee_id: booking.employeeId,
    service_id: booking.serviceId,
    client_name: booking.clientName,
    client_phone: booking.clientPhone,
    notes: booking.notes,
  };
}

async function lockAppointment(conn, id) {
  const [[appointment]] = await conn.query(
    `SELECT id, status, employee_id AS employeeId, DATE_FORMAT(appointment_date, '%Y-%m-%d') AS date,
            HOUR(start_time) * 60 + MINUTE(start_time) AS start,
            HOUR(end_time) * 60 + MINUTE(end_time) AS end
     FROM appointments WHERE id = ? FOR UPDATE`,
    [id],
  );
  if (!appointment) {
    throw new HttpError(404, 'Appointment not found.');
  }
  if (appointment.status === 'completed') {
    throw new HttpError(409, 'This appointment has already been billed and can no longer be changed.');
  }
  return appointment;
}

router.get('/', async (req, res) => {
  const day = date(req.query.date, 'Date', { required: true });
  const [rows] = await db.query(
    `${selectAppointments} WHERE a.appointment_date = ? ORDER BY a.start_time, e.name`,
    [day],
  );
  res.json({ count: rows.length, appointments: rows.map(formatAppointment) });
});

router.get('/:id', async (req, res) => {
  const appointment = await findAppointment(req.params.id);
  if (!appointment) {
    throw new HttpError(404, 'Appointment not found.');
  }
  res.json({ appointment });
});

router.post('/', async (req, res) => {
  const booking = parseBooking(req.body);
  const status = req.body?.status === 'pending' ? 'pending' : 'confirmed';

  const id = await inTransaction(async (conn) => {
    const row = await scheduleBooking(conn, booking);
    const [result] = await conn.query('INSERT INTO appointments SET ?', [{ ...row, status }]);
    return result.insertId;
  });
  res.status(201).json({ appointment: await findAppointment(id) });
});

router.put('/:id', async (req, res) => {
  const booking = parseBooking(req.body);

  await inTransaction(async (conn) => {
    const current = await lockAppointment(conn, req.params.id);
    if (current.status === 'in_service') {
      throw new HttpError(409, 'This service has already started, so the booking can no longer be changed.');
    }
    const row = await scheduleBooking(conn, booking, {
      checkClash: !INACTIVE_STATUSES.includes(current.status),
      excludeId: current.id,
    });
    await conn.query('UPDATE appointments SET ? WHERE id = ?', [row, current.id]);
  });
  res.json({ appointment: await findAppointment(req.params.id) });
});

router.put('/:id/status', async (req, res) => {
  const status = req.body?.status;
  if (status === 'completed') {
    throw new HttpError(400, 'An appointment is completed automatically when it is billed at POS.');
  }
  if (!MANUAL_STATUSES.includes(status)) {
    throw new HttpError(400, 'Choose a valid appointment status.');
  }

  await inTransaction(async (conn) => {
    const current = await lockAppointment(conn, req.params.id);
    if (current.status === 'in_service' && INACTIVE_STATUSES.includes(status)) {
      throw new HttpError(409, 'This service has already started and can no longer be cancelled.');
    }
    if (INACTIVE_STATUSES.includes(current.status) && !INACTIVE_STATUSES.includes(status)) {
      const employee = await lockEmployee(conn, current.employeeId);
      await assertSlotFree(conn, employee, current.date, current.start, current.end, current.id);
    }
    await conn.query('UPDATE appointments SET status = ? WHERE id = ?', [status, current.id]);
  });
  res.json({ appointment: await findAppointment(req.params.id) });
});

module.exports = router;
