import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : path.join(__dirname, '../gateway.db');

export interface IdempotencyRecord {
  key: string;
  request_hash: string;
  response_status: number;
  response_body: string;
  created_at: number;
}

export const db = new sqlite3.Database(dbPath);

export const initDb = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        response_body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

export const getRecord = (key: string): Promise<IdempotencyRecord | null> => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT key, request_hash, response_status, response_body, created_at FROM idempotency_keys WHERE key = ?',
      [key],
      (err, row) => {
        if (err) reject(err);
        else resolve((row as IdempotencyRecord) || null);
      }
    );
  });
};

export const saveRecord = (
  key: string,
  requestHash: string,
  status: number,
  body: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const createdAt = Date.now();
    db.run(
      'INSERT OR REPLACE INTO idempotency_keys (key, request_hash, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?)',
      [key, requestHash, status, body, createdAt],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

export const deleteRecord = (key: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM idempotency_keys WHERE key = ?', [key], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

export const clearExpiredRecords = (ttlMs: number): Promise<number> => {
  return new Promise((resolve, reject) => {
    const cutoff = Date.now() - ttlMs;
    db.run('DELETE FROM idempotency_keys WHERE created_at < ?', [cutoff], function(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
};

export const closeDb = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};
