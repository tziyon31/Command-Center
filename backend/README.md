# Command Center Backend

Node.js + Express + Prisma + PostgreSQL (Aiven).

## Setup

```bash
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, FRONTEND_URL
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

## Seed admin

| Field | Value |
|-------|-------|
| Email | `admin@local.test` |
| Password | `Admin123!` |
| Role | `admin` |

## API

- `GET /health` — no auth
- `POST /api/auth/login` — `{ email, password }`
- `GET /api/auth/me` — Bearer token
- `POST /api/auth/invite` — admin only
- `GET/POST/PUT/DELETE /api/entities/:entityName` — Bearer token

Example:

```bash
curl -s http://localhost:3001/health
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.test","password":"Admin123!"}' | jq -r .token)
curl -s http://localhost:3001/api/entities/clients -H "Authorization: Bearer $TOKEN"
```

## Render deploy

### Option A — Docker (recommended if Start Command keeps failing)

**Settings → General:**
- Environment: `Docker`
- Root Directory: `backend`
- Dockerfile Path: `Dockerfile`

Clear custom **Build Command** and **Start Command** (Docker uses `CMD` from Dockerfile).

### Option B — Node

**Settings → Build & Deploy** (Root Directory: `backend`):

| Field | Value |
|-------|-------|
| Build Command | `npm install && npm run build` |
| Start Command | `bash start.sh` |

**Wrong** (exits without a server): `npm install && npx prisma generate && npx prisma migrate deploy`

Required env vars: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`

