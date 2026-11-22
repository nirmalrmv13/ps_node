const express = require('express');
const db = require('../db');
const { HttpError } = require('../errors');
const { hardDelete } = require('../hardDelete');
const { text } = require('../validation');

const router = express.Router();

const columns = `id, name, contact_person AS contactPerson, phone, email, gstin, address, is_active AS isActive,
  (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = suppliers.id) AS purchases,
  (SELECT COALESCE(SUM(p.total), 0) FROM purchases p
    WHERE p.supplier_id = suppliers.id AND p.payment_status = 'unpaid') AS amountDue`;

function formatSupplier(supplier) {
  return { ...supplier, isActive: Boolean(supplier.isActive) };
}

function parseSupplier(body = {}) {
  const phone = text(body.phone, 'Phone', { max: 20 })?.replace(/[\s-]/g, '') ?? null;
  if (phone && !/^\+?[0-9]{10,15}$/.test(phone)) {
    throw new HttpError(400, 'Phone must have 10 to 15 digits.');
  }
  const email = text(body.email, 'Email', { max: 255 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Email must be a valid email address.');
  }
  const gstin = text(body.gstin, 'GSTIN', { max: 15 })?.toUpperCase() ?? null;
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) {
    throw new HttpError(400, 'GSTIN must be 15 letters and numbers.');
  }

  return {
    name: text(body.name, 'Name', { required: true, max: 100 }),
    contact_person: text(body.contactPerson, 'Contact person', { max: 100 }),
    phone,
    email,
    gstin,
    address: text(body.address, 'Address', { max: 500 }),
    is_active: body.isActive === false ? 0 : 1,
  };
}

async function findSupplier(id) {
  const [rows] = await db.query(`SELECT ${columns} FROM suppliers WHERE id = ?`, [id]);
  return rows[0] ? formatSupplier(rows[0]) : null;
}

router.get('/', async (req, res) => {
  const where = req.query.all === '1' ? '' : 'WHERE is_active = 1';
  const [suppliers] = await db.query(`SELECT ${columns} FROM suppliers ${where} ORDER BY name`);
  res.json({ suppliers: suppliers.map(formatSupplier) });
});

router.post('/', async (req, res) => {
  const [result] = await db.query('INSERT INTO suppliers SET ?', [parseSupplier(req.body)]);
  res.status(201).json({ supplier: await findSupplier(result.insertId) });
});

router.put('/:id', async (req, res) => {
  const [result] = await db.query('UPDATE suppliers SET ? WHERE id = ?', [parseSupplier(req.body), req.params.id]);
  if (result.affectedRows === 0) {
    throw new HttpError(404, 'Supplier not found.');
  }
  res.json({ supplier: await findSupplier(req.params.id) });
});

router.delete('/:id', async (req, res) => {
  await hardDelete('suppliers', req.params.id, 'Supplier');
  res.json({ ok: true });
});

module.exports = router;
