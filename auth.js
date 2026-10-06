const jwt = require('jsonwebtoken');
const { HttpError } = require('./errors');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

if (!SECRET) {
  throw new Error('JWT_SECRET is not set. Add it to backend/.env.');
}

function signToken(user) {
  return jwt.sign({ role: user.role, name: user.name }, SECRET, {
    subject: String(user.id),
    expiresIn: EXPIRES_IN,
  });
}

function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Please log in to continue.'));
  }

  try {
    const payload = jwt.verify(token, SECRET);
    req.user = { id: Number(payload.sub), role: payload.role, name: payload.name };
    next();
  } catch {
    next(new HttpError(401, 'Your session has expired. Please log in again.'));
  }
}

function requireRole(role) {
  return (req, res, next) =>
    req.user?.role === role
      ? next()
      : next(new HttpError(403, 'You do not have permission to do that.'));
}

const isAdmin = (req) => req.user?.role === 'admin';

module.exports = { signToken, requireAuth, requireRole, isAdmin };
