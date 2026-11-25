import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

// app.js builds the Express app; server.js starts it listening. Keeping them
// apart means the app can be imported (e.g. by tests) without opening a port.
const app = express();

// Middleware runs top to bottom, in the order of app.use() calls, so the
// order below is deliberate:
//
//   request → cors → apiLimiter → express.json → [routers] → notFound → errorHandler

// Express adds "X-Powered-By: Express" to every response by default. It helps
// no one but attackers fingerprinting the stack, so turn it off.
app.disable('x-powered-by');

// In production, requests arrive via a Cloudflare Tunnel: cloudflared runs on
// this server and connects to Node from 127.0.0.1. Without this setting,
// req.ip would ALWAYS be 127.0.0.1, so every citizen would share a single
// rate-limit counter.
// 'loopback' means "trust X-Forwarded-For only when the direct sender is
// localhost (cloudflared)". Express then takes the rightmost untrusted address
// in that header, which is the IP Cloudflare itself appended, so a client
// can't spoof it by sending a fake X-Forwarded-For.
app.set('trust proxy', 'loopback');

// CORS: browsers block a page on one origin (the frontend, e.g.
// http://127.0.0.1:5500) from reading responses from another origin (this API
// on :3000) unless the API says it's allowed. This allows exactly ONE origin,
// from config, rather than '*'.
// It runs first so that even error responses (429, 400, 404) carry the CORS
// header. Otherwise the browser hides them behind a generic "CORS error" and
// the frontend can't show the real message.
// Note: CORS only restricts browsers. curl/Postman ignore it, which is why the
// admin key (not CORS) is what protects admin routes. X-Admin-Key is left out
// of allowedHeaders because admin calls don't come from a browser page yet.
app.use(cors({
    origin: config.frontend_origin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));

// App-wide rate limit. It runs before body parsing so a flood of requests is
// rejected cheaply, without reading or parsing their bodies.
app.use(apiLimiter);

// Parses JSON request bodies into req.body. It only acts on requests with
// Content-Type: application/json; for others, req.body stays undefined, so
// validators must handle a missing body.
// The 10kb cap: a booking is a few hundred bytes, and without a cap someone
// could send a huge body to exhaust server memory. Too large → 413, malformed
// → 400, both via errorHandler.
// No express.urlencoded(): the frontend will send JSON via fetch, not HTML
// form posts.
app.use(express.json({ limit: '10kb' }));

// ── Routers mount here (next steps), e.g. app.use('/api/services', ...) ──

// These two must stay LAST: notFound catches anything no router handled, and
// errorHandler (4 args) catches errors thrown by anything above it.
app.use(notFound);
app.use(errorHandler);

export { app };
