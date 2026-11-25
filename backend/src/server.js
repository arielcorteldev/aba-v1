// Importing config first means env validation runs before anything else.
// If a setting is missing or invalid, env.js throws and we never get further.
import { config } from './config/env.js';
import { verifyConnection } from './db/pool.js';
import { app } from './app.js';

// Prove the database is reachable BEFORE accepting traffic.
// Top-level await works because this is an ES module.
try {
    await verifyConnection();
    console.log('Database connected');
} catch (err) {
    console.error(err.message);
    // Non-zero exit code tells whoever started us (terminal, process manager)
    // that boot failed, instead of leaving a half-working server running.
    process.exit(1);
}

app.listen(config.port, () => {
    console.log(`Listening on port ${config.port}`);
});
