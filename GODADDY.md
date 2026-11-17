# Deploy as one website on GoDaddy

Frontend + backend run as **one Node.js app** on a single GoDaddy Web Hosting plan.

```text
https://yourdomain.com          → React (./client)
https://yourdomain.com/api/...  → Express API
```

## 1. Prepare the zip (on your PC)

From `ps_node/ps_node`:

```bash
npm run prepare:godaddy
```

This builds `ps_react` with empty `VITE_API_URL` (same-origin `/api`) and copies it into `./client`.

Zip **this folder** (`ps_node/ps_node`), excluding:

- `node_modules/`
- `.env`
- any local secrets

Keep `client/`, `public/`, `package.json`, and all `.js` / `sql` source files.

## 2. Upload to GoDaddy Node.js Hosting

1. GoDaddy → Web Hosting → Node.js Hosting  
2. Create / upload app (zip or GitHub)  
3. Platform runs `npm install`, then `npm run build`, then `npm start`  
4. App must listen on `process.env.PORT` (already configured)

## 3. Environment variables (GoDaddy dashboard)

Set at least:

| Variable | Example |
| --- | --- |
| `JWT_SECRET` | long random string |
| `DB_HOST` | your MySQL / TiDB host |
| `DB_PORT` | `3306` or `4000` |
| `DB_USER` | db user |
| `DB_PASSWORD` | db password |
| `DB_NAME` | database name |
| `CORS_ORIGIN` | `https://yourdomain.com` |
| `BUSINESS_NAME` | optional |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | only needed for `db:setup` |

Do **not** set `VITE_API_URL` on the server; the built client already uses relative `/api`.

## 4. Database

- Create MySQL on GoDaddy **or** keep TiDB Cloud  
- Run schema once (from a machine that can reach the DB):

```bash
npm run db:setup
```

(Uses local `.env` with the same `DB_*` values.)

## 5. Publish domain

Connect your domain in GoDaddy Node.js Hosting and open the site.  
Landing, `/book`, and staff login all share the same origin.
