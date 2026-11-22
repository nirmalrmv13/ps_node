/** @deprecated Prefer storeSettings.hoursForDate — kept for shared clock helpers. */
const { toClock, toDisplayTime, DEFAULTS } = require('./storeSettings');

module.exports = {
  opensAt: DEFAULTS.weekdayOpensAt,
  closesAt: DEFAULTS.weekdayClosesAt,
  toClock,
  toDisplayTime,
};
