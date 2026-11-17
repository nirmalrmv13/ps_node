const express = require('express');
const db = require('../db');
const { HttpError } = require('../errors');
const { recordAdjustment } = require('../stock');
const { inTransaction } = require('../transaction');
const { date, number, text } = require('../validation');

const router = express.Router();

const HISTORY_LIMIT = 500;
const MAX_LINES = 100;

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function parseLines(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(400, 'Add at least one product to the purchase.');
  }
  if (rawItems.length > MAX_LINES) {
    throw new HttpError(400, `A purchase can have at most ${MAX_LINES} lines.`);
  }

  const seen = new Set();
  return rawItems.map((item) => {
    const productId = number(item?.productId, 'Product', { required: true, integer: true, min: 1 });
    if (seen.has(productId)) {
      throw new HttpError(400, 'Each product can appear only once on a purchase.');
    }
    seen.add(productId);
    return {
      productId,
      quantity: number(item.quantity, 'Quantity', { required: true, integer: true, min: 1, max: 100000 }),
      unitCost: number(item.unitCost, 'Unit cost', { required: true, min: 0, max: 9999999 }),
    };
  });
}

async function loadPurchase(id) {
  const [[purchase]] = await db.query(
    `SELECT p.id, p.purchase_number AS purchaseNumber, DATE_FORMAT(p.purchase_date, '%Y-%m-%d') AS purchaseDate,
            p.supplier_id AS supplierId, s.name AS supplierName, s.gstin AS supplierGstin,
            p.supplier_invoice_no AS supplierInvoiceNo, p.subtotal, p.tax_amount AS taxAmount, p.total,
            p.payment_status AS paymentStatus, p.note, p.created_at AS createdAt,
            COALESCE(u.full_name, u.username) AS userName
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.id = ?`,
    [id],
  );
  if (!purchase) return null;

  const [items] = await db.query(
    `SELECT product_id AS productId, product_name AS productName, quantity, unit_cost AS unitCost,
            line_total AS lineTotal
     FROM purchase_items WHERE purchase_id = ? ORDER BY id`,
    [id],
  );
  return { ...purchase, items };
}

router.get('/', async (req, res) => {
  const from = date(req.query.from, 'From date');
  const to = date(req.query.to, 'To date');
  if (from && to && from > to) {
    throw new HttpError(400, 'The From date must be on or before the To date.');
  }
  const supplierId = number(req.query.supplierId, 'Supplier', { integer: true, min: 1 });
  const search = text(req.query.q, 'Search', { max: 100 });

  const where = [];
  const params = [];
  if (from) {
    where.push('p.purchase_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('p.purchase_date <= ?');
    params.push(to);
  }
  if (supplierId) {
    where.push('p.supplier_id = ?');
    params.push(supplierId);
  }
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    where.push('(p.purchase_number LIKE ? OR p.supplier_invoice_no LIKE ? OR s.name LIKE ?)');
    params.push(like, like, like);
  }
  const filter = `FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
                  ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

  const [[summary]] = await db.query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(p.total), 0) AS total, COALESCE(SUM(p.tax_amount), 0) AS tax,
            COALESCE(SUM(CASE WHEN p.payment_status = 'unpaid' THEN p.total ELSE 0 END), 0) AS unpaid
     ${filter}`,
    params,
  );

  const [purchases] = await db.query(
    `SELECT p.id, p.purchase_number AS purchaseNumber, DATE_FORMAT(p.purchase_date, '%Y-%m-%d') AS purchaseDate,
            s.name AS supplierName, p.supplier_invoice_no AS supplierInvoiceNo, p.subtotal,
            p.tax_amount AS taxAmount, p.total, p.payment_status AS paymentStatus, p.note,
            (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.id) AS lines,
            (SELECT COALESCE(SUM(quantity), 0) FROM purchase_items WHERE purchase_id = p.id) AS units
     ${filter}
     ORDER BY p.purchase_date DESC, p.id DESC
     LIMIT ?`,
    [...params, HISTORY_LIMIT],
  );

  res.json({ summary, limit: HISTORY_LIMIT, purchases });
});

router.get('/:id', async (req, res) => {
  const purchase = await loadPurchase(req.params.id);
  if (!purchase) {
    throw new HttpError(404, 'Purchase not found.');
  }
  res.json({ purchase });
});

router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const supplierId = number(body.supplierId, 'Supplier', { required: true, integer: true, min: 1 });
  const purchaseDate = date(body.purchaseDate, 'Purchase date', { required: true });
  if (purchaseDate > new Date().toLocaleDateString('en-CA')) {
    throw new HttpError(400, 'Purchase date cannot be in the future.');
  }
  const supplierInvoiceNo = text(body.supplierInvoiceNo, 'Supplier invoice number', { max: 50 });
  const taxAmount = number(body.taxAmount, 'GST amount', { min: 0, max: 9999999 }) ?? 0;
  const note = text(body.note, 'Note', { max: 255 });
  const lines = parseLines(body.items);

  const purchaseId = await inTransaction(async (conn) => {
    const [[supplier]] = await conn.query('SELECT id, name, is_active FROM suppliers WHERE id = ?', [supplierId]);
    if (!supplier || !supplier.is_active) {
      throw new HttpError(400, 'Choose an active supplier.');
    }

    const ids = lines.map((line) => line.productId).sort((a, b) => a - b);
    const [rows] = await conn.query('SELECT id, name, stock FROM products WHERE id IN (?) FOR UPDATE', [ids]);
    const products = new Map(rows.map((row) => [row.id, row]));
    for (const line of lines) {
      if (!products.has(line.productId)) {
        throw new HttpError(400, 'A product on this purchase no longer exists.');
      }
    }

    const priced = lines.map((line) => ({ ...line, lineTotal: round2(line.quantity * line.unitCost) }));
    const subtotal = round2(priced.reduce((sum, line) => sum + line.lineTotal, 0));
    const [result] = await conn.query('INSERT INTO purchases SET ?', [
      {
        supplier_id: supplier.id,
        supplier_invoice_no: supplierInvoiceNo,
        purchase_date: purchaseDate,
        subtotal,
        tax_amount: taxAmount,
        total: round2(subtotal + taxAmount),
        payment_status: body.paid === true ? 'paid' : 'unpaid',
        note,
        user_id: req.user.id,
      },
    ]);
    const id = result.insertId;
    const purchaseNumber = `PUR-${purchaseDate.slice(0, 4)}-${String(id).padStart(4, '0')}`;
    await conn.query('UPDATE purchases SET purchase_number = ? WHERE id = ?', [purchaseNumber, id]);

    await conn.query(
      'INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit_cost, line_total) VALUES ?',
      [priced.map((l) => [id, l.productId, products.get(l.productId).name, l.quantity, l.unitCost, l.lineTotal])],
    );

    for (const line of priced) {
      const product = products.get(line.productId);
      const stockAfter = product.stock + line.quantity;
      await conn.query('UPDATE products SET stock = ? WHERE id = ?', [stockAfter, product.id]);
      await recordAdjustment(conn, {
        productId: product.id,
        reason: 'received',
        change: line.quantity,
        stockAfter,
        note: `${purchaseNumber} · ${supplier.name}`,
        userId: req.user.id,
      });
    }
    return id;
  });

  res.status(201).json({ purchase: await loadPurchase(purchaseId) });
});

router.put('/:id/payment', async (req, res) => {
  const status = req.body?.status;
  if (!['paid', 'unpaid'].includes(status)) {
    throw new HttpError(400, 'Payment status must be paid or unpaid.');
  }
  const [result] = await db.query('UPDATE purchases SET payment_status = ? WHERE id = ?', [status, req.params.id]);
  if (result.affectedRows === 0) {
    throw new HttpError(404, 'Purchase not found.');
  }
  res.json({ purchase: await loadPurchase(req.params.id) });
});

module.exports = router;
