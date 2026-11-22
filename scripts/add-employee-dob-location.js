const mysql = require('mysql2/promise');

async function ensureColumn(connection, table, column, definition) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  if (rows.length === 0) {
    await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Added ${table}.${column}.`);
  } else {
    console.log(`${table}.${column} already exists.`);
  }
}

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
    await ensureColumn(connection, 'employees', 'date_of_birth', 'DATE NULL AFTER email');
    await ensureColumn(connection, 'employees', 'location', 'VARCHAR(120) NULL AFTER date_of_birth');
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
