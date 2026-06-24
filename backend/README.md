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
