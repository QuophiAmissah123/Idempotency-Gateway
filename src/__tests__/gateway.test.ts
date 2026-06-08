import request from 'supertest';
import app from '../server';
import { initDb, closeDb, db } from '../db';
import { lockManager } from '../locks';

describe('Idempotency Gateway Integration Tests', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach((done) => {
    // Clear DB between tests
    db.run('DELETE FROM idempotency_keys', [], () => done());
  });

  it('should process a new payment request successfully (Happy Path)', async () => {
    const key = `key-happy-${Date.now()}`;
    const body = { amount: 100, currency: 'GHS' };

    const startTime = Date.now();
    const response = await request(app)
      .post('/process-payment')
      .set('Idempotency-Key', key)
      .send(body);
    const duration = Date.now() - startTime;

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Charged 100 GHS' });
    expect(response.header['x-cache-hit']).toBeUndefined();
    // Verify that the 2-second processing delay was simulated
    expect(duration).toBeGreaterThanOrEqual(1900);
  });

  it('should return cached response immediately for duplicate request', async () => {
    const key = `key-dup-${Date.now()}`;
    const body = { amount: 150, currency: 'USD' };

    // First request
    const res1 = await request(app)
      .post('/process-payment')
      .set('Idempotency-Key', key)
      .send(body);
    expect(res1.status).toBe(200);

    // Duplicate request
    const startTime = Date.now();
    const res2 = await request(app)
      .post('/process-payment')
      .set('Idempotency-Key', key)
      .send(body);
    const duration = Date.now() - startTime;

    expect(res2.status).toBe(200);
    expect(res2.body).toEqual(res1.body);
    expect(res2.header['x-cache-hit']).toBe('true');
    // Duplicate request must return immediately (well below 2 seconds)
    expect(duration).toBeLessThan(200);
  });

  it('should reject a reused key with different request payload (Conflict)', async () => {
    const key = `key-conflict-${Date.now()}`;
    const body1 = { amount: 100, currency: 'EUR' };
    const body2 = { amount: 200, currency: 'EUR' };

    // First request
    const res1 = await request(app)
      .post('/process-payment')
      .set('Idempotency-Key', key)
      .send(body1);
    expect(res1.status).toBe(200);

    // Second request with different body
    const res2 = await request(app)
      .post('/process-payment')
      .set('Idempotency-Key', key)
      .send(body2);

    expect(res2.status).toBe(409);
    expect(res2.body).toEqual({
      error: 'Idempotency key already used for a different request body.'
    });
  });

  it('should validate presence of Idempotency-Key header', async () => {
    const response = await request(app)
      .post('/process-payment')
      .send({ amount: 100, currency: 'GHS' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Idempotency-Key header is required');
  });

  it('should validate request body fields', async () => {
    const key = `key-val-${Date.now()}`;

    // Invalid amount
    const res1 = await request(app)
      .post('/process-payment')
      .set('Idempotency-Key', key)
      .send({ amount: -10, currency: 'GHS' });
    expect(res1.status).toBe(400);

    // Missing currency
    const res2 = await request(app)
      .post('/process-payment')
      .set('Idempotency-Key', key)
      .send({ amount: 100 });
    expect(res2.status).toBe(400);
  });

  it('should handle concurrent identical requests safely without double processing (In-Flight lock)', async () => {
    const key = `key-concurrent-${Date.now()}`;
    const body = { amount: 300, currency: 'GHS' };

    const startTime = Date.now();
    // Fire two identical requests in parallel
    const [res1, res2] = await Promise.all([
      request(app).post('/process-payment').set('Idempotency-Key', key).send(body),
      request(app).post('/process-payment').set('Idempotency-Key', key).send(body)
    ]);
    const duration = Date.now() - startTime;

    // Both should succeed and return same response
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body).toEqual({ message: 'Charged 300 GHS' });
    expect(res2.body).toEqual({ message: 'Charged 300 GHS' });

    // One of them is the primary, the other is cached
    const hits = [res1.header['x-cache-hit'], res2.header['x-cache-hit']];
    expect(hits).toContain('true');
    expect(hits).toContain(undefined);

    // The total time should be around 2 seconds, not 4 seconds,
    // because the second blocked request resolved immediately after the first finished.
    expect(duration).toBeGreaterThanOrEqual(1900);
    expect(duration).toBeLessThan(2500);
  });

  it('should ignore and clean up expired keys (TTL expiration)', async () => {
    const key = `key-ttl-${Date.now()}`;
    const body = { amount: 50, currency: 'GHS' };

    // First request
    const res1 = await request(app)
      .post('/process-payment')
      .set('Idempotency-Key', key)
      .send(body);
    expect(res1.status).toBe(200);

    // Simulate key expiration by updating created_at to 25 hours ago
    const expiredTime = Date.now() - 25 * 60 * 60 * 1000;
    await new Promise<void>((resolve, reject) => {
      db.run(
        'UPDATE idempotency_keys SET created_at = ? WHERE key = ?',
        [expiredTime, key],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Second request with same key should be treated as a fresh request (with delay)
    const startTime = Date.now();
    const res2 = await request(app)
      .post('/process-payment')
      .set('Idempotency-Key', key)
      .send(body);
    const duration = Date.now() - startTime;

    expect(res2.status).toBe(200);
    expect(res2.header['x-cache-hit']).toBeUndefined();
    expect(duration).toBeGreaterThanOrEqual(1900);
  });
});
