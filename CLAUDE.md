# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ABA (Appointment Booking App) for an LGU Civil Registry office, designed to integrate with an in-office queue management system (QMS). Citizens book a service slot online as guests (no accounts), receive a reference number, and check in at the office where they join the same queue as walk-ins.

The backend folder structure is scaffolded and the database schema (`backend/sql/aba_schema.sql`) is final and tested. The REST API is being built one layer at a time, so check which files have content before assuming a layer exists.

## Current scope (Milestone 11: REST API)

Build only these endpoints:

- `GET` services: id and name of active services only, for the booking form's service selector. The full catalog and requirements live on the separate Office Website.
- `GET` available slots for a service and date.
- `POST` appointments: create a booking.
- `POST` appointment cancel: cancel is an action endpoint, not `DELETE`. The citizen must send both the reference number and the email. A wrong reference number and a wrong email return the same "not found" error, so the response never reveals which reference numbers exist. Cancellation is allowed only before the appointment day (Manila time). Only pending or confirmed appointments can be cancelled. Do the cancel as one conditional `UPDATE` that puts every rule in its `WHERE` (reference number, `lower(email)` through the citizen, status pending/confirmed, schedule date after today) and uses `RETURNING`. Zero rows means it failed, and because the check and the write happen in one statement, two simultaneous cancel requests can't both succeed. Only after a zero-row result, look the booking up by reference number + email to pick the error: no match → "not found"; already cancelled → "already cancelled"; anything else (today or past, completed, no-show) → "cannot be cancelled". Saying "already cancelled" is safe because the request already proved it knows both the reference number and the email. A later milestone replaces this with a secret-token link in the confirmation email.
- Admin `POST` services: create a service. Requires the admin key header.
- Admin `POST` schedules: create schedule blocks. Accepts a repeating pattern (weekdays, hours, date range, capacity) so staff don't enter blocks one by one. Requires the admin key header.

**Out of scope for now. Do not build these:** check-in, ticket-number generation, QMS integration, staff login/auth, and the confirmation email. Because there is no email sender yet, new bookings are created with status `confirmed`. The schema default is `pending`, so the INSERT must set the status explicitly. A later milestone will add pending → confirmed via an emailed link.

## Commands

There are no npm scripts yet beyond the default failing `test`, and no linter or test framework is installed.

```bash
cd backend && npm install                         # install deps (express 5, pg, dotenv, cors)
cp backend/.env.example backend/.env              # then fill in real values
psql "$DATABASE_URL" -f backend/sql/aba_schema.sql  # create schema (fresh DB only; it does not migrate)
node backend/src/server.js                         # entry point
```

The local development database is `aba_dev`.

The frontend is plain static HTML/CSS/JS with no build step. `FRONTEND_ORIGIN=http://127.0.0.1:5500` in `.env.example` implies it's served with VS Code Live Server, so the backend must allow that origin via CORS.

## Backend architecture (planned layering)

The backend uses ES modules (`"type": "module"`). A request flows through the layers in the same order as the folder layout:

```
routes/*.routes.js → middleware (requireAdminKey for admin routes)
  → validators/*.validator.js → controllers/*.controller.js
  → models/*.model.js (SQL via db/pool.js, pg Pool) → errorHandler.js
```

`app.js` builds the Express app, and `server.js` starts listening. `utils/dates.js` handles timezone-aware dates; read the zone from `config.timezone`, don't hardcode it. (The schema's ticket index hardcodes `'Asia/Manila'`, which is fine because the database can't read the config.) `utils/referenceNumber.js` generates the short booking reference number stored in `appointments.reference_number`. Generate it randomly with crypto, never sequentially. Insert with `ON CONFLICT (reference_number) DO NOTHING RETURNING id`. Zero rows means the code collided: generate a fresh one and retry a few times before giving up. A `23505` from `uq_active_booking` still raises normally; roll back and return a clear "you already have this booking" error.

**Config:** `config/env.js` loads `.env`, validates every setting at import time (fail fast), and exports a frozen `config` object. Other modules import `config` instead of reading `process.env` directly. Admin auth is a single shared `ADMIN_KEY`. It must be at least 32 characters, and placeholder values are rejected.

**Windows:** the office has 3 windows, but only Counters 1 and 2 serve clients. Counter 3 is the **Releasing Window**: it only releases documents and never calls from the queue. Any capacity or call-next logic must use `config.serving_windows_count` (`SERVING_WINDOWS_COUNT=2`), never the total and never a hardcoded number. It is its own setting on purpose, so no logic subtracts the Releasing Window.

## Booking rules the API must enforce

- **No same-day booking.** Bookings open from tomorrow onward, in Manila time. The available-slots endpoint lists dates from tomorrow only, and create-appointment rejects a schedule dated today or earlier.
- **Slots are 1 hour long.**
- **Capacity:** for simple services (LCR forms, Certified True Copies), the default slot capacity is `floor(60 ÷ duration_minutes) × serving windows` (25 min → 2 × 2 = 4). Rounding down means a slot is never overbooked. In the admin schedules endpoint, an empty capacity is calculated with this formula, and a capacity sent by staff overrides it (for example, a day when a window is short-staffed). Consultation services (Legitimations, Corrections, Marriage License Applications, Late Registrations) have `duration_minutes = NULL` and no formula, so their request must include a capacity.
- **One service per appointment.**
- **Name normalization:** trim names and collapse repeated spaces *before* the citizen find-or-create, trim the email, and store an empty middle name or suffix as `NULL`. The identity unique index treats `NULL` and `''` alike, but the stored rows should be consistent.

## Database rules the API must respect

The schema pushes many invariants into Postgres, so read the comments in `aba_schema.sql` before writing models. These rules span multiple tables:

- **Citizens are find-or-create** by case-insensitive (email, first, middle, last, suffix). See `uq_citizens_identity`. One email can belong to several people because relatives and caregivers often book for seniors and PWDs. Use `INSERT ... ON CONFLICT (...) DO UPDATE ... RETURNING id`:
  - The conflict target must repeat the index's exact expressions: `(lower(email), lower(first_name), lower(coalesce(middle_name, '')), lower(last_name), lower(coalesce(suffix, '')))`. Plain column names will not match an expression index.
  - Latest values win: `DO UPDATE` overwrites `phone`, `is_senior`, `is_pwd`, and `updated_at`. Phone numbers change and people turn 60, and staff verify senior/PWD status at the counter anyway.
  - Don't use `DO NOTHING`: it returns no row for an existing citizen, so it would need a second query to get the id.
- **Appointments don't store service_id.** The service is derived through `schedule_id → schedules.service_id`.
- **Capacity (`schedules.slot_capacity`) is NOT enforced by the DB.** The booking API must check it inside a transaction and lock the schedule row (`SELECT ... FOR UPDATE`) to prevent overbooking. Count only pending and confirmed appointments toward capacity, so a cancelled booking frees its seat. The DB only blocks the same citizen from holding two active (pending/confirmed) bookings for one slot.
- **Never delete history.** Retire services and staff with `is_active`. Cancel appointments instead of deleting them: `cancelled_at` must be set if and only if status is `cancelled`. FKs use `RESTRICT` for this reason.
- **`updated_at` has no trigger.** The API must set it on every UPDATE.

## Queue rules (for later milestones, not M11)

These rules come from the schema and apply when check-in and QMS integration are built:

- Ticket numbers are unique per Manila calendar day. There are two daily sequences, regular (`1, 2…`) and priority (`P1, P2…`). Each is shared across the whole office, not kept per window or per service.
- **Call-next order is tier-dependent.** Senior/PWD entries come first, ordered by arrival time only: a booked priority client does **not** jump ahead of an earlier walk-in priority client. Then come booked regulars by `scheduled_time`, then walk-in regulars. The query is:
  ```sql
  ORDER BY priority_tier,
           CASE WHEN priority_tier = 'regular' THEN source END,
           CASE WHEN priority_tier = 'regular' THEN scheduled_time END,
           enqueued_at
  LIMIT 1 FOR UPDATE SKIP LOCKED
  ```
  Call-next serves from serving windows only and rejects the Releasing Window.
- Queue CHECKs tie fields together: `source='appointment'` ⇔ `appointment_id` set; `priority_tier='senior_pwd'` ⇔ `priority_check <> 'none'`; booked entries need citizen, service, and `scheduled_time`. Walk-ins have no citizen row, and their service is filled in at the window.
- At QMS integration, `queue_entries` will need a release stage (a `for_release` status plus a released outcome) to match the Releasing Window.

## Frontend

`frontend/booking-form.html` + `script/script.js` provide client-side validation driven by a `fieldConfigs` array. Each field declares `required`, `rules[]` of `{test, message}`, and success-state options. The accepted Philippine mobile format is `09XXXXXXXXX` or `+639XXXXXXXXX`. The form is not yet wired to the API (no `fetch` calls).

Styling uses design tokens in `css/tokens.css` (numbered spacing and type scales like `--spacing-16`, `--font-size-14`). `main.css` should use these tokens instead of raw values.