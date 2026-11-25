// Every error response in the API uses one shape:
//   { error: { code: 'MACHINE_READABLE', message: 'Human readable' } }
// `code` is for the frontend to branch on (it never changes wording);
// `message` is safe to show to the citizen.

// Runs when no route matched. It sits after every router in app.js, so
// reaching it means "nobody handled this URL". It returns JSON instead of
// Express's default HTML "Cannot GET /x" page.
function notFound(req, res) {
    res.status(404).json({
        error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
    });
}

// Express recognises an error handler by its FOUR parameters. Keep `next` in
// the signature even if unused, or Express treats this as normal middleware.
//
// Errors arrive here from:
//   - express.json() when the body is malformed or too big
//   - any controller/model that throws. In Express 5, a rejected promise from
//     an async handler is forwarded here automatically, so controllers don't
//     need their own try/catch just to pass errors along.
function errorHandler(err, req, res, next) {
    // If a response already started streaming, we can't send a new status or
    // body. Hand off to Express's built-in handler, which closes the connection.
    if (res.headersSent) {
        return next(err);
    }

    // body-parser (used by express.json) tags its errors with a `type`.
    // These are client mistakes, so they get 4xx codes, not 500.
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({
            error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' },
        });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({
            error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
        });
    }

    // Anything else is unexpected: a bug, or the database being down.
    // Log the full error (with stack) server-side so we can debug it, but send
    // the client only a generic message. Stack traces and SQL errors can
    // reveal table names, file paths and query structure to an attacker.
    // (Later steps add specific cases above this line, e.g. Postgres 23505
    // from uq_active_booking → "you already have this booking".)
    console.error(err);
    return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again later.' },
    });
}

export { notFound, errorHandler };
