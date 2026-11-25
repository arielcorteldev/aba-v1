import { rateLimit } from 'express-rate-limit';

// Rate limiting = "each client IP may make at most N requests per time window".
// Past the limit, the request is rejected with 429 Too Many Requests BEFORE it
// reaches our controllers or the database.
//
// How the client is identified: express-rate-limit keys on req.ip. Because the
// API sits behind a Cloudflare Tunnel, app.js sets `trust proxy` to 'loopback'
// so that req.ip is the real citizen's IP, not cloudflared's 127.0.0.1.
// Without that, every citizen would share ONE counter and lock each other out.
//
// Storage: counts live in this Node process's memory. They reset on restart
// and aren't shared between processes. That's fine for one office server; a
// multi-server setup would need a shared store (e.g. Redis).

const FIFTEEN_MINUTES = 15 * 60 * 1000; // windowMs is in milliseconds
const ONE_HOUR = 60 * 60 * 1000;

// Builds the 429 response in the same { error: { code, message } } shape that
// errorHandler.js uses, so the frontend handles every error one way.
function limitExceeded(message) {
    return (req, res, next, options) => {
        res.status(options.statusCode).json({
            error: { code: 'RATE_LIMITED', message },
        });
    };
}

// Options shared by all limiters.
const common = {
    // 'draft-8' sends standard RateLimit / RateLimit-Policy headers, telling
    // clients how many requests are left and when the window resets.
    standardHeaders: 'draft-8',
    // Turn off the older non-standard X-RateLimit-* headers (redundant).
    legacyHeaders: false,
};

// App-wide safety net: 100 requests / 15 min per IP.
// It's generous on purpose. Office staff opening the public URL all share the
// office's single public IP (NAT), and a citizen browsing dates and slots
// fires several GETs per booking.
const apiLimiter = rateLimit({
    ...common,
    windowMs: FIFTEEN_MINUTES,
    limit: 100,
    handler: limitExceeded('Too many requests. Please wait a few minutes and try again.'),
});

// Stricter limit for the two citizen write endpoints, once those routes exist:
//   POST /appointments         (stops spam bookings that eat slot capacity)
//   POST /appointments/cancel  (stops guessing reference numbers + emails)
// No real citizen books or cancels 10 times in an hour.
const bookingWriteLimiter = rateLimit({
    ...common,
    windowMs: ONE_HOUR,
    limit: 10,
    handler: limitExceeded('Too many booking attempts. Please try again later.'),
});

// For admin routes: limits FAILED attempts only. skipSuccessfulRequests makes
// any response with status < 400 not count, so staff with the correct key are
// never throttled, while someone guessing ADMIN_KEY gets 10 tries per 15 min.
const adminLimiter = rateLimit({
    ...common,
    windowMs: FIFTEEN_MINUTES,
    limit: 10,
    skipSuccessfulRequests: true,
    handler: limitExceeded('Too many failed admin requests. Please wait and try again.'),
});

export { apiLimiter, bookingWriteLimiter, adminLimiter };
