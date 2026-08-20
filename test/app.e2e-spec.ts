import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import request from 'supertest';
import { clearMongo, createCoreTestApplication } from './core-test-app';

interface ErrorBody {
  statusCode: number;
  reasonCode: string;
  message: string;
  requestId: string;
  stack?: unknown;
}

describe('application foundation (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const testApp = await createCoreTestApplication();
    app = testApp.app;
    server = testApp.server;
    await clearMongo(testApp.database);
  });

  afterAll(async () => app.close());

  it('serves live and replica-set-backed ready checks under /api/v1', async () => {
    await request(server)
      .get('/api/v1/health/live')
      .expect(200)
      .expect({ status: 'ok' });
    await request(server)
      .get('/api/v1/health/ready')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('rejects unknown DTO authority fields', async () => {
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner-a@example.test',
        password: 'correct-password',
        tenantId: '10000000-0000-4000-8000-000000000001',
      })
      .expect(400);
    const body = response.body as ErrorBody;

    expect(body.reasonCode).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(body)).toContain('tenantId');
  });

  it('returns a safe stable error and preserves a safe request ID', async () => {
    const requestId = 'foundation-test-request';
    const response = await request(server)
      .get('/api/v1/not-a-route')
      .set('x-request-id', requestId)
      .expect(404);
    const body = response.body as ErrorBody;

    expect(response.headers['x-request-id']).toBe(requestId);
    expect(body).toEqual({
      statusCode: 404,
      reasonCode: 'NOT_FOUND',
      message: 'Resource not found',
      requestId,
    });
    expect(body.stack).toBeUndefined();
  });

  it('applies the configured CORS allowlist', async () => {
    const allowed = await request(server)
      .get('/api/v1/health/live')
      .set('origin', 'http://localhost:3001')
      .expect(200);
    const denied = await request(server)
      .get('/api/v1/health/live')
      .set('origin', 'https://attacker.example.test')
      .expect(200);

    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:3001',
    );
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('bounds JSON payloads with a safe error envelope', async () => {
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner-a@example.test',
        password: 'correct-password',
        padding: 'x'.repeat(110_000),
      })
      .expect(413);
    const body = response.body as ErrorBody;

    expect(body).toMatchObject({
      statusCode: 413,
      reasonCode: 'PAYLOAD_TOO_LARGE',
      message: 'Request payload is too large',
    });
    expect(body.requestId).toEqual(expect.any(String));
  });
});
