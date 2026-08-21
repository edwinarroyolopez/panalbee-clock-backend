import { createHash } from 'node:crypto';
import request from 'supertest';
import {
  seedTenant,
  startTestApp,
  stopTestApp,
  TestApp,
} from './booking-availability-test-app';
import { RecordingChannelAdapter } from './channel-test-support';

const ids = {
  tenantA: '8a000000-0000-4000-8000-000000000001',
  locationA: '8a000000-0000-4000-8000-000000000002',
  serviceA: '8a000000-0000-4000-8000-000000000003',
  staffA: '8a000000-0000-4000-8000-000000000004',
  customerA: '8a000000-0000-4000-8000-000000000005',
  ownerA: '8a000000-0000-4000-8000-000000000006',
  channelA: '8a000000-0000-4000-8000-000000000007',
  appointmentA: '8a000000-0000-4000-8000-000000000008',
  appointmentA2: '8a000000-0000-4000-8000-000000000009',
  foreignCustomerA: '8a000000-0000-4000-8000-000000000010',
  foreignAppointmentA: '8a000000-0000-4000-8000-000000000011',
  tenantB: '8b000000-0000-4000-8000-000000000001',
  locationB: '8b000000-0000-4000-8000-000000000002',
  serviceB: '8b000000-0000-4000-8000-000000000003',
  staffB: '8b000000-0000-4000-8000-000000000004',
  customerB: '8b000000-0000-4000-8000-000000000005',
  ownerB: '8b000000-0000-4000-8000-000000000006',
  channelB: '8b000000-0000-4000-8000-000000000007',
  appointmentB: '8b000000-0000-4000-8000-000000000008',
};

const phoneA = '+12025550141';

describe('customer phone access (security e2e)', () => {
  const adapter = new RecordingChannelAdapter();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startTestApp([adapter]);
    await seedTenant(testApp.database, {
      tenant: ids.tenantA,
      location: ids.locationA,
      service: ids.serviceA,
      staff: ids.staffA,
      customer: ids.customerA,
      owner: ids.ownerA,
      slug: 'customer-access-a',
      email: 'customer-access-a@example.test',
      phone: phoneA,
    });
    await seedTenant(testApp.database, {
      tenant: ids.tenantB,
      location: ids.locationB,
      service: ids.serviceB,
      staff: ids.staffB,
      customer: ids.customerB,
      owner: ids.ownerB,
      slug: 'customer-access-b',
      email: 'customer-access-b@example.test',
      phone: '+12025550142',
    });
    await testApp.database.models.channel.create([
      {
        _id: ids.channelA,
        tenantId: ids.tenantA,
        type: 'WHATSAPP',
        externalAccountId: 'customer-access-phone-a',
      },
      {
        _id: ids.channelB,
        tenantId: ids.tenantB,
        type: 'WHATSAPP',
        externalAccountId: 'customer-access-phone-b',
      },
    ]);
    await testApp.database.models.customer.create({
      _id: ids.foreignCustomerA,
      tenantId: ids.tenantA,
      fullName: 'Another Customer',
      phone: '+12025550143',
    });
    await testApp.database.models.appointment.create([
      appointment(ids.appointmentA, ids.customerA, '14:00', 'access-own-1'),
      appointment(ids.appointmentA2, ids.customerA, '16:00', 'access-own-2'),
      appointment(
        ids.foreignAppointmentA,
        ids.foreignCustomerA,
        '18:00',
        'access-foreign',
      ),
      {
        _id: ids.appointmentB,
        tenantId: ids.tenantB,
        locationId: ids.locationB,
        serviceId: ids.serviceB,
        staffId: ids.staffB,
        customerId: ids.customerB,
        startsAt: new Date('2099-09-02T14:00:00Z'),
        endsAt: new Date('2099-09-02T15:00:00Z'),
        idempotencyKey: 'access-tenant-b',
        requestFingerprint: 'access-tenant-b',
      },
    ]);
  });

  afterAll(async () => stopTestApp(testApp));

  it('returns the same accepted response without revealing customer existence', async () => {
    const path = '/api/v1/public/customer-access-a/customer-access/challenges';
    const existing = await request(testApp.server)
      .post(path)
      .send({ phone: phoneA })
      .expect(202)
      .expect('Cache-Control', 'private, no-store');
    const sentAfterExisting = adapter.sent.length;
    const missing = await request(testApp.server)
      .post(path)
      .send({ phone: '+12025550999' })
      .expect(202);

    expect(existing.body).toEqual({ accepted: true, expiresInSeconds: 600 });
    expect(missing.body).toEqual(existing.body);
    expect(adapter.sent).toHaveLength(sentAfterExisting);
    expect(adapter.sent[0]).toMatchObject({
      externalAccountId: 'customer-access-phone-a',
      recipientId: phoneA,
      intent: {
        kind: 'TEMPLATE',
        name: 'login_otp_temp',
        language: 'es_CO',
      },
    });
    const stored = await testApp.database.models.customerAccessChallenge
      .findOne({ tenantId: ids.tenantA, customerId: ids.customerA })
      .lean()
      .exec();
    const deliveredCode = codeFrom(adapter.sent[0]);
    expect(stored?.codeHash).not.toBe(deliveredCode);
    expect(JSON.stringify(stored)).not.toContain(phoneA);
  });

  it('keeps failed delivery rate-limited without leaving a usable code', async () => {
    adapter.failuresRemaining = 1;
    const before = adapter.sent.length;
    const path = '/api/v1/public/customer-access-a/customer-access/challenges';
    await request(testApp.server)
      .post(path)
      .send({ phone: '+12025550143' })
      .expect(202);
    expect(adapter.sent).toHaveLength(before + 1);

    const challenge = await testApp.database.models.customerAccessChallenge
      .findOne({ tenantId: ids.tenantA, customerId: ids.foreignCustomerA })
      .lean()
      .exec();
    expect(challenge?.codeExpiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    await request(testApp.server)
      .post(path)
      .send({ phone: '+12025550143' })
      .expect(202);
    expect(adapter.sent).toHaveLength(before + 1);
  });

  it('keeps concurrent requests anti-enumerating and delivers at most once', async () => {
    const before = adapter.sent.length;
    const path = '/api/v1/public/customer-access-b/customer-access/challenges';
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(testApp.server).post(path).send({ phone: '+12025550142' }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(
      Array(5).fill(202),
    );
    expect(responses.map((response) => response.body as unknown)).toEqual(
      Array(5).fill({ accepted: true, expiresInSeconds: 600 }),
    );
    expect(adapter.sent).toHaveLength(before + 1);
  });

  it('issues a hashed opaque session and scopes every appointment operation', async () => {
    const deliveredCode = codeFrom(adapter.sent[0]);
    const verified = await request(testApp.server)
      .post('/api/v1/public/customer-access-a/customer-access/sessions')
      .send({ phone: phoneA, code: deliveredCode })
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    const accessToken = (verified.body as { accessToken: string }).accessToken;
    expect(accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stored = await testApp.database.models.customerAccessChallenge
      .findOne({ tenantId: ids.tenantA, customerId: ids.customerA })
      .lean()
      .exec();
    expect(stored?.sessionTokenHash).toBe(
      createHash('sha256').update(accessToken).digest('hex'),
    );
    expect(stored?.sessionTokenHash).not.toBe(accessToken);

    const listPath = '/api/v1/public/customer-access-a/customer-appointments';
    const listed = await request(testApp.server)
      .get(listPath)
      .auth(accessToken, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(
      (listed.body as { items: Array<{ id: string }> }).items.map(
        (item) => item.id,
      ),
    ).toEqual([ids.appointmentA2, ids.appointmentA]);

    await request(testApp.server).get(listPath).expect(401);
    await request(testApp.server)
      .get('/api/v1/public/customer-access-b/customer-appointments')
      .auth(accessToken, { type: 'bearer' })
      .expect(401);
    await request(testApp.server)
      .post(
        `/api/v1/public/customer-access-a/customer-appointments/${ids.foreignAppointmentA}/cancel`,
      )
      .auth(accessToken, { type: 'bearer' })
      .send({ reason: 'Must not cross customer ownership' })
      .expect(404);

    await request(testApp.server)
      .post(
        `/api/v1/public/customer-access-a/customer-appointments/${ids.appointmentA2}/reschedule`,
      )
      .auth(accessToken, { type: 'bearer' })
      .send({ startsAt: '2099-09-03T15:00:00Z' })
      .expect(200)
      .expect(({ body }: { body: { startsAt: string } }) =>
        expect(body.startsAt).toBe('2099-09-03T15:00:00.000Z'),
      );
    await request(testApp.server)
      .post(
        `/api/v1/public/customer-access-a/customer-appointments/${ids.appointmentA}/cancel`,
      )
      .auth(accessToken, { type: 'bearer' })
      .send({ reason: 'Customer requested cancellation' })
      .expect(200);
  });

  it('enforces cooldown and consumes a code only once', async () => {
    const before = adapter.sent.length;
    const path = '/api/v1/public/customer-access-a/customer-access/challenges';
    await request(testApp.server)
      .post(path)
      .send({ phone: phoneA })
      .expect(202);
    expect(adapter.sent).toHaveLength(before);

    const code = codeFrom(adapter.sent[0]);
    await request(testApp.server)
      .post('/api/v1/public/customer-access-a/customer-access/sessions')
      .send({ phone: phoneA, code })
      .expect(401)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('CUSTOMER_ACCESS_CODE_INVALID'),
      );
  });
});

function appointment(
  id: string,
  customerId: string,
  hour: string,
  idempotencyKey: string,
) {
  return {
    _id: id,
    tenantId: ids.tenantA,
    locationId: ids.locationA,
    serviceId: ids.serviceA,
    staffId: ids.staffA,
    customerId,
    startsAt: new Date(`2099-09-02T${hour}:00Z`),
    endsAt: new Date(
      new Date(`2099-09-02T${hour}:00Z`).getTime() + 60 * 60 * 1000,
    ),
    idempotencyKey,
    requestFingerprint: idempotencyKey,
  };
}

function codeFrom(message: { intent: unknown }): string {
  const intent = message.intent as { variables?: readonly string[] };
  const code = intent.variables?.[0];
  if (!code) throw new Error('Expected a delivered verification code');
  return code;
}
