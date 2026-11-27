const fs = require('node:fs');
const path = require('node:path');
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
const { getStoreSettings, publicStorePayload } = require('./storeSettings');
const { isWhatsAppConfigured } = require('./whatsapp');
const storeSettingsRouter = require('./routes/storeSettings');
const invoicesRouter = require('./routes/invoices');
const { servePublicInvoicePdf } = invoicesRouter;
const membershipPlansRouter = require('./routes/membershipPlans');
const suppliersRouter = require('./routes/suppliers');
const purchasesRouter = require('./routes/purchases');
const reportsRouter = require('./routes/reports');
const landingImagesRouter = require('./routes/landingImages');
const landingUploadRouter = require('./routes/landingUpload');
const publicBookingRouter = require('./routes/publicBooking');

const app = express();
const PORT = process.env.PORT || 5000;

const clientDir = path.join(__dirname, 'client');
const clientIndex = path.join(clientDir, 'index.html');
const serveClient = fs.existsSync(clientIndex);

// Same-origin deploy (GoDaddy) needs no CORS; set CORS_ORIGIN when FE/API differ.
app.use(cors({ origin: process.env.CORS_ORIGIN || (serveClient ? false : true) }));
app.use(express.json());
app.use(
  '/api/public/landing-media',
  express.static(path.join(__dirname, 'public', 'landing'), {
    fallthrough: false,
    maxAge: '7d',
  }),
);

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

app.get('/api/config', async (req, res) => {
  try {
    const settings = await getStoreSettings();
    const store = publicStorePayload(settings);
    res.json({
      ...store,
      terminal: process.env.POS_TERMINAL || '',
      register: process.env.POS_REGISTER || '',
      cashFloat: Number(process.env.POS_CASH_FLOAT) || 0,
      gstRate: GST_RATE,
      loyaltyStarsForFree: STARS_FOR_FREE,
      /** True when GETECHO_API_KEY is set (GetEcho WA Gateway). */
      whatsappAutoSend: isWhatsAppConfigured(),
    });
  } catch (err) {
    console.error('Config failed:', err.message);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
});

app.get('/api/public/landing-images', async (req, res) => {
  try {
    const [images] = await db.query(
      `SELECT id, section, title, alt_text AS altText, image_url AS imageUrl, sort_order AS sortOrder
       FROM landing_images
       WHERE is_active = 1
       ORDER BY section, sort_order, id`,
    );
    res.json({ count: images.length, images });
  } catch (err) {
    console.error('Public landing images failed:', err.message);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
});

app.get('/api/public/invoices/:id/pdf', async (req, res, next) => {
  try {
    await servePublicInvoicePdf(req, res);
  } catch (err) {
    next(err);
  }
});
app.use('/api/public', publicBookingRouter);
app.use('/api/services', requireAuth, servicesRouter);
app.use('/api/products', requireAuth, productsRouter);
app.use('/api/coupons', requireAuth, couponsRouter);
app.use('/api/employees', requireAuth, employeesRouter);
app.use('/api/appointments', requireAuth, appointmentsRouter);
app.use('/api/inventory', requireAuth, requireRole('admin'), inventoryRouter);
app.use('/api/customers', requireAuth, customersRouter);
app.use('/api/invoices', requireAuth, invoicesRouter);
app.use('/api/membership-plans', requireAuth, membershipPlansRouter);
app.use('/api/suppliers', requireAuth, requireRole('admin'), suppliersRouter);
app.use('/api/purchases', requireAuth, requireRole('admin'), purchasesRouter);
app.use('/api/reports', requireAuth, requireRole('admin'), reportsRouter);
app.use('/api/landing-images/upload', requireAuth, requireRole('admin'), landingUploadRouter);
app.use('/api/landing-images', requireAuth, requireRole('admin'), landingImagesRouter);
app.use('/api/store-settings', requireAuth, requireRole('admin'), storeSettingsRouter);

if (serveClient) {
  app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    res.sendFile(clientIndex, (err) => (err ? next(err) : undefined));
  });
}

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
  if (serveClient) {
    console.log('Serving React client from ./client (single-site mode)');
  }
});
