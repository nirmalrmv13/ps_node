const express = require('express');
const db = require('../db');
const { HttpError } = require('../errors');
const { recordAdjustment } = require('../stock');
const { inTransaction } = require('../transaction');
const { number, text } = require('../validation');

const router = express.Router();

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD) || 5;
const STOCK_IN = ['received', 'returned'];
const STOCK_OUT = ['damaged', 'expired'];

router.get('/', async (req, res) => {
  const [rows] = await db.query(
    `SELECT p.id, p.name, p.brand, p.size, p.category, p.price, p.stock, p.is_active AS isActive,
            COALESCE(sold.quantity, 0) AS sold30, COALESCE(used.quantity, 0) AS used30
     FROM products p
     LEFT JOIN (
       SELECT ii.item_id AS product_id, SUM(ii.quantity) AS quantity
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE ii.item_type = 'product' AND i.created_at >= NOW() - INTERVAL 30 DAY
       GROUP BY ii.item_id
     ) sold ON sold.product_id = p.id
     LEFT JOIN (
       SELECT pu.product_id, SUM(pu.quantity) AS quantity
       FROM invoice_product_usage pu JOIN invoices i ON i.id = pu.invoice_id
       WHERE i.created_at >= NOW() - INTERVAL 30 DAY
       GROUP BY pu.product_id
     ) used ON used.product_id = p.id
     ORDER BY p.category, p.name`,
  );

  res.json({
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    products: rows.map((row) => ({
      ...row,
      price: Number(row.price),
      sold30: Number(row.sold30),
      used30: Number(row.used30),
      isActive: Boolean(row.isActive),
    })),
  });
});

router.get('/movements', async (req, res) => {
  const productId = number(req.query.productId, 'Product', { integer: true, min: 1 });
  const limit = number(req.query.limit, 'Limit', { integer: true, min: 1, max: 500 }) ?? 100;

  const [rows] = await db.query(
    `SELECT * FROM (
       SELECT CONCAT('sale-', ii.id) AS id, 'sale' AS kind, ii.item_id AS productId,
              ii.name AS productName, -ii.quantity AS quantityChange, NULL AS stockAfter,
              i.invoice_number AS reference, NULL AS note, NULL AS userName, i.created_at AS createdAt,
              ii.id AS seq
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE ii.item_type = 'product'
       UNION ALL
       SELECT CONCAT('usage-', pu.id), 'usage', pu.product_id, pu.product_name, -pu.quantity, NULL,
              i.invoice_number, pu.service_name, NULL, i.created_at, pu.id
       FROM invoice_product_usage pu JOIN invoices i ON i.id = pu.invoice_id
       UNION ALL
       SELECT CONCAT('adj-', sa.id), sa.reason, sa.product_id, p.name, sa.quantity_change, sa.stock_after,
              NULL, sa.note, COALESCE(u.full_name, u.username), sa.created_at, sa.id
       FROM stock_adjustments sa
       JOIN products p ON p.id = sa.product_id
       LEFT JOIN users u ON u.id = sa.user_id
     ) movements
     WHERE ? IS NULL OR productId = ?
     ORDER BY createdAt DESC, seq DESC
     LIMIT ?`,
    [productId, productId, limit],
  );

  res.json({
    movements: rows.map(({ seq, ...row }) => ({ ...row, quantityChange: Number(row.quantityChange) })),
  });
});

router.post('/adjustments', async (req, res) => {
  const body = req.body ?? {};
  const reason = body.reason;
  if (![...STOCK_IN, ...STOCK_OUT, 'count'].includes(reason)) {
    throw new HttpError(400, 'Choose a valid adjustment type.');
  }
  const productId = number(body.productId, 'Product', { required: true, integer: true, min: 1 });
  const quantity = number(body.quantity, reason === 'count' ? 'Counted quantity' : 'Quantity', {
    required: true,
    integer: true,
    min: reason === 'count' ? 0 : 1,
    max: 100000,
  });
  const note = text(body.note, 'Note', { max: 255 });

  const product = await inTransaction(async (conn) => {
    const [[current]] = await conn.query('SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE', [
      productId,
    ]);
    if (!current) {
      throw new HttpError(404, 'Product not found.');
    }

    let change;
    if (STOCK_IN.includes(reason)) {
      change = quantity;
    } else if (STOCK_OUT.includes(reason)) {
      if (quantity > current.stock) {
        throw new HttpError(409, `Only ${current.stock} of ${current.name} in stock.`);
      }
      change = -quantity;
    } else {
      change = quantity - current.stock;
      if (change === 0) {
        throw new HttpError(400, `${current.name} already has ${current.stock} in stock. Nothing to adjust.`);
      }
    }

    const stockAfter = current.stock + change;
    await conn.query('UPDATE products SET stock = ? WHERE id = ?', [stockAfter, productId]);
    await recordAdjustment(conn, { productId, reason, change, stockAfter, note, userId: req.user.id });
    return { id: current.id, name: current.name, stock: stockAfter, change };
  });

  res.status(201).json({ product });
});

module.exports = router;
