-- ============================================================
-- Appointment Booking App (ABA) + QMS Integration Schema
-- PostgreSQL
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ------------------------------------------------------------
-- ENUM TYPES
-- ------------------------------------------------------------

CREATE TYPE appointment_status AS ENUM (
  'pending',
  'confirmed',
  'cancelled',
  'no_show',
  'completed'
);

CREATE TYPE queue_priority_tier AS ENUM (
  'senior_pwd',
  'regular'
);

CREATE TYPE queue_source AS ENUM (
  'appointment',
  'walkin'
);

CREATE TYPE queue_status AS ENUM (
  'waiting',
  'called',
  'serving',
  'done',
  'no_show',
  'abandoned'
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
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_citizens_email ON citizens (email);
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
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_duration_or_consultation
    CHECK (duration_minutes IS NOT NULL OR requires_consultation = TRUE)
);

-- ------------------------------------------------------------
-- STAFF
-- ------------------------------------------------------------

CREATE TABLE staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(150) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- STAFF_SERVICES (many-to-many junction)
-- ------------------------------------------------------------

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
  service_id      UUID NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  slot_capacity   INTEGER NOT NULL CHECK (slot_capacity > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_schedule_time_order CHECK (end_time > start_time),
  CONSTRAINT uq_schedule_slot UNIQUE (service_id, date, start_time)
);

CREATE INDEX idx_schedules_date ON schedules (date);

-- ------------------------------------------------------------
-- APPOINTMENTS
-- ------------------------------------------------------------

CREATE TABLE appointments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id    UUID NOT NULL REFERENCES citizens (id) ON DELETE CASCADE,
  service_id    UUID NOT NULL REFERENCES services (id) ON DELETE RESTRICT,
  schedule_id   UUID NOT NULL REFERENCES schedules (id) ON DELETE RESTRICT,
  status        appointment_status NOT NULL DEFAULT 'pending',
  cancelled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cancelled_at_matches_status
    CHECK (
      (status = 'cancelled' AND cancelled_at IS NOT NULL) OR
      (status != 'cancelled' AND cancelled_at IS NULL)
    )
);

CREATE INDEX idx_appointments_schedule_id ON appointments (schedule_id);
CREATE INDEX idx_appointments_citizen_id ON appointments (citizen_id);
CREATE INDEX idx_appointments_status ON appointments (status);

-- ------------------------------------------------------------
-- QUEUE_ENTRIES
-- ------------------------------------------------------------

CREATE TABLE queue_entries (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number           VARCHAR(10) NOT NULL,   -- e.g. "1", "2"... or "P1", "P2"...

  appointment_id          UUID UNIQUE REFERENCES appointments (id) ON DELETE SET NULL, -- NULL = walk-in
  citizen_id              UUID NOT NULL REFERENCES citizens (id) ON DELETE CASCADE,
  service_id              UUID NOT NULL REFERENCES services (id) ON DELETE RESTRICT,

  priority_tier           queue_priority_tier NOT NULL DEFAULT 'regular',
  source                  queue_source NOT NULL,
  status                  queue_status NOT NULL DEFAULT 'waiting',

  claims_priority         BOOLEAN NOT NULL DEFAULT FALSE,  -- self-declared (checkbox or walk-in claim)
  priority_verified       BOOLEAN NOT NULL DEFAULT FALSE,  -- confirmed by staff at the counter
  verified_by_staff_id    UUID REFERENCES staff (id) ON DELETE SET NULL,
  verified_at             TIMESTAMPTZ,

  scheduled_time          TIMESTAMPTZ,             -- copied from the appointment's slot start (NULL for walk-ins)
  enqueued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),   -- check-in / walk-in arrival timestamp
  effective_queue_time    TIMESTAMPTZ NOT NULL DEFAULT now(),   -- resets on verification failure (bump to back)

  called_at               TIMESTAMPTZ,
  served_by_staff_id      UUID REFERENCES staff (id) ON DELETE SET NULL,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One shared daily sequence for regular tickets, one for priority tickets
CREATE UNIQUE INDEX uq_queue_ticket_per_day
  ON queue_entries (ticket_number, (enqueued_at::date));

-- Powers the "call next" query: ORDER BY priority_tier, source, scheduled_time, effective_queue_time
CREATE INDEX idx_queue_call_next
  ON queue_entries (status, priority_tier, source, scheduled_time, effective_queue_time);

CREATE INDEX idx_queue_appointment_id ON queue_entries (appointment_id);
