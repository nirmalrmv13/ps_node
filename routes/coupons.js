const express = require('express');
const db = require('../db');
const { isAdmin, requireRole } = require('../auth');
const { HttpError } = require('../errors');
const { number, text } = require('../validation');

const router = express.Router();

const columns = `id, code, description, discount_type AS discountType, discount_value AS discountValue,
  max_discount AS maxDiscount, min_subtotal AS minSubtotal, is_active AS isActive`;

function formatCoupon(coupon) {
  return { ...coupon, isActive: Boolean(coupon.isActive) };
}

function parseCoupon(body = {}) {
  const code = text(body.code, 'Code', { required: true, max: 30 }).toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) {
    throw new HttpError(400, 'Code must be 3–30 characters using letters, numbers, - or _.');
  }

  const discountType = body.discountType;
  if (!['percent', 'flat'].includes(discountType)) {
    throw new HttpError(400, 'Discount type must be percentage or flat amount.');
  }

  const isPercent = discountType === 'percent';
  return {
    code,
    description: text(body.description, 'Description', { max: 255 }),
    discount_type: discountType,
    discount_value: number(body.discountValue, 'Discount value', {
      required: true,
      min: 0.01,
      max: isPercent ? 100 : 9999999,
    }),
    max_discount: isPercent
      ? number(body.maxDiscount, 'Maximum discount', { min: 0.01, max: 9999999 })
      : null,
    min_subtotal: number(body.minSubtotal, 'Minimum folio value', { min: 0, max: 9999999 }) ?? 0,
    is_active: body.isActive === false ? 0 : 1,
  };
}

async function findCoupon(id) {
  const [rows] = await db.query(`SELECT ${columns} FROM coupons WHERE id = ?`, [id]);
  return rows[0] ? formatCoupon(rows[0]) : null;
}

router.get('/', async (req, res) => {
  if (req.query.all === '1' && isAdmin(req)) {
    const [coupons] = await db.query(`SELECT ${columns} FROM coupons ORDER BY code`);
    return res.json({ coupons: coupons.map(formatCoupon) });
  }

  const [coupons] = await db.query(
    'SELECT code, description FROM coupons WHERE is_active = 1 ORDER BY code',
  );
  res.json({ coupons });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const [result] = await db.query('INSERT INTO coupons SET ?', [parseCoupon(req.body)]);
  res.status(201).json({ coupon: await findCoupon(result.insertId) });
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const [result] = await db.query('UPDATE coupons SET ? WHERE id = ?', [
    parseCoupon(req.body),
    req.params.id,
  ]);
  if (result.affectedRows === 0) {
    throw new HttpError(404, 'Coupon not found.');
  }
  res.json({ coupon: await findCoupon(req.params.id) });
});

module.exports = router;
