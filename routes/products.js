const express = require('express');
const db = require('../db');
const { isAdmin, requireRole } = require('../auth');
const { HttpError } = require('../errors');
const { recordAdjustment } = require('../stock');
const { inTransaction } = require('../transaction');
const { number, text } = require('../validation');

const router = express.Router();

const columns =
  'id, name, brand, category, description, size, price, stock, is_active AS isActive';

function formatProduct(product) {
  return { ...product, isActive: Boolean(product.isActive), inStock: product.stock > 0 };
}

function parseProduct(body = {}) {
  return {
    name: text(body.name, 'Name', { required: true, max: 100 }),
    brand: text(body.brand, 'Brand', { max: 100 }),
    category: text(body.category, 'Category', { required: true, max: 50 }),
    description: text(body.description, 'Description', { max: 2000 }),
    size: text(body.size, 'Size', { max: 30 }),
    price: number(body.price, 'Price', { required: true, min: 0, max: 9999999 }),
    stock: number(body.stock, 'Stock', { required: true, min: 0, max: 1000000, integer: true }),
    is_active: body.isActive === false ? 0 : 1,
  };
}

async function findProduct(id, includeInactive) {
  const [rows] = await db.query(
    `SELECT ${columns} FROM products WHERE id = ?${includeInactive ? '' : ' AND is_active = 1'}`,
    [id],
  );
  return rows[0] ? formatProduct(rows[0]) : null;
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

  const [products] = await db.query(
    `SELECT ${columns} FROM products ${where} ORDER BY category, name`,
    params,
  );
  res.json({ count: products.length, products: products.map(formatProduct) });
});

router.get('/categories', async (req, res) => {
  const [rows] = await db.query(
    'SELECT DISTINCT category FROM products WHERE is_active = 1 ORDER BY category',
  );
  res.json({ categories: rows.map((row) => row.category) });
});

router.get('/:id', async (req, res) => {
  const product = await findProduct(req.params.id, isAdmin(req));
  if (!product) {
    return res.status(404).json({ message: 'Product not found.' });
  }
  res.json({ product });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const product = parseProduct(req.body);
  const id = await inTransaction(async (conn) => {
    const [result] = await conn.query('INSERT INTO products SET ?', [product]);
    if (product.stock > 0) {
      await recordAdjustment(conn, {
        productId: result.insertId,
        reason: 'opening',
        change: product.stock,
        stockAfter: product.stock,
        note: 'Opening stock',
        userId: req.user.id,
      });
    }
    return result.insertId;
  });
  res.status(201).json({ product: await findProduct(id, true) });
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const product = parseProduct(req.body);
  await inTransaction(async (conn) => {
    const [[current]] = await conn.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [
      req.params.id,
    ]);
    if (!current) {
      throw new HttpError(404, 'Product not found.');
    }
    await conn.query('UPDATE products SET ? WHERE id = ?', [product, req.params.id]);
    if (product.stock !== current.stock) {
      await recordAdjustment(conn, {
        productId: Number(req.params.id),
        reason: 'count',
        change: product.stock - current.stock,
        stockAfter: product.stock,
        note: 'Edited in Product Master',
        userId: req.user.id,
      });
    }
  });
  res.json({ product: await findProduct(req.params.id, true) });
});

module.exports = router;
