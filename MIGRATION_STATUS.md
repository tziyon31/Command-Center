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

## שלב 4 — בדיקות מודול (ידני + תיקוני API)

- [x] 4.1 — Auth + Users (API verified; invite allows admin + office_manager)
- [ ] 4.2 — Clients
- [ ] 4.3 — Inquiries
- [ ] 4.4 — Projects
- [ ] 4.5 — Proposals
- [ ] 4.6 — Signed Proposals
- [ ] 4.7 — Work Stages
- [ ] 4.8 — Invoices
- [ ] 4.9 — Collections
- [ ] 4.10 — Dashboard
- [ ] 4.11 — Reminders

## שלב 5 — תכונות מיוחדות

- [ ] 5.1 — inviteUser
- [ ] 5.2 — bulkCreate (אופציונלי)

## שלב 6 — Audit + Reminders

- [ ] 6.1 — דפי audit על DB ריק
- [ ] 6.2 — reminder engine עם נתונים ידניים

## שלב 7 — ניקוי Base44

- [ ] 7.1 — הסרת Base44 מהפרונט

## שלב 8 — Production (אופציונלי)

- [ ] 8.x — Deploy backend + frontend (Vercel + Railway/Render)

---

**Admin seed (אחרי 1.3):** `admin@local.test` — סיסמה תתועד ב-`backend/README.md`
