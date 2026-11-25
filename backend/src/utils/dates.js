import { config } from '../config/env.js';

// Why this file exists:
// The server's own clock zone is irrelevant (it could be UTC on a cloud host).
// Booking rules ("no same-day booking", "cancel only before the appointment
// day") are about the OFFICE's calendar day, so every "today" must be computed
// in config.timezone (Asia/Manila), never with new Date().getDate().
//
// Every function returns a 'YYYY-MM-DD' string, the same shape pg gives us for
// DATE columns (see the type parser in db/pool.js). Strings in this format
// compare correctly both in SQL and in JS ('2026-11-26' > '2026-11-25').

// Build the formatter once; creating Intl formatters is relatively expensive.
const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

// The office's calendar date right now, e.g. '2026-11-25'.
// `now` is a parameter (defaulting to the real clock) so a test script can pass
// a fixed instant, like 23:30 UTC, and check the day rolls over correctly.
function todayInZone(now = new Date()) {
    // formatToParts gives labelled pieces ({ type: 'year', value: '2026' }, ...),
    // so we don't depend on a locale's ordering or separators.
    const parts = formatter.formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

// The office's next calendar date, the first day bookings are allowed.
function tomorrowInZone(now = new Date()) {
    const [year, month, day] = todayInZone(now).split('-').map(Number);
    // Do the +1 in UTC on a "date-only" value: UTC has no daylight saving, so
    // adding one day is always exactly one calendar day. Date.UTC also rolls
    // over month and year ends for us (Nov 30 + 1 → Dec 1, Dec 31 → Jan 1).
    // month - 1 because JS months are 0-based (January = 0).
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    // toISOString is always UTC, so its first 10 characters are our date.
    return next.toISOString().slice(0, 10);
}

export { todayInZone, tomorrowInZone };
