const express = require('express');
const db = require('../db');
const { HttpError } = require('../errors');
const { date } = require('../validation');

const router = express.Router();

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const shiftDays = (day, days) => {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

router.get('/', async (req, res) => {
  const from = date(req.query.from, 'From date', { required: true });
  const to = date(req.query.to, 'To date', { required: true });
  if (from > to) {
    throw new HttpError(400, 'The From date must be on or before the To date.');
  }

  const inRange = 'i.created_at >= ? AND i.created_at < ? + INTERVAL 1 DAY';
  const range = [`${from} 00:00:00`, `${to} 00:00:00`];

  const [[sales]] = await db.query(
    `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.total), 0) AS revenue,
            COALESCE(SUM(i.taxable_value), 0) AS netSales, COALESCE(SUM(i.cgst + i.sgst), 0) AS gst,
            COALESCE(SUM(i.discount), 0) AS couponDiscounts,
            COALESCE(SUM(i.loyalty_discount), 0) AS loyaltyDiscounts,
            COALESCE(SUM(i.membership_discount), 0) AS membershipDiscounts,
            COUNT(DISTINCT i.customer_id) AS customers,
            COALESCE(SUM(i.customer_id IS NULL), 0) AS walkIns
     FROM invoices i WHERE ${inRange}`,
    range,
  );

  const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const previousFrom = shiftDays(from, -spanDays);
  const previousTo = shiftDays(from, -1);
  const [[previous]] = await db.query(
    `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.total), 0) AS revenue,
            COUNT(DISTINCT i.customer_id) AS customers
     FROM invoices i WHERE ${inRange}`,
    [`${previousFrom} 00:00:00`, `${previousTo} 00:00:00`],
  );

  const [[{ newCustomers }]] = await db.query(
    'SELECT COUNT(*) AS newCustomers FROM customers WHERE created_at >= ? AND created_at < ? + INTERVAL 1 DAY',
    range,
  );

  const [daily] = await db.query(
    `SELECT DATE_FORMAT(i.created_at, '%Y-%m-%d') AS day, COUNT(*) AS invoices, SUM(i.total) AS revenue
     FROM invoices i WHERE ${inRange}
     GROUP BY day ORDER BY day`,
    range,
  );

  const [items] = await db.query(
    `SELECT ii.item_type AS type, ii.item_id AS id, MAX(ii.name) AS name,
            MAX(COALESCE(s.category, p.category, 'Membership')) AS category,
            SUM(ii.quantity) AS quantity, SUM(ii.line_total) AS revenue
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     LEFT JOIN services s ON ii.item_type = 'service' AND s.id = ii.item_id
     LEFT JOIN products p ON ii.item_type = 'product' AND p.id = ii.item_id
     WHERE ${inRange}
     GROUP BY ii.item_type, ii.item_id
     ORDER BY revenue DESC`,
    range,
  );

  const categories = new Map();
  for (const item of items) {
    const key = `${item.type}:${item.category}`;
    const entry = categories.get(key) ?? { type: item.type, category: item.category, quantity: 0, revenue: 0 };
    entry.quantity += Number(item.quantity);
    entry.revenue = round2(entry.revenue + item.revenue);
    categories.set(key, entry);
  }

  const [[usage]] = await db.query(
    `SELECT COALESCE(SUM(pu.quantity), 0) AS units, COALESCE(SUM(pu.quantity * pu.unit_value), 0) AS value
     FROM invoice_product_usage pu JOIN invoices i ON i.id = pu.invoice_id
     WHERE ${inRange}`,
    range,
  );

  const [staffRows] = await db.query(
    `SELECT e.id, e.name, e.designation, e.commission_percent AS commissionPercent,
            COUNT(a.id) AS services, COALESCE(SUM(ii.rate), 0) AS serviceValue
     FROM appointments a
     JOIN invoices i ON i.id = a.invoice_id
     JOIN employees e ON e.id = a.employee_id
     LEFT JOIN invoice_items ii
       ON ii.invoice_id = a.invoice_id AND ii.item_type = 'service' AND ii.item_id = a.service_id
     WHERE a.status = 'completed' AND ${inRange}
     GROUP BY e.id
     ORDER BY serviceValue DESC`,
    range,
  );
  const staff = staffRows.map((row) => ({
    ...row,
    commission: round2((row.serviceValue * row.commissionPercent) / 100),
  }));

  const [appointmentRows] = await db.query(
    `SELECT status, COUNT(*) AS count FROM appointments
     WHERE appointment_date BETWEEN ? AND ?
     GROUP BY status`,
    [from, to],
  );
  const appointments = Object.fromEntries(appointmentRows.map((row) => [row.status, row.count]));

  const [topCustomers] = await db.query(
    `SELECT c.id, c.name, c.phone, COUNT(i.id) AS visits, SUM(i.total) AS spent
     FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE ${inRange}
     GROUP BY c.id
     ORDER BY spent DESC
     LIMIT 10`,
    range,
  );

  const [[purchases]] = await db.query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total,
            COALESCE(SUM(CASE WHEN payment_status = 'unpaid' THEN total ELSE 0 END), 0) AS unpaid
     FROM purchases WHERE purchase_date BETWEEN ? AND ?`,
    [from, to],
  );

  const [[{ activeMembers }]] = await db.query(
    `SELECT COUNT(DISTINCT customer_id) AS activeMembers FROM customer_memberships
     WHERE start_date <= CURDATE() AND end_date >= CURDATE()`,
  );

  res.json({
    from,
    to,
    sales: { ...sales, newCustomers, averageBill: sales.invoices ? round2(sales.revenue / sales.invoices) : 0 },
    previous: {
      from: previousFrom,
      to: previousTo,
      ...previous,
      averageBill: previous.invoices ? round2(previous.revenue / previous.invoices) : 0,
    },
    daily,
    services: items.filter((item) => item.type === 'service'),
    products: items.filter((item) => item.type === 'product'),
    memberships: items.filter((item) => item.type === 'membership'),
    categories: [...categories.values()].sort((a, b) => b.revenue - a.revenue),
    usage,
    staff,
    appointments,
    topCustomers,
    purchases,
    activeMembers,
  });
});

module.exports = router;
