const express = require('express');
const db = require('../db');
const { isAdmin, requireRole } = require('../auth');
const { HttpError } = require('../errors');
const { number, text } = require('../validation');

const router = express.Router();

const columns =
  'id, name, category, description, duration_minutes AS durationMinutes, price, is_active AS isActive';

function formatService(service) {
  return { ...service, isActive: Boolean(service.isActive) };
}

function parseService(body = {}) {
  return {
    name: text(body.name, 'Name', { required: true, max: 100 }),
    category: text(body.category, 'Category', { required: true, max: 50 }),
    description: text(body.description, 'Description', { max: 2000 }),
    duration_minutes: number(body.durationMinutes, 'Duration', {
      required: true,
      min: 5,
      max: 720,
      integer: true,
    }),
    price: number(body.price, 'Price', { required: true, min: 0, max: 9999999 }),
    is_active: body.isActive === false ? 0 : 1,
  };
}

async function findService(id, includeInactive) {
  const [rows] = await db.query(
    `SELECT ${columns} FROM services WHERE id = ?${includeInactive ? '' : ' AND is_active = 1'}`,
    [id],
  );
  return rows[0] ? formatService(rows[0]) : null;
}

router.get('/', async (req, res) => {
  const includeInactive = req.query.all === '1' && isAdmin(req);
  const conditions = includeInactive ? [] : ['is_active = 1'];
  const params = [];
  if (req.query.category) {
    conditions.push('category = ?');
    params.push(req.query.category);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [services] = await db.query(
    `SELECT ${columns} FROM services ${where} ORDER BY category, price`,
    params,
  );
  res.json({ count: services.length, services: services.map(formatService) });
});

router.get('/categories', async (req, res) => {
  const [rows] = await db.query(
    'SELECT DISTINCT category FROM services WHERE is_active = 1 ORDER BY category',
  );
  res.json({ categories: rows.map((row) => row.category) });
});

router.get('/:id', async (req, res) => {
  const service = await findService(req.params.id, isAdmin(req));
  if (!service) {
    return res.status(404).json({ message: 'Service not found.' });
  }
  res.json({ service });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const [result] = await db.query('INSERT INTO services SET ?', [parseService(req.body)]);
  res.status(201).json({ service: await findService(result.insertId, true) });
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const [result] = await db.query('UPDATE services SET ? WHERE id = ?', [
    parseService(req.body),
    req.params.id,
  ]);
  if (result.affectedRows === 0) {
    throw new HttpError(404, 'Service not found.');
  }
  res.json({ service: await findService(req.params.id, true) });
});

module.exports = router;
