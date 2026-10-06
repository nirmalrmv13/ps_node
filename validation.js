const { HttpError } = require('./errors');

function text(value, label, { required = false, max = 255 } = {}) {
  const str = value == null ? '' : String(value).trim();
  if (!str) {
    if (required) throw new HttpError(400, `${label} is required.`);
    return null;
  }
  if (str.length > max) {
    throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  }
  return str;
}

function number(value, label, { required = false, min, max, integer = false } = {}) {
  if (value === '' || value == null) {
    if (required) throw new HttpError(400, `${label} is required.`);
    return null;
  }

  const num = Number(value);
  if (!Number.isFinite(num) || (integer && !Number.isInteger(num))) {
    throw new HttpError(400, `${label} must be a ${integer ? 'whole ' : ''}number.`);
  }
  if (min != null && num < min) throw new HttpError(400, `${label} must be at least ${min}.`);
  if (max != null && num > max) throw new HttpError(400, `${label} must be at most ${max}.`);
  return num;
}

function date(value, label, { required = false } = {}) {
  const str = value == null ? '' : String(value).trim();
  if (!str) {
    if (required) throw new HttpError(400, `${label} is required.`);
    return null;
  }
  const parsed = new Date(`${str}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== str) {
    throw new HttpError(400, `${label} must be a valid date.`);
  }
  return str;
}

/** Parses "HH:MM" and returns minutes since midnight. */
function time(value, label, { required = false } = {}) {
  const str = value == null ? '' : String(value).trim();
  if (!str) {
    if (required) throw new HttpError(400, `${label} is required.`);
    return null;
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(str);
  if (!match) throw new HttpError(400, `${label} must be a valid time.`);
  return Number(match[1]) * 60 + Number(match[2]);
}

module.exports = { text, number, date, time };
