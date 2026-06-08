import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getRecord, saveRecord, deleteRecord } from './db';
import { lockManager } from './locks';

// TTL: 24 Hours (in milliseconds)
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Computes a SHA-256 hash of the request body.
 * Sorts object keys to ensure deterministic hashes.
 */
export const computeHash = (body: any): string => {
  if (!body) return crypto.createHash('sha256').update('').digest('hex');
  const normalized = typeof body === 'object'
    ? JSON.stringify(body, Object.keys(body).sort())
    : String(body);
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const key = req.header('Idempotency-Key');

  // Validate presence and type of the key
  if (!key || typeof key !== 'string' || key.trim() === '') {
    return res.status(400).json({ error: 'Idempotency-Key header is required and must be a non-empty string.' });
  }

  // Only apply idempotency to write operations (POST)
  if (req.method !== 'POST') {
    return next();
  }

  const requestHash = computeHash(req.body);

  try {
    // 1. Query database for an existing key
    let record = await getRecord(key);

    if (record) {
      const isExpired = Date.now() - record.created_at > TTL_MS;
      if (isExpired) {
        // Expired: delete record and proceed as new request
        await deleteRecord(key);
        record = null;
      } else {
        // Verify request payload matches the stored one
        if (record.request_hash === requestHash) {
          res.set('X-Cache-Hit', 'true');
          res.set('Content-Type', 'application/json');
          return res.status(record.response_status).send(record.response_body);
        } else {
          // Key reused for a different payload -> return 409 Conflict
          return res.status(409).json({
            error: 'Idempotency key already used for a different request body.'
          });
        }
      }
    }

    // 2. Lock & block concurrent requests ("In-Flight" check)
    let acquired = false;
    while (!acquired) {
      acquired = await lockManager.acquire(key);
      if (!acquired) {
        // Blocked request woke up. Check if the primary request succeeded and cached the result.
        const cachedRecord = await getRecord(key);
        if (cachedRecord) {
          res.set('X-Cache-Hit', 'true');
          res.set('Content-Type', 'application/json');
          return res.status(cachedRecord.response_status).send(cachedRecord.response_body);
        }
        // If there's no record, the primary request failed/errored.
        // We loop again to try and acquire the lock ourselves.
      }
    }

    // 3. Lock acquired successfully
    let released = false;
    const releaseLock = () => {
      if (!released) {
        lockManager.release(key);
        released = true;
      }
    };

    res.on('finish', releaseLock);
    res.on('close', releaseLock);

    // Intercept outgoing response
    const originalSend = res.send;
    res.send = function (body?: any): Response {
      res.send = originalSend;

      // Only cache successful payment processing responses (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        let bodyString = '';
        if (typeof body === 'string') {
          bodyString = body;
        } else if (body instanceof Buffer) {
          bodyString = body.toString('utf8');
        } else if (body !== undefined) {
          bodyString = JSON.stringify(body);
        }

        saveRecord(key, requestHash, res.statusCode, bodyString)
          .then(() => releaseLock())
          .catch((err) => {
            console.error('Failed to save idempotency record:', err);
            releaseLock();
          });
      } else {
        releaseLock();
      }

      return originalSend.call(this, body);
    };

    next();
  } catch (error) {
    lockManager.release(key);
    next(error);
  }
};
