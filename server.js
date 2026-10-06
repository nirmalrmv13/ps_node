const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { requireAuth, requireRole, signToken } = require('./auth');
const { GST_RATE } = require('./billing');
const servicesRouter = require('./routes/services');
const productsRouter = require('./routes/products');
const couponsRouter = require('./routes/coupons');
const employeesRouter = require('./routes/employees');
const appointmentsRouter = require('./routes/appointments');
const inventoryRouter = require('./routes/inventory');
const customersRouter = require('./routes/customers');
const { STARS_FOR_FREE } = require('./loyalty');
const { closesAt, opensAt, toClock } = require('./salonHours');
const invoicesRouter = require('./routes/invoices');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from the backend' });
});

app.post('/api/login', async (req, res) => {
  const { identifier, password } = req.body ?? {};

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Please enter your username or email and password.' });
  }

  try {
    const id = identifier.trim();
    const [rows] = await db.query(
      'SELECT id, username, email, full_name, role, password_hash FROM users WHERE username = ? OR email = ? LIMIT 1',
      [id, id],
    );
    const row = rows[0];

    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const user = {
      id: row.id,
      username: row.username,
      email: row.email,
      name: row.full_name,
      role: row.role,
    };
    res.json({ token: signToken(user), user });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    businessName: process.env.BUSINESS_NAME || 'Pro Signature Unisex Salon',
    tagline: process.env.BUSINESS_TAGLINE || 'Your Look, Our Signature',
    gstin: process.env.BUSINESS_GSTIN || '',
    terminal: process.env.POS_TERMINAL || '',
    register: process.env.POS_REGISTER || '',
    cashFloat: Number(process.env.POS_CASH_FLOAT) || 0,
    gstRate: GST_RATE,
    opensAt: toClock(opensAt),
    closesAt: toClock(closesAt),
    loyaltyStarsForFree: STARS_FOR_FREE,
  });
});

app.use('/api/services', requireAuth, servicesRouter);
app.use('/api/products', requireAuth, productsRouter);
app.use('/api/coupons', requireAuth, couponsRouter);
app.use('/api/employees', requireAuth, employeesRouter);
app.use('/api/appointments', requireAuth, appointmentsRouter);
app.use('/api/inventory', requireAuth, requireRole('admin'), inventoryRouter);
app.use('/api/customers', requireAuth, customersRouter);
app.use('/api/invoices', requireAuth, invoicesRouter);

app.use((err, req, res, next) => {
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ message: err.message });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'A record with the same name or code already exists.' });
  }
  console.error(`${req.method} ${req.originalUrl} failed:`, err.message);
  res.status(500).json({ message: 'Something went wrong. Please try again later.' });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
