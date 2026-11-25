import { pool } from '../db/pool.js';
import { AppError } from '../utils/AppError.js';
import { todayInZone } from '../utils/dates.js';
import { generateReferenceNumber } from '../utils/referenceNumber.js';
import { findOrCreateCitizen } from './citizen.model.js';

// The appointments table: one row per booking. The service is NOT stored here;
// it's read through schedule_id → schedules.service_id.

// How many fresh reference numbers to try before giving up. With ~850 billion
// possible codes, even one collision is extremely unlikely; five in a row
// would mean something is broken (e.g. the generator), not bad luck.
const MAX_REFERENCE_ATTEMPTS = 5;

// Book one citizen into one schedule block. Returns the booking summary the
// citizen needs (reference number, service, date, time).
//
// Why a transaction?
// Booking is several steps that must succeed or fail TOGETHER: check the slot,
// count seats, find-or-create the citizen, insert the appointment. If the
// insert fails, the citizen upsert must be undone too. BEGIN...COMMIT makes the
// steps one unit; ROLLBACK undoes everything since BEGIN.
//
// Why FOR UPDATE? (the overbooking problem)
// The DB does NOT enforce slot_capacity. Without a lock, two requests for the
// last seat could interleave like this:
//
//   Request A                      Request B
//   count → 3 of 4, OK             count → 3 of 4, OK
//   INSERT                         INSERT          → 5 of 4: overbooked!
//
// SELECT ... FOR UPDATE locks the schedule row until COMMIT/ROLLBACK. Request
// B's SELECT now WAITS at step 1 until A finishes, then counts again and sees
// A's booking:
//
//   Request A                      Request B
//   lock schedule, count 3 of 4    lock schedule → waits...
//   INSERT, COMMIT (lock released) → gets lock, count 4 of 4 → SLOT_FULL
//
// Only bookings for the SAME block wait on each other; other blocks have
// their own rows and locks, so the rest of the office isn't slowed down.
//
// `citizen` must already be normalized by the validator (see citizen.model.js).
async function createAppointment({ scheduleId, citizen }) {
    // A transaction lives on ONE connection, so check out a dedicated client
    // instead of using pool.query (which may pick a different connection each call).
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Step 1: lock the schedule block and read what we need about it.
        // `FOR UPDATE OF s` locks only the schedules row, not the joined
        // services row: other bookings for the same service but different
        // blocks shouldn't wait on us.
        // The is_active join makes a retired service's blocks unbookable; they
        // look "not found", same as the slots endpoint which never lists them.
        const slotResult = await client.query(
            `SELECT s.date, s.start_time, s.end_time, s.slot_capacity,
                    sv.name AS service_name
               FROM schedules s
               JOIN services sv
                 ON sv.id = s.service_id
                AND sv.is_active
              WHERE s.id = $1
                FOR UPDATE OF s`,
            [scheduleId]
        );
        const slot = slotResult.rows[0];

        if (!slot) {
            throw new AppError(404, 'SCHEDULE_NOT_FOUND', 'This time slot does not exist.');
        }

        // No same-day booking. Both sides are 'YYYY-MM-DD' strings (pg type
        // parser + dates.js), and that format compares correctly as text.
        // The slots endpoint already hides these; this guards direct API calls.
        if (slot.date <= todayInZone()) {
            throw new AppError(422, 'SLOT_NOT_BOOKABLE', 'Bookings are only accepted from tomorrow onward.');
        }

        // Step 2: count the seats already taken. Only pending/confirmed count,
        // so a cancelled booking frees its seat. Because we hold the lock, this
        // number can't change under us before our INSERT.
        const countResult = await client.query(
            `SELECT count(*)::int AS taken
               FROM appointments
              WHERE schedule_id = $1
                AND status IN ('pending', 'confirmed')`,
            [scheduleId]
        );

        if (countResult.rows[0].taken >= slot.slot_capacity) {
            throw new AppError(409, 'SLOT_FULL', 'This time slot is already full. Please choose another.');
        }

        // Step 3: find or create the citizen ON THIS CLIENT, so it's part of
        // the transaction and is rolled back if the booking fails.
        const citizenId = await findOrCreateCitizen(client, citizen);

        // Step 4: insert with a random reference number, retrying on collision.
        //
        // ON CONFLICT (reference_number) DO NOTHING: if the code already
        // exists, Postgres skips the row and RETURNING gives ZERO rows instead
        // of raising an error. That's important: inside a transaction, ANY
        // error aborts the whole transaction, so "catch the 23505 and retry"
        // wouldn't work; every later query would fail until ROLLBACK.
        //
        // Naming the conflict target (reference_number) means ONLY that
        // constraint is skipped. A uq_active_booking violation (same citizen,
        // same block, already active) still raises 23505, handled below.
        //
        // status is set explicitly: the schema default is 'pending', but there
        // is no confirmation email yet, so new bookings start as 'confirmed'.
        let appointment = null;

        for (let attempt = 1; attempt <= MAX_REFERENCE_ATTEMPTS && !appointment; attempt += 1) {
            const insertResult = await client.query(
                `INSERT INTO appointments (citizen_id, schedule_id, status, reference_number)
                 VALUES ($1, $2, 'confirmed', $3)
                 ON CONFLICT (reference_number) DO NOTHING
                 RETURNING reference_number, status`,
                [citizenId, scheduleId, generateReferenceNumber()]
            );
            // rows[0] is undefined on a collision → stays null → loop again
            appointment = insertResult.rows[0] ?? null;
        }

        if (!appointment) {
            // A plain Error, not AppError: this is a server fault, not the
            // citizen's. errorHandler logs it and sends a generic 500.
            throw new Error(`Could not generate a unique reference number after ${MAX_REFERENCE_ATTEMPTS} attempts`);
        }

        await client.query('COMMIT');

        // What the citizen sees on the confirmation screen.
        return {
            reference_number: appointment.reference_number,
            status: appointment.status,
            service_name: slot.service_name,
            date: slot.date,
            start_time: slot.start_time,
            end_time: slot.end_time,
        };
    } catch (err) {
        // Undo everything since BEGIN (including the citizen upsert) and
        // release the schedule lock so waiting requests can continue.
        // Wrapped in its own try/catch: if the connection itself died, ROLLBACK
        // throws too, and we'd lose the ORIGINAL error, which is the useful one.
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            console.error('ROLLBACK failed:', rollbackErr.message);
        }

        // The same citizen already holds an active booking for this block.
        // Checking err.constraint (not just the code) matters: 23505 is ANY
        // unique violation, and only this index means "already booked".
        if (err.code === '23505' && err.constraint === 'uq_active_booking') {
            throw new AppError(409, 'ALREADY_BOOKED', 'You already have a booking for this time slot.');
        }

        // AppErrors (SLOT_FULL, ...) and unexpected errors pass through
        // unchanged to errorHandler.
        throw err;
    } finally {
        // ALWAYS return the client to the pool, success or failure. A client
        // that's never released is "leaked": after enough of them, the pool
        // has no connections left and every request hangs.
        client.release();
    }
}

// Cancel a booking. The citizen proves ownership with BOTH the reference
// number and the email used to book. Returns the cancelled booking's summary.
//
// Why one conditional UPDATE instead of "SELECT, check rules in JS, UPDATE"?
// Check-then-write in two statements has a gap between them. Two cancel
// requests (a double-click, a retry) could both SELECT "confirmed", both pass
// the check, and both UPDATE. Putting EVERY rule in the UPDATE's WHERE makes
// the check and the write one atomic statement:
//
//   Request A                         Request B
//   UPDATE ... WHERE status IN        UPDATE same row → waits for A's row lock
//     (pending, confirmed) → 1 row
//   commit                            re-checks WHERE on the NEW row:
//                                     status is 'cancelled' → 0 rows
//
// Postgres does that re-check automatically: when an UPDATE waited on a row
// another transaction changed, it re-evaluates its WHERE against the updated
// version before writing. So exactly one request can ever succeed.
// No explicit transaction is needed: a single statement is already atomic.
//
// The rules, all in WHERE:
//   - reference number matches (validator uppercases it first)
//   - email matches the booking citizen's, case-insensitively
//   - status is still pending/confirmed (not cancelled, completed, no-show)
//   - the appointment date is AFTER today in Manila (cancel only before the day)
//
// cancelled_at and status change together, which satisfies the schema's
// chk_cancelled_at_matches_status. updated_at has no trigger, so we set it.
//
// UPDATE ... FROM joins other tables into an UPDATE, so the WHERE can check
// the citizen's email and the schedule's date. Only `appointments` is written.
async function cancelAppointment({ referenceNumber, email }) {
    const today = todayInZone();

    const updateResult = await pool.query(
        `UPDATE appointments a
            SET status       = 'cancelled',
                cancelled_at = now(),
                updated_at   = now()
           FROM citizens c, schedules s
          WHERE a.citizen_id = c.id
            AND a.schedule_id = s.id
            AND a.reference_number = $1
            AND lower(c.email) = lower($2)
            AND a.status IN ('pending', 'confirmed')
            AND s.date > $3
         RETURNING a.reference_number, a.status, a.cancelled_at,
                   s.date, s.start_time, s.end_time`,
        [referenceNumber, email, today]
    );

    // 1 row: cancelled. This is the normal path, so only one query runs.
    if (updateResult.rows.length === 1) {
        return updateResult.rows[0];
    }

    // 0 rows: SOMETHING in the WHERE failed. Only now do we look the booking up
    // to pick the right error message. This lookup is just for the message;
    // the decision (nothing was cancelled) was already made atomically above.
    //
    // The lookup still requires reference number AND email. That's the
    // security point: a wrong reference number and a wrong email both land in
    // "no row" → the same 404, so the API never reveals which reference
    // numbers exist. Anyone who gets PAST this check already knows both values,
    // so telling them "already cancelled" leaks nothing new.
    const lookupResult = await pool.query(
        `SELECT a.status
           FROM appointments a
           JOIN citizens c ON c.id = a.citizen_id
          WHERE a.reference_number = $1
            AND lower(c.email) = lower($2)`,
        [referenceNumber, email]
    );
    const booking = lookupResult.rows[0];

    if (!booking) {
        throw new AppError(404, 'APPOINTMENT_NOT_FOUND', 'No booking matches that reference number and email.');
    }
    if (booking.status === 'cancelled') {
        throw new AppError(409, 'ALREADY_CANCELLED', 'This booking has already been cancelled.');
    }
    // Anything else: the appointment is today or in the past, or it is
    // completed / no_show. One message covers all of them.
    throw new AppError(422, 'CANNOT_CANCEL', 'This booking can no longer be cancelled. Cancellation is only allowed before the appointment day.');
}

export { createAppointment, cancelAppointment };
