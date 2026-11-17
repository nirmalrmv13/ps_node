const fs = require('node:fs');
const path = require('node:path');

const indexHtml = path.join(__dirname, '..', 'client', 'index.html');
if (!fs.existsSync(indexHtml)) {
  console.error(
    'Missing client/index.html. Before uploading to GoDaddy run:\n  npm run prepare:godaddy',
  );
  process.exit(1);
}
console.log('client/ ready for single-site start');
