const express = require('express');
const db = require('../db');
const { priceFolio } = require('../billing');
const { HttpError } = require('../errors');
const { STARS_FOR_FREE, normalizePhone } = require('../loyalty');
const { date, number, text } = require('../validation');

const router = express.Router();

async function lockAppointmentForBilling(conn, appointmentId, folio) {
  const [[appointment]] = await conn.query(
    'SELECT id, status, service_id AS serviceId FROM appointments WHERE id = ? FOR UPDATE',
    [appointmentId],
  );
  if (!appointment) {
    throw new HttpError(404, 'Appointment not found.');
  }
  if (appointment.status === 'completed') {
    throw new HttpError(409, 'This appointment has already been billed.');
  }
  if (appointment.status === 'cancelled' || appointment.status === 'no_show') {
    throw new HttpError(409, 'Cancelled and no-show appointments cannot be billed. Restore the booking first.');
  }
  if (!folio.lines.some((line) => line.type === 'service' && line.id === appointment.serviceId)) {
    throw new HttpError(400, "The bill must include the appointment's service.");
  }
  return appointment;
}

async function loadInvoice(id) {
  const [invoices] = await db.query('SELECT * FROM invoices WHERE id = ?', [id]);
  const invoice = invoices[0];
  if (!invoice) return null;

  const [items] = await db.query(
    `SELECT item_type AS type, item_id AS id, name, quantity, rate, line_total AS lineTotal
     FROM invoice_items WHERE invoice_id = ? ORDER BY id`,
    [id],
  );

  const [usage] = await db.query(
    `SELECT product_id AS productId, product_name AS productName, quantity, unit_value AS unitValue,
            service_id AS serviceId, service_name AS serviceName
     FROM invoice_product_usage WHERE invoice_id = ? ORDER BY id`,
    [id],
  );

  const [appointments] = await db.query(
    `SELECT a.id, DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS date,
            TIME_FORMAT(a.start_time, '%H:%i') AS startTime, e.name AS employeeName
     FROM appointments a JOIN employees e ON e.id = a.employee_id
     WHERE a.invoice_id = ? LIMIT 1`,
    [id],
  );
  const [[customer]] = invoice.customer_id
    ? await db.query('SELECT id, name, phone, stars FROM customers WHERE id = ?', [invoice.customer_id])
    : [[null]];
  const freeService = invoice.free_service_id
    ? items.find((item) => item.type === 'service' && item.id === invoice.free_service_id)
    : null;

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    createdAt: invoice.created_at,
    couponCode: invoice.coupon_code,
    appointmentId: appointments[0]?.id ?? null,
    appointment: appointments[0] ?? null,
    customer: customer ?? null,
    freeService: freeService ? { id: freeService.id, name: freeService.name } : null,
    starsEarned: invoice.stars_earned,
    items,
    usage,
    totals: {
      subtotal: invoice.subtotal,
      loyaltyDiscount: invoice.loyalty_discount,
      discount: invoice.discount,
      taxableValue: invoice.taxable_value,
      gstRate: invoice.gst_rate,
      cgst: invoice.cgst,
      sgst: invoice.sgst,
      total: invoice.total,
    },
  };
}

const HISTORY_LIMIT = 500;

router.get('/', async (req, res) => {
  const from = date(req.query.from, 'From date');
  const to = date(req.query.to, 'To date');
  if (from && to && from > to) {
    throw new HttpError(400, 'The From date must be on or before the To date.');
  }
  const search = text(req.query.q, 'Search', { max: 100 });

  const where = [];
  const params = [];
  if (from) {
    where.push('i.created_at >= ?');
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    where.push('i.created_at < ? + INTERVAL 1 DAY');
    params.push(`${to} 00:00:00`);
  }
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const digits = search.replace(/\D/g, '');
    where.push(`(i.invoice_number LIKE ? OR c.name LIKE ?${digits ? ' OR c.phone LIKE ?' : ''})`);
    params.push(like, like);
    if (digits) params.push(`%${digits}%`);
  }
  const filter = `FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
                  ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

  const [[summary]] = await db.query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(i.total), 0) AS revenue,
            COALESCE(SUM(i.cgst + i.sgst), 0) AS gst,
            COALESCE(SUM(i.discount + i.loyalty_discount), 0) AS discounts
     ${filter}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT i.id, i.invoice_number AS invoiceNumber, i.created_at AS createdAt,
            i.coupon_code AS couponCode, i.discount, i.loyalty_discount AS loyaltyDiscount,
            i.free_service_id IS NOT NULL AS freeServiceUsed, i.stars_earned AS starsEarned,
            i.cgst + i.sgst AS gst, i.total, c.name AS customerName, c.phone AS customerPhone,
            (SELECT a.id FROM appointments a WHERE a.invoice_id = i.id LIMIT 1) AS appointmentId,
            (SELECT COALESCE(SUM(quantity), 0) FROM invoice_items
              WHERE invoice_id = i.id AND item_type = 'service') AS services,
            (SELECT COALESCE(SUM(quantity), 0) FROM invoice_items
              WHERE invoice_id = i.id AND item_type = 'product') AS products
     ${filter}
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT ?`,
    [...params, HISTORY_LIMIT],
  );

  res.json({
    summary,
    limit: HISTORY_LIMIT,
    invoices: rows.map((row) => ({ ...row, freeServiceUsed: Boolean(row.freeServiceUsed) })),
  });
});

router.post('/quote', async (req, res) => {
  const { items, couponCode, freeServiceId } = req.body ?? {};
  const folio = await priceFolio(db, items ?? [], couponCode, { freeServiceId });
  res.json(folio);
});

async function lockCustomer(conn, rawCustomer) {
  const phone = normalizePhone(rawCustomer?.phone);
  if (!phone) return null;
  const name = text(rawCustomer.name, 'Customer name', { max: 100 });

  const [[existing]] = await conn.query('SELECT id, name, stars FROM customers WHERE phone = ? FOR UPDATE', [
    phone,
  ]);
  if (existing) {
    if (name && name !== existing.name) {
      await conn.query('UPDATE customers SET name = ? WHERE id = ?', [name, existing.id]);
      existing.name = name;
    }
    return existing;
  }

  if (!name) {
    throw new HttpError(400, 'Enter the customer name to add this new customer.');
  }
  const [result] = await conn.query('INSERT INTO customers (phone, name) VALUES (?, ?)', [phone, name]);
  return { id: result.insertId, name, stars: 0 };
}

router.post('/', async (req, res) => {
  const { items, couponCode, usage, freeServiceId } = req.body ?? {};
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Add at least one item before settling.');
  }
  const appointmentId = number(req.body.appointmentId, 'Appointment', { integer: true, min: 1 });

  const conn = await db.getConnection();
  let invoiceId;

  try {
    await conn.beginTransaction();

    const folio = await priceFolio(conn, items, couponCode, { lock: true, usage, freeServiceId });
    if (folio.couponError) {
      throw new HttpError(400, folio.couponError);
    }
    if (appointmentId) {
      await lockAppointmentForBilling(conn, appointmentId, folio);
    }

    const customer = await lockCustomer(conn, req.body.customer);
    if (folio.freeService) {
      if (!customer) {
        throw new HttpError(400, 'Add the customer to redeem a free service.');
      }
      if (customer.stars < STARS_FOR_FREE) {
        throw new HttpError(
          409,
          `${customer.name} has ${customer.stars} of ${STARS_FOR_FREE} stars, so a free service is not available yet.`,
        );
      }
    }

    const stockNeeded = new Map();
    const reserve = (id, name, stock, quantity) => {
      const entry = stockNeeded.get(id) ?? { name, stock, quantity: 0 };
      entry.quantity += quantity;
      stockNeeded.set(id, entry);
    };
    for (const line of folio.lines) {
      if (line.type === 'product') reserve(line.id, line.name, line.stock, line.quantity);
    }
    for (const used of folio.usage) {
      reserve(used.productId, used.productName, used.stock, used.quantity);
    }
    for (const { name, stock, quantity } of stockNeeded.values()) {
      if (quantity > stock) {
        throw new HttpError(
          409,
          `Only ${stock} of ${name} left in stock, but this bill sells and uses ${quantity}.`,
        );
      }
    }

    const t = folio.totals;
    const starsEarned = customer ? folio.starsEarned : 0;
    const [result] = await conn.query('INSERT INTO invoices SET ?', [
      {
        subtotal: t.subtotal,
        customer_id: customer?.id ?? null,
        loyalty_discount: t.loyaltyDiscount,
        free_service_id: folio.freeService?.id ?? null,
        stars_earned: starsEarned,
        coupon_code: folio.coupon?.code ?? null,
        discount: t.discount,
        taxable_value: t.taxableValue,
        gst_rate: t.gstRate,
        cgst: t.cgst,
        sgst: t.sgst,
        total: t.total,
      },
    ]);
    invoiceId = result.insertId;

    if (customer) {
      const redeemed = folio.freeService ? 1 : 0;
      await conn.query(
        `UPDATE customers
         SET stars = ?, free_services_redeemed = free_services_redeemed + ?
         WHERE id = ?`,
        [customer.stars - redeemed * STARS_FOR_FREE + starsEarned, redeemed, customer.id],
      );
    }

    const invoiceNumber = `INV-PS-${new Date().getFullYear()}-${String(invoiceId).padStart(4, '0')}`;
    await conn.query('UPDATE invoices SET invoice_number = ? WHERE id = ?', [invoiceNumber, invoiceId]);

    await conn.query(
      'INSERT INTO invoice_items (invoice_id, item_type, item_id, name, quantity, rate, line_total) VALUES ?',
      [folio.lines.map((l) => [invoiceId, l.type, l.id, l.name, l.quantity, l.rate, l.lineTotal])],
    );

    if (folio.usage.length > 0) {
      await conn.query(
        `INSERT INTO invoice_product_usage
           (invoice_id, product_id, product_name, quantity, unit_value, service_id, service_name)
         VALUES ?`,
        [
          folio.usage.map((u) => [
            invoiceId,
            u.productId,
            u.productName,
            u.quantity,
            u.unitValue,
            u.serviceId,
            u.serviceName,
          ]),
        ],
      );
    }

    for (const [productId, { quantity }] of stockNeeded) {
      await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, productId]);
    }

    if (appointmentId) {
      await conn.query("UPDATE appointments SET status = 'completed', invoice_id = ? WHERE id = ?", [
        invoiceId,
        appointmentId,
      ]);
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  res.status(201).json({ invoice: await loadInvoice(invoiceId) });
});

router.get('/:id', async (req, res) => {
  const invoice = await loadInvoice(req.params.id);
  if (!invoice) {
    return res.status(404).json({ message: 'Invoice not found.' });
  }
  res.json({ invoice });
});

module.exports = router;
