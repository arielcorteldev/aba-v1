import { pool } from '../db/pool.js';
import { tomorrowInZone } from '../utils/dates.js';

// The schedules table: one row per bookable 1-hour block for one service on
// one date, with a slot_capacity (how many citizens it can take).
// As with every model: input is pre-validated, queries are parameterized,
// rows come back as plain objects. DATE columns arrive as 'YYYY-MM-DD' strings
// (type parser in db/pool.js) and TIME columns as 'HH:MM:SS' strings.

// Bookable slots for one service on one date, with how many seats are left.
//
// How the query works, step by step:
//   1. FROM schedules s              → every block...
//   2. JOIN services sv ... is_active → ...of an ACTIVE service only
//   3. LEFT JOIN appointments a       → attach each block's active bookings.
//      LEFT (not INNER) so a block with ZERO bookings still appears; with an
//      inner join it would vanish, and empty slots are the most bookable ones.
//      The status filter sits in the ON clause, not WHERE: in WHERE it would
//      throw away the NULL rows the LEFT JOIN made for empty blocks.
//      Only pending/confirmed count, so a cancelled booking frees its seat.
//   4. GROUP BY s.id                  → one result row per block, so count()
//      can count that block's bookings. (Grouping by the primary key lets us
//      select the other s.* columns too.)
//   5. HAVING                         → drop full blocks. HAVING filters AFTER
//      grouping, which is when the count exists; WHERE runs before it.
//
// `s.date >= tomorrow` enforces "no same-day booking": asking for today or a
// past date simply returns no slots. The date comes from dates.js (Manila
// time), not from Postgres' now(), so JS and SQL always agree on "today".
async function listAvailableSlots(serviceId, date) {
    const { rows } = await pool.query(
        `SELECT s.id, s.date, s.start_time, s.end_time, s.slot_capacity,
                -- count() returns bigint, which pg hands back as a STRING
                -- (bigint can exceed JS's safe integer range). ::int makes it
                -- a normal number; a seat count will never be that large.
                (s.slot_capacity - count(a.id))::int AS seats_left
           FROM schedules s
           JOIN services sv
             ON sv.id = s.service_id
            AND sv.is_active
           LEFT JOIN appointments a
             ON a.schedule_id = s.id
            AND a.status IN ('pending', 'confirmed')
          WHERE s.service_id = $1
            AND s.date = $2
            AND s.date >= $3
          GROUP BY s.id
         HAVING s.slot_capacity - count(a.id) > 0
          ORDER BY s.start_time`,
        [serviceId, date, tomorrowInZone()]
    );
    return rows;
}

// Admin: insert many schedule blocks at once.
//
// `blocks` is the ALREADY-EXPANDED list, e.g.
//   [{ date: '2026-12-01', startTime: '08:00', endTime: '09:00', capacity: 4 }, ...]
// Turning a pattern (weekdays × date range × hours) into this list, and the
// default-capacity formula, are the controller's job, not SQL's.
//
// Why unnest instead of a loop of INSERTs?
// A month of weekday blocks can be 150+ rows. One INSERT per row = 150 round
// trips. unnest() takes parallel arrays (all dates, all start times, ...) and
// turns them into rows inside Postgres, so it's ONE statement and ONE round
// trip. A single statement is also atomic on its own: if anything fails
// (e.g. a CHECK), no rows are inserted, so no explicit transaction is needed.
//
// ON CONFLICT (service_id, date, start_time) DO NOTHING:
// blocks that already exist (uq_schedule_slot) are skipped, not errors. So
// re-submitting the same pattern, or an overlapping one, is safe, and existing
// blocks (which may already have bookings) are never overwritten.
// RETURNING only returns rows that were actually inserted, so the caller can
// report "created N, skipped blocks.length - N".
async function createScheduleBlocks(serviceId, blocks) {
    // Nothing to insert: skip the round trip.
    if (blocks.length === 0) {
        return [];
    }

    // Split the list of objects into one array per column. pg converts a JS
    // array into a Postgres array; the ::date[] / ::time[] / ::int[] casts tell
    // Postgres what type each array holds.
    const dates = blocks.map((b) => b.date);
    const startTimes = blocks.map((b) => b.startTime);
    const endTimes = blocks.map((b) => b.endTime);
    const capacities = blocks.map((b) => b.capacity);

    // The CTE (WITH inserted AS ...) exists only to sort the result:
    // RETURNING has no ORDER BY, so we select from it and sort afterwards.
    const { rows } = await pool.query(
        `WITH inserted AS (
             INSERT INTO schedules (service_id, date, start_time, end_time, slot_capacity)
             SELECT $1, b.date, b.start_time, b.end_time, b.slot_capacity
               FROM unnest($2::date[], $3::time[], $4::time[], $5::int[])
                    AS b(date, start_time, end_time, slot_capacity)
             ON CONFLICT (service_id, date, start_time) DO NOTHING
             RETURNING id, date, start_time, end_time, slot_capacity
         )
         SELECT * FROM inserted
          ORDER BY date, start_time`,
        [serviceId, dates, startTimes, endTimes, capacities]
    );
    return rows;
}

export { listAvailableSlots, createScheduleBlocks };
