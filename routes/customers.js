const express = require('express');
const db = require('../db');
const { STARS_FOR_FREE, normalizePhone } = require('../loyalty');

const router = express.Router();

router.get('/lookup', async (req, res) => {
  const phone = normalizePhone(req.query.phone, { required: true });
  const [[customer]] = await db.query(
    `SELECT c.id, c.name, c.phone, c.stars, c.free_services_redeemed AS freeServicesRedeemed,
            COUNT(i.id) AS visits, MAX(i.created_at) AS lastVisit
     FROM customers c
     LEFT JOIN invoices i ON i.customer_id = c.id
     WHERE c.phone = ?
     GROUP BY c.id`,
    [phone],
  );
  res.json({ starsForFree: STARS_FOR_FREE, customer: customer ?? null });
});

module.exports = router;
