import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Without a path, dotenv looks for .env in the folder you RAN node from
// (process.cwd()), so starting the server from the repo root would miss it.
// Instead, resolve the path from this file's own location, which never changes.
// ES modules have no __dirname, so we rebuild it from import.meta.url
// (a file:// URL of this file). fileURLToPath also decodes the space in
// "appointment booking" (%20 → ' ').
const __dirname = path.dirname(fileURLToPath(import.meta.url)); // backend/src/config
const envPath = path.resolve(__dirname, '../../.env');           // backend/.env

// Load backend/.env into process.env (runs once, at import time)
dotenv.config({ path: envPath });

// Presence check: every variable must exist and not be empty.
const required = [
    'PORT',
    'DATABASE_URL',
    'ADMIN_KEY',
    'SERVING_WINDOWS_COUNT',
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
// Only windows that call from the queue count here. The Releasing Window is
// deliberately excluded, so capacity math never needs a hidden "minus one".
const servingWindowsCount = Number(process.env.SERVING_WINDOWS_COUNT);

if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive whole number, got "${process.env.PORT}"`);
}
if (!Number.isInteger(servingWindowsCount) || servingWindowsCount <= 0) {
    throw new Error(`SERVING_WINDOWS_COUNT must be a positive whole number, got "${process.env.SERVING_WINDOWS_COUNT}"`);
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
    serving_windows_count: servingWindowsCount,
    timezone: process.env.TIMEZONE,
    frontend_origin: process.env.FRONTEND_ORIGIN,
});

export { config };