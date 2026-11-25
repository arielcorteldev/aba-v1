// An EXPECTED failure: the request was understood, but the business rules say
// no (slot full, already booked, reference number not found...).
//
// Why a custom class instead of plain `throw new Error(...)`?
// errorHandler.js must tell two kinds of errors apart:
//   - AppError       → safe to show: send its status, code and message as-is
//   - anything else  → a bug or outage: log it, send a generic 500
// `err instanceof AppError` makes that check exact. Without it, the handler
// would have to guess from the message text, or leak internal errors.
//
// Usage (in a model):
//   throw new AppError(409, 'SLOT_FULL', 'This time slot is already full.');
class AppError extends Error {
    constructor(status, code, message) {
        // Error's constructor sets this.message (and captures the stack trace)
        super(message);
        // Shows "AppError: ..." in logs instead of "Error: ..."
        this.name = 'AppError';
        // HTTP status code to send, e.g. 404, 409, 422
        this.status = status;
        // Machine-readable code the frontend branches on; never reworded
        this.code = code;
    }
}

export { AppError };
