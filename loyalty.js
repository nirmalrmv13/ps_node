const { HttpError } = require('./errors');

const STARS_FOR_FREE = Number(process.env.LOYALTY_STARS_FOR_FREE) || 5;

/** Reduces a mobile number to its digits so "+91 98765-43210" and "9876543210" match. */
function normalizePhone(value, { required = false } = {}) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) {
    if (required) throw new HttpError(400, 'Customer mobile number is required.');
    return null;
  }
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length < 10 || digits.length > 15) {
    throw new HttpError(400, 'Customer mobile number must have 10 to 15 digits.');
  }
  return digits;
}

module.exports = { STARS_FOR_FREE, normalizePhone };
