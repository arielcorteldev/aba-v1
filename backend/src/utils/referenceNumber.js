import { randomInt } from 'node:crypto';

// The short code a citizen gets after booking (stored in
// appointments.reference_number, VARCHAR(12)). Staff type it at check-in, and
// together with the email it is the citizen's "proof" for cancelling.
//
// Why random and not sequential (ABA-0001, ABA-0002...)?
// A sequence is guessable: anyone could try neighbouring numbers. A random
// code from a large space can't be enumerated.
//
// Why crypto.randomInt and not Math.random?
// Math.random is not cryptographically secure; its output can be predicted
// from earlier values. randomInt uses the OS's secure random source and is
// also unbiased (every character is exactly equally likely).

// 31 characters: A–Z and 2–9, minus the look-alikes 0/O, 1/I/L. Citizens read
// this off a phone screen or say it aloud at the counter, so "is that an O or
// a zero?" should never come up.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// 8 characters → 31^8 ≈ 850 billion possible codes. Collisions are extremely
// rare, but not impossible, so the appointment model still inserts with
// ON CONFLICT (reference_number) DO NOTHING and retries with a fresh code.
const LENGTH = 8;

function generateReferenceNumber() {
    let code = '';
    for (let i = 0; i < LENGTH; i += 1) {
        // randomInt(max) returns 0 ≤ n < max, i.e. a valid index into ALPHABET
        code += ALPHABET[randomInt(ALPHABET.length)];
    }
    return code;
}

export { generateReferenceNumber };
