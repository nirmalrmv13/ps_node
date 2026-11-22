const mysql = require('mysql2/promise');

async function main() {
  const host = process.env.DB_HOST || 'localhost';
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const connection = await mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'serene_sanctuary',
    ssl: isLocal ? undefined : { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  });

  try {
    const [rows] = await connection.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'location'`,
    );
    if (rows.length === 0) {
      await connection.query(
        'ALTER TABLE customers ADD COLUMN location VARCHAR(120) NULL AFTER birthday',
      );
      console.log('Added customers.location.');
    } else {
      console.log('customers.location already exists.');
    }
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
