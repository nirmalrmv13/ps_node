/**
 * The membership giving the customer a discount today, if any. `validUntil` also
 * covers renewals bought in advance, which start the day after the current one ends.
 */
async function activeMembership(conn, customerId) {
  if (!customerId) return null;
  const [[membership]] = await conn.query(
    `SELECT m.id, m.plan_name AS planName, m.discount_percent AS discountPercent,
            DATE_FORMAT(m.start_date, '%Y-%m-%d') AS startDate, DATE_FORMAT(m.end_date, '%Y-%m-%d') AS endDate,
            (SELECT DATE_FORMAT(MAX(end_date), '%Y-%m-%d') FROM customer_memberships
              WHERE customer_id = m.customer_id) AS validUntil
     FROM customer_memberships m
     WHERE m.customer_id = ? AND m.start_date <= CURDATE() AND m.end_date >= CURDATE()
     ORDER BY m.discount_percent DESC, m.end_date DESC
     LIMIT 1`,
    [customerId],
  );
  return membership ?? null;
}

/** Records a membership for a customer, queued after any membership they already hold. */
async function addMembership(conn, { customerId, plan, invoiceId = null, pricePaid }) {
  const [[{ startDate }]] = await conn.query(
    `SELECT DATE_FORMAT(GREATEST(CURDATE(), COALESCE(MAX(end_date) + INTERVAL 1 DAY, CURDATE())), '%Y-%m-%d')
              AS startDate
     FROM customer_memberships WHERE customer_id = ?`,
    [customerId],
  );
  const paid = pricePaid ?? plan.rate ?? plan.price ?? 0;
  const [result] = await conn.query(
    `INSERT INTO customer_memberships
       (customer_id, plan_id, plan_name, discount_percent, price_paid, start_date, end_date, invoice_id)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL ? DAY), ?)`,
    [
      customerId,
      plan.id,
      plan.name,
      plan.discountPercent,
      paid,
      startDate,
      startDate,
      plan.durationDays - 1,
      invoiceId,
    ],
  );
  return {
    id: result.insertId,
    startDate,
    endDate: null,
    pricePaid: paid,
  };
}

async function previewMembershipDates(conn, customerId, durationDays) {
  const [[{ startDate }]] = await conn.query(
    `SELECT DATE_FORMAT(GREATEST(CURDATE(), COALESCE(MAX(end_date) + INTERVAL 1 DAY, CURDATE())), '%Y-%m-%d')
              AS startDate
     FROM customer_memberships WHERE customer_id = ?`,
    [customerId],
  );
  const [[row]] = await conn.query(
    `SELECT DATE_FORMAT(DATE_ADD(?, INTERVAL ? DAY), '%Y-%m-%d') AS endDate`,
    [startDate, durationDays - 1],
  );
  return { startDate, endDate: row.endDate };
}

module.exports = { activeMembership, addMembership, previewMembershipDates };
