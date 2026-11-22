const db = require('./db');
const { time } = require('./validation');

const DEFAULTS = {
  businessName: process.env.BUSINESS_NAME || 'Pro Signature Unisex Salon',
  shortName: process.env.BUSINESS_SHORT_NAME || 'Pro Signature',
  tagline: process.env.BUSINESS_TAGLINE || 'Your Look, Our Signature',
  address: process.env.BUSINESS_ADDRESS || '',
  phone: process.env.BUSINESS_PHONE || '',
  email: process.env.BUSINESS_EMAIL || '',
  logoUrl: process.env.BUSINESS_LOGO_URL || '',
  weekdayOpensAt: time(process.env.SALON_WEEKDAY_OPENS_AT || '10:00', 'weekday opens'),
  weekdayClosesAt: time(process.env.SALON_WEEKDAY_CLOSES_AT || '18:00', 'weekday closes'),
  weekendOpensAt: time(process.env.SALON_WEEKEND_OPENS_AT || '09:00', 'weekend opens'),
  weekendClosesAt: time(process.env.SALON_WEEKEND_CLOSES_AT || '18:00', 'weekend closes'),
  gstin: process.env.BUSINESS_GSTIN || '',
};

let cache = null;
let cacheAt = 0;
const TTL_MS = 30_000;

function toClock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function toDisplayTime(minutes) {
  const hours = Math.floor(minutes / 60);
  return `${hours % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

function clockFromSql(value, fallbackMinutes) {
  if (value == null || value === '') return fallbackMinutes;
  if (typeof value === 'number') return value;
  const text = String(value);
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallbackMinutes;
  return Number(match[1]) * 60 + Number(match[2]);
}

function mapRow(row) {
  return {
    businessName: row.business_name || DEFAULTS.businessName,
    shortName: row.short_name || DEFAULTS.shortName,
    tagline: row.tagline ?? DEFAULTS.tagline,
    address: row.address ?? DEFAULTS.address,
    phone: row.phone ?? DEFAULTS.phone,
    email: row.email ?? DEFAULTS.email,
    logoUrl: row.logo_url ?? DEFAULTS.logoUrl,
    weekdayOpensAt: clockFromSql(row.weekday_opens_at, DEFAULTS.weekdayOpensAt),
    weekdayClosesAt: clockFromSql(row.weekday_closes_at, DEFAULTS.weekdayClosesAt),
    weekendOpensAt: clockFromSql(row.weekend_opens_at, DEFAULTS.weekendOpensAt),
    weekendClosesAt: clockFromSql(row.weekend_closes_at, DEFAULTS.weekendClosesAt),
    gstin: row.gstin ?? DEFAULTS.gstin,
  };
}

function isWeekendDate(dateStr) {
  const day = new Date(`${dateStr}T12:00:00+05:30`).getDay();
  return day === 0 || day === 6;
}

function hoursForDate(settings, dateStr) {
  if (dateStr && isWeekendDate(dateStr)) {
    return { opensAt: settings.weekendOpensAt, closesAt: settings.weekendClosesAt };
  }
  return { opensAt: settings.weekdayOpensAt, closesAt: settings.weekdayClosesAt };
}

function hoursSchedule(settings) {
  return [
    {
      day: 'Monday – Friday',
      time: `${toDisplayTime(settings.weekdayOpensAt)} – ${toDisplayTime(settings.weekdayClosesAt)}`,
      opensAt: toClock(settings.weekdayOpensAt),
      closesAt: toClock(settings.weekdayClosesAt),
    },
    {
      day: 'Saturday – Sunday',
      time: `${toDisplayTime(settings.weekendOpensAt)} – ${toDisplayTime(settings.weekendClosesAt)}`,
      opensAt: toClock(settings.weekendOpensAt),
      closesAt: toClock(settings.weekendClosesAt),
    },
  ];
}

async function getStoreSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const [rows] = await db.query(
      `SELECT business_name, short_name, tagline, address, phone, email, logo_url,
              weekday_opens_at, weekday_closes_at, weekend_opens_at, weekend_closes_at, gstin
       FROM store_settings WHERE id = 1 LIMIT 1`,
    );
    cache = rows[0] ? mapRow(rows[0]) : { ...DEFAULTS };
  } catch (err) {
    console.warn('store_settings unavailable, using defaults:', err.message);
    cache = { ...DEFAULTS };
  }
  cacheAt = Date.now();
  return cache;
}

function clearStoreSettingsCache() {
  cache = null;
  cacheAt = 0;
}

function publicStorePayload(settings, { today } = {}) {
  const todayHours = hoursForDate(settings, today);
  return {
    businessName: settings.businessName,
    shortName: settings.shortName,
    tagline: settings.tagline,
    address: settings.address,
    phone: settings.phone,
    email: settings.email,
    logoUrl: settings.logoUrl,
    gstin: settings.gstin,
    hours: hoursSchedule(settings),
    weekdayOpensAt: toClock(settings.weekdayOpensAt),
    weekdayClosesAt: toClock(settings.weekdayClosesAt),
    weekendOpensAt: toClock(settings.weekendOpensAt),
    weekendClosesAt: toClock(settings.weekendClosesAt),
    opensAt: toClock(todayHours.opensAt),
    closesAt: toClock(todayHours.closesAt),
  };
}

module.exports = {
  DEFAULTS,
  getStoreSettings,
  clearStoreSettingsCache,
  hoursForDate,
  hoursSchedule,
  publicStorePayload,
  isWeekendDate,
  toClock,
  toDisplayTime,
};
