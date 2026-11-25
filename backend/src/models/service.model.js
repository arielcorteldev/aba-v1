import { pool } from '../db/pool.js';

// The services table: what the office offers (Birth Certificate CTC, Late
// Registration, ...). Models only talk SQL: they assume their input has
// already been validated and normalized by the validators layer, and they
// return plain row objects. HTTP concerns (status codes, req/res) live in
// controllers; business-rule failures are thrown as AppError.
//
// All queries use $1, $2... placeholders. pg sends the values separately from
// the SQL text, so a name like "Robert'); DROP TABLE services;--" is stored as
// harmless text, never executed. Never build SQL by gluing strings together.

// For the booking form's service dropdown: id + name only, active services only.
// The full catalog (descriptions, requirements) lives on the Office Website, so
// sending more here would just be unused payload.
async function listActiveServices() {
    const { rows } = await pool.query(
        `SELECT id, name
           FROM services
          WHERE is_active
          ORDER BY name`
    );
    return rows;
}

// One service by id, or null if it doesn't exist.
// Used by the admin schedules step: duration_minutes feeds the default capacity
// formula, and requires_consultation decides whether capacity is mandatory.
// is_active is included so the caller can refuse to schedule a retired service.
//
// Note: the id must already be a valid UUID (the validator's job). A malformed
// string like 'abc' makes Postgres raise 22P02 (invalid input syntax), which
// would surface as a 500 instead of a clean 400.
async function findServiceById(id) {
    const { rows } = await pool.query(
        `SELECT id, name, duration_minutes, requires_consultation, is_active
           FROM services
          WHERE id = $1`,
        [id]
    );
    // rows is [] when nothing matched; rows[0] would be undefined, so we
    // return an explicit null to make "not found" obvious to the caller.
    return rows[0] ?? null;
}

// Admin: create a service and return the stored row.
// description is optional → stored as NULL when absent.
// durationMinutes is NULL for consultation services. The DB's
// chk_duration_or_consultation CHECK is the last line of defence for
// "NULL duration requires requires_consultation = true"; the validator should
// catch it first so the admin gets a clear 400 instead of a constraint error.
async function createService({ name, description = null, durationMinutes = null, requiresConsultation = false }) {
    const { rows } = await pool.query(
        `INSERT INTO services (name, description, duration_minutes, requires_consultation)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, description, duration_minutes, requires_consultation,
                   is_active, created_at`,
        [name, description, durationMinutes, requiresConsultation]
    );
    // RETURNING hands back the inserted row (including the generated UUID and
    // defaults like is_active = true) without a second SELECT.
    return rows[0];
}

export { listActiveServices, findServiceById, createService };
