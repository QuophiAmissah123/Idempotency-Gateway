import dotenv from 'dotenv';
import app from './server';
import { initDb, clearExpiredRecords } from './db';

dotenv.config();

const PORT = process.env.PORT || 3000;
const TTL_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Clean up every hour
const TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours TTL

const startServer = async () => {
  try {
    // 1. Initialize the SQLite database schema
    await initDb();
    console.log('SQLite database initialized successfully.');

    // 2. Setup periodic clean-up for expired keys (Developer's Choice feature)
    setInterval(async () => {
      try {
        const deletedCount = await clearExpiredRecords(TTL_MS);
        if (deletedCount > 0) {
          console.log(`Periodic TTL Clean-up: Deleted ${deletedCount} expired key(s).`);
        }
      } catch (err) {
        console.error('Periodic TTL Clean-up failed:', err);
      }
    }, TTL_CLEANUP_INTERVAL_MS);

    // 3. Start the listening server
    app.listen(PORT, () => {
      console.log(`Idempotency Gateway listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start the Idempotency Gateway server:', error);
    process.exit(1);
  }
};

startServer();
