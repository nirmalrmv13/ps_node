const mysql = require('mysql2/promise');

const host = process.env.DB_HOST || 'localhost';
const isLocal = host === 'localhost' || host === '127.0.0.1';

// TiDB Cloud (and other remote hosts) require TLS; local MySQL does not.
const ssl = isLocal
  ? undefined
  : { minVersion: 'TLSv1.2', rejectUnauthorized: true };

const pool = mysql.createPool({
  host,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  ssl,
  decimalNumbers: true,
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
