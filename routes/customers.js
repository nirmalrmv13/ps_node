const express = require('express');
const db = require('../db');
const { HttpError } = require('../errors');
const { STARS_FOR_FREE, normalizePhone } = require('../loyalty');
const { activeMembership, addMembership, previewMembershipDates } = require('../membership');
const { date, number, text } = require('../validation');
const { inTransaction } = require('../transaction');

const router = express.Router();

const LIST_LIMIT = 2000;
const GENDERS = ['female', 'male', 'other'];

const customerColumns = `c.id, c.name, c.phone, c.email, c.gender,
  DATE_FORMAT(c.birthday, '%Y-%m-%d') AS birthday, c.location, c.notes, c.stars,
  c.free_services_redeemed AS freeServicesRedeemed, c.created_at AS createdAt`;

function parseCustomer(body = {}) {
  const email = text(body.email, 'Email', { max: 255 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Email must be a valid email address.');
  }
  const gender = text(body.gender, 'Gender', { max: 10 });
  if (gender && !GENDERS.includes(gender)) {
    throw new HttpError(400, 'Choose a valid gender.');
  }
  const birthday = date(body.birthday, 'Birthday');
  if (birthday && birthday > new Date().toLocaleDateString('en-CA')) {
    throw new HttpError(400, 'Birthday cannot be in the future.');
  }

  return {
    phone: normalizePhone(body.phone, { required: true }),
    name: text(body.name, 'Name', { required: true, max: 100 }),
    email,
    gender,
    birthday,
    location: text(body.location, 'Location', { max: 120 }),
    notes: text(body.notes, 'Notes', { max: 1000 }),
  };
}

async function assertPhoneFree(phone, excludeId = 0) {
  const [[other]] = await db.query('SELECT name FROM customers WHERE phone = ? AND id <> ?', [phone, excludeId]);
  if (other) {
    throw new HttpError(409, `${other.name} is already saved with mobile number ${phone}.`);
  }
}

async function findCustomer(id) {
  const [[customer]] = await db.query(
    `SELECT ${customerColumns},
            COUNT(i.id) AS visits, COALESCE(SUM(i.total), 0) AS totalSpent,
            MIN(i.created_at) AS firstVisit, MAX(i.created_at) AS lastVisit
     FROM customers c
     LEFT JOIN invoices i ON i.customer_id = c.id
     WHERE c.id = ?
     GROUP BY c.id`,
    [id],
  );
  if (!customer) return null;
  return { ...customer, membership: await activeMembership(db, customer.id) };
}

router.get('/', async (req, res) => {
  const [customers] = await db.query(
    `SELECT ${customerColumns},
            COUNT(i.id) AS visits, COALESCE(SUM(i.total), 0) AS totalSpent, MAX(i.created_at) AS lastVisit,
            (SELECT m.plan_name FROM customer_memberships m
              WHERE m.customer_id = c.id AND m.start_date <= CURDATE() AND m.end_date >= CURDATE()
              ORDER BY m.discount_percent DESC LIMIT 1) AS membershipName,
            (SELECT DATE_FORMAT(MAX(m.end_date), '%Y-%m-%d') FROM customer_memberships m
              WHERE m.customer_id = c.id AND m.end_date >= CURDATE()) AS membershipUntil
     FROM customers c
     LEFT JOIN invoices i ON i.customer_id = c.id
     GROUP BY c.id
     ORDER BY MAX(i.created_at) IS NULL, MAX(i.created_at) DESC, c.created_at DESC
     LIMIT ?`,
    [LIST_LIMIT],
  );
  res.json({ starsForFree: STARS_FOR_FREE, limit: LIST_LIMIT, customers });
});

router.get('/lookup', async (req, res) => {
  const phone = normalizePhone(req.query.phone, { required: true });
  const [[customer]] = await db.query(
    `SELECT c.id, c.name, c.phone, c.stars, c.free_services_redeemed AS freeServicesRedeemed,
            COUNT(i.id) AS visits, MAX(i.created_at) AS lastVisit
     FROM customers c
     LEFT JOIN invoices i ON i.customer_id = c.id
     WHERE c.phone = ?
     GROUP BY c.id`,
    [phone],
  );
  res.json({
    starsForFree: STARS_FOR_FREE,
    customer: customer ? { ...customer, membership: await activeMembership(db, customer.id) } : null,
  });
});

router.get('/:id', async (req, res) => {
  const customer = await findCustomer(req.params.id);
  if (!customer) {
    throw new HttpError(404, 'Customer not found.');
  }

  const [invoices] = await db.query(
    `SELECT i.id, i.invoice_number AS invoiceNumber, i.created_at AS createdAt, i.total,
            i.discount + i.loyalty_discount + i.membership_discount AS discounts, i.stars_earned AS starsEarned,
            (SELECT GROUP_CONCAT(name ORDER BY id SEPARATOR ', ') FROM invoice_items WHERE invoice_id = i.id) AS items
     FROM invoices i
     WHERE i.customer_id = ?
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT 25`,
    [customer.id],
  );

  const [appointments] = await db.query(
    `SELECT a.id, DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS date,
            TIME_FORMAT(a.start_time, '%H:%i') AS startTime, a.status,
            s.name AS serviceName, e.name AS employeeName
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     JOIN employees e ON e.id = a.employee_id
     WHERE RIGHT(REPLACE(a.client_phone, '+', ''), 10) = RIGHT(?, 10)
     ORDER BY a.appointment_date DESC, a.start_time DESC
     LIMIT 25`,
    [customer.phone],
  );

  const [memberships] = await db.query(
    `SELECT m.id, m.plan_name AS planName, m.discount_percent AS discountPercent, m.price_paid AS pricePaid,
            DATE_FORMAT(m.start_date, '%Y-%m-%d') AS startDate, DATE_FORMAT(m.end_date, '%Y-%m-%d') AS endDate,
            i.invoice_number AS invoiceNumber, m.invoice_id AS invoiceId
     FROM customer_memberships m
     LEFT JOIN invoices i ON i.id = m.invoice_id
     WHERE m.customer_id = ?
     ORDER BY m.start_date DESC, m.id DESC`,
    [customer.id],
  );

  res.json({ starsForFree: STARS_FOR_FREE, customer, invoices, appointments, memberships });
});

router.post('/', async (req, res) => {
  const customer = parseCustomer(req.body);
  await assertPhoneFree(customer.phone);
  const [result] = await db.query('INSERT INTO customers SET ?', [customer]);
  res.status(201).json({ customer: await findCustomer(result.insertId) });
});

/** Sell a membership to an existing customer, or create the customer first. */
router.post('/assign-membership', async (req, res) => {
  const body = req.body ?? {};
  const planId = number(body.planId, 'Membership plan', { required: true, integer: true, min: 1 });
  const note = text(body.note, 'Note', { max: 255 });
  let customerId = number(body.customerId, 'Customer', { integer: true, min: 1 });

  const [[plan]] = await db.query(
    `SELECT id, name, price, duration_days AS durationDays, discount_percent AS discountPercent, is_active AS isActive
     FROM membership_plans WHERE id = ?`,
    [planId],
  );
  if (!plan || !plan.isActive) {
    throw new HttpError(400, 'Choose an active membership plan.');
  }

  const result = await inTransaction(async (conn) => {
    if (!customerId) {
      const customer = parseCustomer(body);
      await assertPhoneFree(customer.phone);
      const [created] = await conn.query('INSERT INTO customers SET ?', [customer]);
      customerId = created.insertId;
    } else {
      const [[existing]] = await conn.query('SELECT id FROM customers WHERE id = ?', [customerId]);
      if (!existing) {
        throw new HttpError(404, 'Customer not found.');
      }
    }

    const dates = await previewMembershipDates(conn, customerId, plan.durationDays);
    const inserted = await addMembership(conn, {
      customerId,
      plan: {
        id: plan.id,
        name: plan.name,
        discountPercent: Number(plan.discountPercent),
        durationDays: plan.durationDays,
        price: Number(plan.price),
        rate: Number(plan.price),
      },
      invoiceId: null,
      pricePaid: Number(plan.price),
    });
    if (note) {
      await conn.query(
        `UPDATE customers SET notes = TRIM(CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE '\n' END, ?))
         WHERE id = ?`,
        [`Membership ${plan.name} added ${dates.startDate}–${dates.endDate}. ${note}`, customerId],
      );
    }
    return {
      membership: {
        id: inserted.id,
        planId: plan.id,
        planName: plan.name,
        discountPercent: Number(plan.discountPercent),
        pricePaid: Number(plan.price),
        startDate: dates.startDate,
        endDate: dates.endDate,
      },
      customerId,
    };
  });

  res.status(201).json({
    membership: result.membership,
    customer: await findCustomer(result.customerId),
  });
});

router.put('/:id', async (req, res) => {
  const customer = parseCustomer(req.body);
  await assertPhoneFree(customer.phone, req.params.id);
  const [result] = await db.query('UPDATE customers SET ? WHERE id = ?', [customer, req.params.id]);
  if (result.affectedRows === 0) {
    throw new HttpError(404, 'Customer not found.');
  }
  res.json({ customer: await findCustomer(req.params.id) });
});

/** Assign a membership plan to a customer outside Billing/POS. */
router.post('/:id/memberships', async (req, res) => {
  const customerId = number(req.params.id, 'Customer', { required: true, integer: true, min: 1 });
  const planId = number(req.body?.planId, 'Membership plan', { required: true, integer: true, min: 1 });
  const note = text(req.body?.note, 'Note', { max: 255 });

  const customer = await findCustomer(customerId);
  if (!customer) {
    throw new HttpError(404, 'Customer not found.');
  }

  const [[plan]] = await db.query(
    `SELECT id, name, price, duration_days AS durationDays, discount_percent AS discountPercent, is_active AS isActive
     FROM membership_plans WHERE id = ?`,
    [planId],
  );
  if (!plan || !plan.isActive) {
    throw new HttpError(400, 'Choose an active membership plan.');
  }

  const membership = await inTransaction(async (conn) => {
    const dates = await previewMembershipDates(conn, customerId, plan.durationDays);
    const inserted = await addMembership(conn, {
      customerId,
      plan: {
        id: plan.id,
        name: plan.name,
        discountPercent: Number(plan.discountPercent),
        durationDays: plan.durationDays,
        price: Number(plan.price),
        rate: Number(plan.price),
      },
      invoiceId: null,
      pricePaid: Number(plan.price),
    });
    if (note) {
      await conn.query(
        `UPDATE customers SET notes = TRIM(CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE '\n' END, ?))
         WHERE id = ?`,
        [`Membership ${plan.name} added ${dates.startDate}–${dates.endDate}. ${note}`, customerId],
      );
    }
    return {
      id: inserted.id,
      planId: plan.id,
      planName: plan.name,
      discountPercent: Number(plan.discountPercent),
      pricePaid: Number(plan.price),
      startDate: dates.startDate,
      endDate: dates.endDate,
    };
  });

  res.status(201).json({
    membership,
    customer: await findCustomer(customerId),
  });
});

router.get('/:id/membership-preview', async (req, res) => {
  const customerId = number(req.params.id, 'Customer', { required: true, integer: true, min: 1 });
  const planId = number(req.query.planId, 'Membership plan', { required: true, integer: true, min: 1 });
  const customer = await findCustomer(customerId);
  if (!customer) {
    throw new HttpError(404, 'Customer not found.');
  }
  const [[plan]] = await db.query(
    `SELECT id, name, price, duration_days AS durationDays, discount_percent AS discountPercent, is_active AS isActive
     FROM membership_plans WHERE id = ?`,
    [planId],
  );
  if (!plan || !plan.isActive) {
    throw new HttpError(400, 'Choose an active membership plan.');
  }
  const dates = await previewMembershipDates(db, customerId, plan.durationDays);
  res.json({
    plan: {
      id: plan.id,
      name: plan.name,
      price: Number(plan.price),
      durationDays: plan.durationDays,
      discountPercent: Number(plan.discountPercent),
    },
    ...dates,
    activeMembership: customer.membership,
  });
});

module.exports = router;
