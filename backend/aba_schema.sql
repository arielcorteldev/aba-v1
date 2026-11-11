-- ============================================================
-- Appointment Booking App (ABA) + QMS Integration Schema
-- PostgreSQL  |  Revision 3 (applies review gaps #1 to #10)
-- ============================================================
-- NOTE: running this file against a database that already has the
-- old version will fail (tables/types already exist). Drop the old
-- tables and types first, or run it on a fresh database.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- provides gen_random_uuid()

-- ------------------------------------------------------------
-- ENUM TYPES
-- ------------------------------------------------------------

CREATE TYPE appointment_status AS ENUM (
  'pending',
  'confirmed',
  'cancelled',   -- citizen cancelled before the appointment day
  'no_show',     -- never checked in; marked by an end-of-day sweep
  'completed'
);

CREATE TYPE queue_priority_tier AS ENUM (
  'senior_pwd',  -- listed first on purpose: enums sort in declared order
  'regular'
);

CREATE TYPE queue_source AS ENUM (
  'appointment', -- listed first on purpose: booked clients sort ahead of walk-ins
  'walkin'
);

CREATE TYPE queue_status AS ENUM (
  'waiting',
  'called',
  'serving',
  'done',
  'abandoned',   -- checked in, then left or did not respond when called
  'requeued'     -- closed after a failed priority check; client takes a new regular number
);

-- Where a senior/PWD claim stands (replaces the old claims_priority + priority_verified booleans)
CREATE TYPE priority_check_status AS ENUM (
  'none',        -- no priority claim, regular client
  'pending',     -- claimed priority, waiting for the ID check at the counter
  'verified',    -- staff saw a valid ID
  'rejected'     -- staff saw no valid ID
);

-- ------------------------------------------------------------
-- CITIZENS
-- ------------------------------------------------------------

CREATE TABLE citizens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name    VARCHAR(100) NOT NULL,
  middle_name   VARCHAR(100),
  last_name     VARCHAR(100) NOT NULL,
  suffix        VARCHAR(20),
  email         VARCHAR(255) NOT NULL,
  phone         VARCHAR(20)  NOT NULL,
  is_senior     BOOLEAN NOT NULL DEFAULT FALSE,  -- self-declared at booking
  is_pwd        BOOLEAN NOT NULL DEFAULT FALSE,  -- self-declared at booking
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()  -- the API sets this on every update
);

-- Guest booking form: the API finds a citizen by email and name, or creates one.
-- The same email, name, and suffix means the same person, while one email
-- can belong to many people (a caregiver booking for family).
CREATE UNIQUE INDEX uq_citizens_identity ON citizens (
  lower(email),
  lower(first_name),
  lower(coalesce(middle_name, '')),
  lower(last_name),
  lower(coalesce(suffix, ''))
);

-- Phone is searchable but NOT unique, because family members often share one phone
CREATE INDEX idx_citizens_phone ON citizens (phone);

-- ------------------------------------------------------------
-- SERVICES
-- ------------------------------------------------------------

CREATE TABLE services (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    VARCHAR(150) NOT NULL,
  description             TEXT,
  duration_minutes        INTEGER,              -- NULL = unpredictable duration (complex services)
  requires_consultation   BOOLEAN NOT NULL DEFAULT FALSE,  -- e.g. Legitimation, Correction, Marriage License, Late Registration
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,   -- retire a service without deleting its history
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A service needs a known duration OR must be a consultation-type service
  CONSTRAINT chk_duration_or_consultation
    CHECK (duration_minutes IS NOT NULL OR requires_consultation = TRUE),

  -- A duration, when present, must make sense. NULL passes this check
  -- (a CHECK only rejects when the condition is false, not unknown).
  CONSTRAINT chk_duration_positive
    CHECK (duration_minutes > 0)
);

-- ------------------------------------------------------------
-- STAFF
-- ------------------------------------------------------------

CREATE TABLE staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(150) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,   -- deactivate instead of deleting, so service history keeps its "who"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- STAFF_SERVICES (many-to-many junction)
-- ------------------------------------------------------------

-- A row here only says "this staff member handles this service", so it has no
-- meaning on its own: CASCADE is correct here.
CREATE TABLE staff_services (
  staff_id    UUID NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  service_id  UUID NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

-- ------------------------------------------------------------
-- SCHEDULES (office availability per service, per time block)
-- ------------------------------------------------------------

CREATE TABLE schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      UUID NOT NULL REFERENCES services (id) ON DELETE RESTRICT,  -- retire services with is_active, never delete
  date            DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  slot_capacity   INTEGER NOT NULL CHECK (slot_capacity > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_schedule_time_order CHECK (end_time > start_time),
  CONSTRAINT uq_schedule_slot UNIQUE (service_id, date, start_time)  -- no duplicate slot blocks
);

CREATE INDEX idx_schedules_date ON schedules (date);

-- ------------------------------------------------------------
-- APPOINTMENTS
-- ------------------------------------------------------------

-- The service is NOT stored here: it is read through the schedule
-- (appointments.schedule_id -> schedules.service_id), so the two can never disagree.
CREATE TABLE appointments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id    UUID NOT NULL REFERENCES citizens (id) ON DELETE RESTRICT,   -- keep appointment history
  schedule_id   UUID NOT NULL REFERENCES schedules (id) ON DELETE RESTRICT,
  status        appointment_status NOT NULL DEFAULT 'pending',
  cancelled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- cancelled_at must be filled exactly when the status is 'cancelled'
  CONSTRAINT chk_cancelled_at_matches_status
    CHECK (
      (status = 'cancelled' AND cancelled_at IS NOT NULL) OR
      (status != 'cancelled' AND cancelled_at IS NULL)
    )
);

CREATE INDEX idx_appointments_schedule_id ON appointments (schedule_id);
CREATE INDEX idx_appointments_citizen_id ON appointments (citizen_id);
CREATE INDEX idx_appointments_status ON appointments (status);

-- Partial unique index: blocks the same person from holding two ACTIVE bookings
-- for the same slot. A cancelled booking doesn't count, so they can rebook later.
-- (Capacity overbooking is checked in the API, inside a transaction.)
CREATE UNIQUE INDEX uq_active_booking
  ON appointments (citizen_id, schedule_id)
  WHERE status IN ('pending', 'confirmed');

-- ------------------------------------------------------------
-- QUEUE_ENTRIES
-- ------------------------------------------------------------

CREATE TABLE queue_entries (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number           VARCHAR(10) NOT NULL,   -- e.g. "1", "2"... or "P1", "P2"...

  -- NULL appointment_id = walk-in. RESTRICT: appointments are history, cancel them, never delete.
  appointment_id          UUID REFERENCES appointments (id) ON DELETE RESTRICT,

  -- Both nullable because a walk-in is anonymous until called; the service is
  -- filled in by staff at the window. Booked entries must have both (see CHECK below).
  citizen_id              UUID REFERENCES citizens (id) ON DELETE RESTRICT,
  service_id              UUID REFERENCES services (id) ON DELETE RESTRICT,

  priority_tier           queue_priority_tier NOT NULL DEFAULT 'regular',
  source                  queue_source NOT NULL,
  status                  queue_status NOT NULL DEFAULT 'waiting',

  priority_check          priority_check_status NOT NULL DEFAULT 'none',
  verified_by_staff_id    UUID REFERENCES staff (id) ON DELETE SET NULL,   -- nullable: SET NULL keeps the entry if staff is removed
  verified_at             TIMESTAMPTZ,

  scheduled_time          TIMESTAMPTZ,             -- copied from the appointment's slot start (NULL for walk-ins)
  enqueued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),   -- check-in / kiosk-tap timestamp

  called_at               TIMESTAMPTZ,
  served_by_staff_id      UUID REFERENCES staff (id) ON DELETE SET NULL,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Walk-ins may be anonymous; booked entries must have a citizen and a service and a slot time
  CONSTRAINT chk_walkin_or_complete
    CHECK (source = 'walkin' OR (citizen_id IS NOT NULL AND service_id IS NOT NULL AND scheduled_time IS NOT NULL)),

  -- "source says booked" must be true exactly when an appointment is attached
  CONSTRAINT chk_source_matches_appointment
    CHECK ((source = 'appointment') = (appointment_id IS NOT NULL)),
  
  -- being in the priority lane must be true exactly when there’s a claim
  CONSTRAINT chk_tier_matches_priority_check
    CHECK ((priority_tier = 'senior_pwd') = (priority_check <> 'none'))
);

-- One shared daily sequence for regular tickets, one for priority tickets (Manila time)
CREATE UNIQUE INDEX uq_queue_ticket_per_day
  ON queue_entries (ticket_number, ((enqueued_at AT TIME ZONE 'Asia/Manila')::date));

-- One ACTIVE queue entry per appointment. 'requeued' and 'abandoned' entries
-- is ignored, so the client can check in again on the same appointment.
-- Walk-ins have NULL appointment_id, and NULLs never count as duplicates.
CREATE UNIQUE INDEX uq_queue_one_active_per_appointment
  ON queue_entries (appointment_id)
  WHERE status NOT IN ('requeued', 'abandoned');

-- Narrows call-next to the waiting rows. The tier-dependent ordering
-- (priority first, then booked, then walk-in) lives in the call-next query.
CREATE INDEX idx_queue_waiting
  ON queue_entries (enqueued_at)
  WHERE status = 'waiting';

-- Finds ALL entries for an appointment, including requeued ones (history/audit)
CREATE INDEX idx_queue_appointment_id ON queue_entries (appointment_id);