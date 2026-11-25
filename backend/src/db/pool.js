// pg is a CommonJS package. In ES modules, a named import like
// `import { Pool } from 'pg'` isn't guaranteed to work, so we take the
// default export and pull Pool off it.
import pg from 'pg';
import { config } from '../config/env.js';

const { Pool } = pg;

// Keep Postgres DATE values as plain 'YYYY-MM-DD' strings.
// By default pg turns a DATE (type id 1082) into a JS Date at LOCAL midnight.
// A DATE has no time or zone, but a JS Date is an exact instant, so the moment
// it gets serialized (e.g. res.json → toISOString in UTC) '2026-11-26' can come
// out as '2026-11-25T16:00:00.000Z' — the wrong day for a Manila office.
// Strings avoid that entirely and compare correctly with our dates.js helpers.
// This is global for the pg library, so setting it once here covers every query.
pg.types.setTypeParser(1082, (value) => value);

// One pool for the whole app. ES modules run once and are cached, so every
// file that imports `pool` gets this same object, not a new pool each time.
// A pool keeps a few open connections and lends them out per query, which is
// much cheaper than opening a fresh connection for every request.
const pool = new Pool({
    connectionString: config.database_url,
    // pg's default is 0, meaning "wait forever". If the host is wrong or
    // unreachable, startup would hang silently. 5 seconds makes it fail fast.
    connectionTimeoutMillis: 5000,
});

// This fires when a connection that is sitting IDLE in the pool breaks
// (e.g. Postgres restarts, or the network drops). Without a listener, Node
// treats it as an unhandled 'error' event and crashes the whole server.
// The pool already throws the broken connection away, so logging is enough.
// Note: failed queries do NOT come here; they reject their own promise and
// reach the Express errorHandler instead.
pool.on('error', (err) => {
    console.error('Unexpected error on idle database client:', err.message);
});

// Called once by server.js before it starts listening, so a bad DATABASE_URL
// fails at boot with a clear message instead of on the first real request.
// It's a separate function (not run here at import time) so that importing
// pool.js never triggers network I/O by itself — useful for scripts and tests.
async function verifyConnection() {
    try {
        // Cheapest possible round trip: proves we can connect AND authenticate.
        await pool.query('SELECT 1');
    } catch (err) {
        // Translate pg's error codes into messages a human can act on.
        // We never print the connection string, because it contains the password.
        let reason;
        if (err.code === '28P01') {
            reason = 'wrong username or password in DATABASE_URL';
        } else if (err.code === '3D000') {
            reason = 'the database named in DATABASE_URL does not exist';
        } else if (err.code === 'ECONNREFUSED') {
            reason = 'connection refused — is Postgres running, and is the port correct?';
        } else if (err.code === 'ENOTFOUND') {
            reason = 'host not found — check the host name in DATABASE_URL';
        } else if (/timeout/i.test(err.message)) {
            reason = 'connection timed out — the database host is unreachable';
        } else {
            reason = err.message;
        }
        // `cause` keeps the original pg error attached for deeper debugging.
        throw new Error(`Database connection failed: ${reason}`, { cause: err });
    }
}

/*
 * Transaction pattern (for the create-appointment model, later):
 *
 * A transaction lives on ONE connection. Two separate pool.query() calls may
 * land on different connections, so BEGIN on one and INSERT on another would
 * not be in the same transaction. Check out a dedicated client instead:
 *
 *   const client = await pool.connect();
 *   try {
 *       await client.query('BEGIN');
 *       // SELECT ... FOR UPDATE, count bookings, INSERT ...
 *       await client.query('COMMIT');
 *   } catch (err) {
 *       await client.query('ROLLBACK'); // undo everything since BEGIN
 *       throw err;
 *   } finally {
 *       client.release(); // ALWAYS return it, or the pool slowly runs dry
 *   }
 */

export { pool, verifyConnection };
