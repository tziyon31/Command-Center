# Migration Status — Base44 → Self-hosted Backend

PostgreSQL (Aiven) + Node/Express + Prisma. DB ריק — אין מיגרציית נתונים מ-Base44.

## שלב 0 — הכנה

- [x] A1-A3 — Aiven + `backend/.env` (DATABASE_URL, JWT_SECRET, PORT, FRONTEND_URL)
- [x] 0.1 — אימות frontend (`npm install`, `npm run dev`) + קובץ זה
- [x] 0.2 — השבתת AI Assistant (nav + route)
- [x] 0.3 — השבתת file upload/extract (Clients, InvoiceUpload)

## שלב 1 — Backend + DB ריק

- [x] 1.1 — `backend/` + Express `/health`
- [x] 1.2 — Prisma schema (17 entities) + migrate ל-Aiven
- [x] 1.3 — Seed admin בלבד

## שלב 2 — API

- [x] 2.1 — Generic entity CRUD + filter + sort + pagination
- [x] 2.2 — Auth (login, me, invite)

## שלב 3 — Frontend Adapter

- [x] 3.1 — `apiClient.js`
- [x] 3.2 — החלפת imports (`base44` → `api`)
- [x] 3.3 — AuthContext + `Login.jsx`
- [x] 3.4 — Vite proxy, הסרת חבילות Base44

## שלב 4 — בדיקות מודול (API smoke test ✅)

- [x] 4.1 — Auth + Users
- [x] 4.2 — Clients
- [x] 4.3 — Inquiries
- [x] 4.4 — Projects
- [x] 4.5 — Proposals
- [x] 4.6 — Signed Proposals
- [x] 4.7 — Work Stages
- [x] 4.8 — Invoices
- [x] 4.9 — Collections
- [x] 4.10 — Dashboard (tasks, quotes)
- [x] 4.11 — Reminders + ReminderSettings

> הרצה: `backend/scripts/smoke-test.sh`

## שלב 5 — תכונות מיוחדות

- [x] 5.1 — inviteUser
- [x] 5.2 — bulkCreate

## שלב 6 — Audit + Reminders

- [x] 6.1 — דפי audit (API lists OK; UI לא נבדק בדפדפן)
- [ ] 6.2 — reminder engine end-to-end (דורש flow ידני: inquiry→project→status)

## שלב 7 — ניקוי Base44

- [x] 7.1 — הסרת Base44 מהפרונט (`base44Client.js`, `app-params.js`, packages)

## שלב 8 — Production (אופציונלי)

- [x] 8.x — Deploy backend (Render) + frontend (Vercel) + `VITE_API_URL`

---

**Admin seed (אחרי 1.3):** `admin@local.test` — סיסמה תתועד ב-`backend/README.md`
