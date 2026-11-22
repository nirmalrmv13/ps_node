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
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'membership_price'`,
    );
    if (rows.length === 0) {
      await connection.query(
        'ALTER TABLE services ADD COLUMN membership_price DECIMAL(10, 2) NULL AFTER price',
      );
      console.log('Added services.membership_price column.');
    } else {
      console.log('services.membership_price already exists.');
    }

    const [result] = await connection.query(
      'UPDATE services SET membership_price = ROUND(price * 0.85, 2) WHERE membership_price IS NULL',
    );
    console.log(`Backfilled membership_price on ${result.affectedRows} service(s).`);

    const [sample] = await connection.query(
      'SELECT name, price, membership_price AS membershipPrice FROM services ORDER BY id LIMIT 5',
    );
    console.table(sample);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
