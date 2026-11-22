const express = require('express');
const db = require('../db');
const { HttpError } = require('../errors');
const {
  clearStoreSettingsCache,
  getStoreSettings,
  publicStorePayload,
  toClock,
} = require('../storeSettings');
const { text, time } = require('../validation');

const router = express.Router();

function assertRange(opensAt, closesAt, label) {
  if (closesAt <= opensAt) {
    throw new HttpError(400, `${label} closing time must be later than opening time.`);
  }
}

router.get('/', async (req, res) => {
  const settings = await getStoreSettings({ fresh: true });
  res.json({ store: publicStorePayload(settings) });
});

router.put('/', async (req, res) => {
  const body = req.body ?? {};
  const businessName = text(body.businessName, 'Shop name', { required: true, max: 120 });
  const shortName = text(body.shortName, 'Short name', { required: true, max: 80 });
  const tagline = text(body.tagline, 'Tagline', { max: 160 });
  const address = text(body.address, 'Address', { max: 500 });
  const phone = text(body.phone, 'Phone', { max: 30 });
  const email = text(body.email, 'Email', { max: 255 });
  const logoUrl = text(body.logoUrl, 'Logo URL', { max: 1000 });
  const gstin = text(body.gstin, 'GSTIN', { max: 30 });

  const weekdayOpensAt = time(body.weekdayOpensAt || '10:00', 'Weekday opens', { required: true });
  const weekdayClosesAt = time(body.weekdayClosesAt || '18:00', 'Weekday closes', { required: true });
  const weekendOpensAt = time(body.weekendOpensAt || '09:00', 'Weekend opens', { required: true });
  const weekendClosesAt = time(body.weekendClosesAt || '18:00', 'Weekend closes', { required: true });
  assertRange(weekdayOpensAt, weekdayClosesAt, 'Weekday');
  assertRange(weekendOpensAt, weekendClosesAt, 'Weekend');

  await db.query(
    `INSERT INTO store_settings (
       id, business_name, short_name, tagline, address, phone, email, logo_url,
       weekday_opens_at, weekday_closes_at, weekend_opens_at, weekend_closes_at, gstin
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       business_name = VALUES(business_name),
       short_name = VALUES(short_name),
       tagline = VALUES(tagline),
       address = VALUES(address),
       phone = VALUES(phone),
       email = VALUES(email),
       logo_url = VALUES(logo_url),
       weekday_opens_at = VALUES(weekday_opens_at),
       weekday_closes_at = VALUES(weekday_closes_at),
       weekend_opens_at = VALUES(weekend_opens_at),
       weekend_closes_at = VALUES(weekend_closes_at),
       gstin = VALUES(gstin)`,
    [
      businessName,
      shortName,
      tagline || '',
      address || '',
      phone || '',
      email || '',
      logoUrl || '',
      `${toClock(weekdayOpensAt)}:00`,
      `${toClock(weekdayClosesAt)}:00`,
      `${toClock(weekendOpensAt)}:00`,
      `${toClock(weekendClosesAt)}:00`,
      gstin || '',
    ],
  );

  clearStoreSettingsCache();
  const settings = await getStoreSettings({ fresh: true });
  res.json({ store: publicStorePayload(settings) });
});

module.exports = router;
