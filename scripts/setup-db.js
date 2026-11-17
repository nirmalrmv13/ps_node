const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const seedUsers = [
  { envPrefix: 'ADMIN', role: 'admin' },
  { envPrefix: 'STAFF', role: 'staff' },
];

async function ensureColumn(connection, table, column, definition) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  if (rows.length === 0) {
    await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Added ${table}.${column} column.`);
  }
}

async function ensureEnum(connection, table, column, values) {
  const [rows] = await connection.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  if (!rows[0]) return;
  const wanted = values.map((v) => `'${v}'`).join(',');
  if (rows[0].COLUMN_TYPE === `enum(${wanted})`) return;
  await connection.query(
    `ALTER TABLE ${table} MODIFY COLUMN ${column} ENUM(${wanted}) NOT NULL`,
  );
  console.log(`Updated ${table}.${column} enum.`);
}

async function upsertUser(connection, { envPrefix, role }) {
  const username = process.env[`${envPrefix}_USERNAME`];
  const email = process.env[`${envPrefix}_EMAIL`];
  const name = process.env[`${envPrefix}_NAME`];
  const password = process.env[`${envPrefix}_PASSWORD`];

  if (!username || !email || !password) {
    console.log(`${envPrefix}_* variables not set in .env, skipping ${role} user.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await connection.query(
    `INSERT INTO users (username, email, full_name, role, password_hash)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       full_name = VALUES(full_name), role = VALUES(role), password_hash = VALUES(password_hash)`,
    [username, email, name || null, role, passwordHash],
  );
  console.log(`${role === 'admin' ? 'Admin' : 'Staff'} user "${username}" is ready.`);
}

async function main() {
  const host = process.env.DB_HOST || 'localhost';
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const ssl = isLocal
    ? undefined
    : { minVersion: 'TLSv1.2', rejectUnauthorized: true };

  const connection = await mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    ssl,
    multipleStatements: true,
  });

  try {
    const sqlDir = path.join(__dirname, '..', 'sql');
    await connection.query(fs.readFileSync(path.join(sqlDir, 'schema.sql'), 'utf8'));
    await connection.query(fs.readFileSync(path.join(sqlDir, 'landing_images.sql'), 'utf8'));
    await connection.query(fs.readFileSync(path.join(sqlDir, 'landing_images_seed.sql'), 'utf8'));
    await connection.query(
      `UPDATE landing_images
       SET image_url = CONCAT('/api/public/landing-media/', SUBSTRING_INDEX(image_url, '/', -1))
       WHERE image_url LIKE '/landing/%'`,
    );
    await ensureColumn(
      connection,
      'users',
      'role',
      "ENUM('admin', 'staff') NOT NULL DEFAULT 'staff' AFTER full_name",
    );
    await ensureColumn(connection, 'invoices', 'customer_id', 'INT UNSIGNED AFTER subtotal');
    await ensureColumn(
      connection,
      'invoices',
      'loyalty_discount',
      'DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER customer_id',
    );
    await ensureColumn(connection, 'invoices', 'free_service_id', 'INT UNSIGNED AFTER loyalty_discount');
    await ensureColumn(
      connection,
      'invoices',
      'stars_earned',
      'SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER free_service_id',
    );
    await ensureColumn(
      connection,
      'invoices',
      'membership_discount',
      'DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER stars_earned',
    );
    await ensureColumn(connection, 'invoices', 'membership_name', 'VARCHAR(100) AFTER membership_discount');
    await ensureColumn(connection, 'customers', 'email', 'VARCHAR(255) AFTER name');
    await ensureColumn(connection, 'customers', 'gender', "ENUM('female', 'male', 'other') AFTER email");
    await ensureColumn(connection, 'customers', 'birthday', 'DATE AFTER gender');
    await ensureColumn(connection, 'customers', 'notes', 'VARCHAR(1000) AFTER birthday');
    await ensureEnum(connection, 'invoice_items', 'item_type', ['service', 'product', 'membership']);
    console.log('Database and tables are ready.');

    await connection.query(fs.readFileSync(path.join(sqlDir, 'seed.sql'), 'utf8'));
    console.log('Sample services, products, coupons, employees and membership plans are loaded.');

    for (const seedUser of seedUsers) {
      await upsertUser(connection, seedUser);
    }
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('Database setup failed:', err.message);
  process.exit(1);
});
