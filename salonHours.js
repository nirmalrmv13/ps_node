const { time } = require('./validation');

const toClock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const toDisplayTime = (minutes) => {
  const hours = Math.floor(minutes / 60);
  return `${hours % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
};

const opensAt = time(process.env.SALON_OPENS_AT || '09:00', 'SALON_OPENS_AT');
const closesAt = time(process.env.SALON_CLOSES_AT || '21:00', 'SALON_CLOSES_AT');
if (closesAt <= opensAt) {
  throw new Error('SALON_CLOSES_AT must be later than SALON_OPENS_AT.');
}

module.exports = { opensAt, closesAt, toClock, toDisplayTime };
