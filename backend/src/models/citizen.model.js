// No pool import on purpose: see the `db` parameter below.

// The citizens table: guests who book (no accounts). A citizen is identified by
// email + full name (case-insensitive), so one email can belong to several
// people, e.g. a daughter booking for both her parents.

// Find the citizen with this identity, or create them, and return their id.
// Always ONE query and ONE round trip, whether the citizen is new or returning.
//
// Why does it take `db` instead of importing the pool?
// It's called from inside the booking transaction (appointment.model.js),
// which runs on ONE checked-out client between BEGIN and COMMIT. If this
// function used pool.query, it could run on a different connection, outside
// that transaction: a failed booking would roll back but leave this citizen
// row behind. Passing the transaction's client keeps it on the same connection.
// `db` can be the pool or a client; both have the same .query() method.
//
// Expects normalized input (the validator's job): names trimmed with repeated
// spaces collapsed, email trimmed, empty middle name / suffix as null.
//
// How the upsert works:
//   INSERT ... ON CONFLICT (<identity>) DO UPDATE ... RETURNING id
//   - New identity → the INSERT succeeds → RETURNING gives the new id.
//   - Existing identity → uq_citizens_identity would be violated, so instead
//     of failing, Postgres runs the DO UPDATE on the EXISTING row → RETURNING
//     gives that row's id.
//
// The conflict target must repeat the unique index's EXACT expressions.
// uq_citizens_identity is built on lower(...) / coalesce(...) expressions, not
// plain columns, so ON CONFLICT (email, first_name, ...) would not match it
// and Postgres would error: "there is no unique or exclusion constraint
// matching the ON CONFLICT specification".
//
// Why DO UPDATE and not DO NOTHING?
//   1. DO NOTHING returns NO row for an existing citizen, so we'd need a
//      second SELECT to get the id.
//   2. Latest values should win: phone numbers change and people turn 60.
//      (Staff verify senior/PWD status with an ID at the counter anyway.)
// The names and email are NOT updated: they're the identity itself and only
// differ in letter case, so the first-stored spelling is kept.
//
// EXCLUDED is Postgres' name for "the row we tried to insert", so
// EXCLUDED.phone means "the phone from this booking".
async function findOrCreateCitizen(db, { firstName, middleName = null, lastName, suffix = null, email, phone, isSenior = false, isPwd = false }) {
    const { rows } = await db.query(
        `INSERT INTO citizens
                (first_name, middle_name, last_name, suffix, email, phone, is_senior, is_pwd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (
                lower(email),
                lower(first_name),
                lower(coalesce(middle_name, '')),
                lower(last_name),
                lower(coalesce(suffix, ''))
         )
         DO UPDATE SET
                phone      = EXCLUDED.phone,
                is_senior  = EXCLUDED.is_senior,
                is_pwd     = EXCLUDED.is_pwd,
                updated_at = now()   -- no trigger in the schema; the API must set it
         RETURNING id`,
        [firstName, middleName, lastName, suffix, email, phone, isSenior, isPwd]
    );
    return rows[0].id;
}

export { findOrCreateCitizen };
