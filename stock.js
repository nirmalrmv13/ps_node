async function recordAdjustment(conn, { productId, reason, change, stockAfter, note = null, userId = null }) {
  const [result] = await conn.query(
    `INSERT INTO stock_adjustments (product_id, reason, quantity_change, stock_after, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [productId, reason, change, stockAfter, note, userId],
  );
  return result.insertId;
}

module.exports = { recordAdjustment };
