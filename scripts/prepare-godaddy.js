/**
 * Builds the separate React app and copies dist into ./client
 * so one GoDaddy Node.js hosting slot can serve frontend + API.
 *
 * Usage (from ps_node/ps_node):
 *   node scripts/prepare-godaddy.js
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.join(__dirname, '..');
const frontendRoot = path.resolve(backendRoot, '..', '..', 'ps_react');
const distDir = path.join(frontendRoot, 'dist');
const clientDir = path.join(backendRoot, 'client');

if (!fs.existsSync(path.join(frontendRoot, 'package.json'))) {
  console.error(`Frontend not found at ${frontendRoot}`);
  process.exit(1);
}

console.log('Building frontend with empty VITE_API_URL (same-origin /api)...');
execSync('npm run build', {
  cwd: frontendRoot,
  stdio: 'inherit',
  env: { ...process.env, VITE_API_URL: '' },
});

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('Frontend build failed: dist/index.html missing.');
  process.exit(1);
}

fs.rmSync(clientDir, { recursive: true, force: true });
fs.cpSync(distDir, clientDir, { recursive: true });
console.log(`Copied ${distDir} -> ${clientDir}`);
console.log('Ready: zip this backend folder (exclude node_modules and .env) and upload to GoDaddy.');
