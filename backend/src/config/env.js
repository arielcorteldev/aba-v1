import dotenv from 'dotenv';

// Load backend/.env into process.env (runs once, at import time)
dotenv.config();

// Presence check: every variable must exist and not be empty.
const required = [
    'PORT',
    'DATABASE_URL',
    'ADMIN_KEY',
    'WINDOWS_COUNT',
    'TIMEZONE',
    'FRONTEND_ORIGIN',
];

// filter keeps only the names that are missing or empty ('' is falsy too)
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
    // Listing all missing names at once saves you one restart per typo
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
}

// 2. Number check: env values are always strings, so convert first,
//    then confirm the result is a real positive whole number.
//    Number('abc') is NaN, and Number.isInteger(NaN) is false, so it's caught.
const port = Number(process.env.PORT);
const windowsCount = Number(process.env.WINDOWS_COUNT);

if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive whole number, got "${process.env.PORT}"`);
}
if (!Number.isInteger(windowsCount) || windowsCount <= 0) {
    throw new Error(`WINDOWS_COUNT must be a positive whole number, got "${process.env.WINDOWS_COUNT}"`);
}

// 3. Admin key check: refuse short keys and leftover placeholder values.
const adminKey = process.env.ADMIN_KEY;

if (adminKey.length < 32 || adminKey.startsWith('generate-with') || adminKey === 'change-me') {
    throw new Error('ADMIN_KEY must be a real secret of at least 32 characters');
}

// 4. Timezone check: Intl throws a RangeError for an invalid IANA name,
//    so a typo like "Asia/Manilla" fails now, not in the middle of a booking.
try {
    new Intl.DateTimeFormat('en-US', { timeZone: process.env.TIMEZONE });
} catch {
    throw new Error(`TIMEZONE is not a valid IANA timezone: "${process.env.TIMEZONE}"`);
}

// Build the settings object only after every check has passed.
// Object.freeze stops other files from accidentally changing a setting at runtime.
const config = Object.freeze({
    port,
    database_url: process.env.DATABASE_URL,
    admin_key: adminKey,
    windows_count: windowsCount,
    timezone: process.env.TIMEZONE,
    frontend_origin: process.env.FRONTEND_ORIGIN,
});

export { config };