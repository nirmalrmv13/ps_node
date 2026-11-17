const express = require('express');
const db = require('../db');
const { isAdmin, requireRole } = require('../auth');
const { HttpError } = require('../errors');
const { number, text } = require('../validation');

const router = express.Router();

const columns = `id, name, description, price, duration_days AS durationDays,
  discount_percent AS discountPercent, is_active AS isActive,
  (SELECT COUNT(*) FROM customer_memberships m
    WHERE m.plan_id = membership_plans.id AND m.start_date <= CURDATE() AND m.end_date >= CURDATE()) AS activeMembers`;

function formatPlan(plan) {
  return { ...plan, isActive: Boolean(plan.isActive) };
}

function parsePlan(body = {}) {
  return {
    name: text(body.name, 'Name', { required: true, max: 100 }),
    description: text(body.description, 'Description', { max: 255 }),
    price: number(body.price, 'Price', { required: true, min: 0, max: 9999999 }),
    duration_days: number(body.durationDays, 'Validity', { required: true, integer: true, min: 1, max: 3650 }),
    discount_percent: number(body.discountPercent, 'Service discount', { required: true, min: 0.01, max: 100 }),
    is_active: body.isActive === false ? 0 : 1,
  };
}

async function findPlan(id) {
  const [rows] = await db.query(`SELECT ${columns} FROM membership_plans WHERE id = ?`, [id]);
  return rows[0] ? formatPlan(rows[0]) : null;
}

router.get('/', async (req, res) => {
  const where = req.query.all === '1' && isAdmin(req) ? '' : 'WHERE is_active = 1';
  const [plans] = await db.query(`SELECT ${columns} FROM membership_plans ${where} ORDER BY price`);
  res.json({ plans: plans.map(formatPlan) });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const [result] = await db.query('INSERT INTO membership_plans SET ?', [parsePlan(req.body)]);
  res.status(201).json({ plan: await findPlan(result.insertId) });
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const [result] = await db.query('UPDATE membership_plans SET ? WHERE id = ?', [
    parsePlan(req.body),
    req.params.id,
  ]);
  if (result.affectedRows === 0) {
    throw new HttpError(404, 'Membership plan not found.');
  }
  res.json({ plan: await findPlan(req.params.id) });
});

module.exports = router;
