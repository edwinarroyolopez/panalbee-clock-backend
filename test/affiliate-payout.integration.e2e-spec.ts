import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AffiliateLedgerService } from '../src/affiliates/affiliate-ledger.service';
import { hashPassword } from '../src/auth/password';
import {
  login,
  seedTenant,
  startTestApp,
  stopTestApp,
  TestApp,
} from './booking-availability-test-app';

const ids = {
  tenant: '75000000-0000-4000-8000-000000000001',
  location: '75000000-0000-4000-8000-000000000002',
  service: '75000000-0000-4000-8000-000000000003',
  staff: '75000000-0000-4000-8000-000000000004',
  seedCustomer: '75000000-0000-4000-8000-000000000005',
  owner: '75000000-0000-4000-8000-000000000006',
  manager: '75000000-0000-4000-8000-000000000007',
  staffUser: '75000000-0000-4000-8000-000000000008',
};

describe('affiliate payout (integration e2e)', () => {
  let testApp: TestApp;
  let token: string;
  let managerToken: string;
  let staffToken: string;
  let ledgerService: AffiliateLedgerService;
  let customerSequence = 0;

  beforeAll(async () => {
    testApp = await startTestApp();
    ledgerService = testApp.app.get(AffiliateLedgerService);
    await seedTenant(testApp.database, {
      tenant: ids.tenant,
      location: ids.location,
      service: ids.service,
      staff: ids.staff,
      customer: ids.seedCustomer,
      owner: ids.owner,
      slug: 'affiliate-payout',
      email: 'affiliate-payout@example.test',
      phone: '+573007500001',
    });
    const passwordHash = await hashPassword('correct-password');
    await testApp.database.models.user.insertMany([
      {
        _id: ids.manager,
        email: 'affiliate-manager@example.test',
        displayName: 'Affiliate Manager',
        passwordHash,
        actorType: 'TENANT',
      },
      {
        _id: ids.staffUser,
        email: 'affiliate-staff@example.test',
        displayName: 'Affiliate Staff',
        passwordHash,
        actorType: 'TENANT',
      },
    ]);
    await testApp.database.models.tenantMembership.insertMany([
      { tenantId: ids.tenant, userId: ids.manager, role: 'MANAGER' },
      { tenantId: ids.tenant, userId: ids.staffUser, role: 'STAFF' },
    ]);
    token = await login(testApp.server, 'affiliate-payout@example.test');
    managerToken = await login(
      testApp.server,
      'affiliate-manager@example.test',
    );
    staffToken = await login(testApp.server, 'affiliate-staff@example.test');
  });

  afterAll(async () => stopTestApp(testApp));

  it('reserves available value and replays only the exact create command', async () => {
    const customerId = await seedBalance(1_000);
    const payload = {
      idempotencyKey: 'create-payout-exact',
      currency: 'COP',
      amountMinor: 600,
      externalReference: ' INITIAL-REF ',
    };
    const created = await create(customerId, payload).expect(201);
    const createdBody = created.body as {
      id: string;
      externalReference: string;
    };
    const payoutId = createdBody.id;
    expect(createdBody.externalReference).toBe('INITIAL-REF');
    const replay = await create(customerId, payload).expect(201);
    expect(replay.body as unknown).toEqual(created.body as unknown);
    await create(customerId, { ...payload, amountMinor: 500 })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('AFFILIATE_PAYOUT_IDEMPOTENCY_CONFLICT'),
      );
    await create(customerId, { ...payload, tenantId: randomUUID() }).expect(
      400,
    );

    const detail = await affiliateDetail(customerId);
    expect(detail.balances).toEqual([
      expect.objectContaining({
        currency: 'COP',
        balanceMinor: 1_000,
        reservedMinor: 600,
        availableMinor: 400,
      }),
    ]);
    expect(detail.payouts).toEqual([
      expect.objectContaining({ id: payoutId, status: 'PROCESSING' }),
    ]);
    expect(
      await testApp.database.models.auditEvent.countDocuments({
        action: 'AFFILIATE_PAYOUT_CREATED',
        entityId: payoutId,
      }),
    ).toBe(1);
  });

  it('rejects insufficient value and serializes competing reservations', async () => {
    const customerId = await seedBalance(1_000);
    await create(customerId, {
      idempotencyKey: 'payout-unsafe-integer',
      currency: 'COP',
      amountMinor: Number.MAX_SAFE_INTEGER + 1,
    }).expect(400);
    await create(customerId, {
      idempotencyKey: 'payout-too-large',
      currency: 'COP',
      amountMinor: 1_001,
    }).expect(409);
    const responses = await Promise.all([
      create(customerId, {
        idempotencyKey: 'payout-race-one',
        currency: 'COP',
        amountMinor: 700,
      }),
      create(customerId, {
        idempotencyKey: 'payout-race-two',
        currency: 'COP',
        amountMinor: 700,
      }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(
      await testApp.database.models.affiliatePayout.countDocuments({
        tenantId: ids.tenant,
        affiliateCustomerId: customerId,
        status: 'PROCESSING',
      }),
    ).toBe(1);
  });

  it('serializes commission reversals with payout reservations', async () => {
    const customerId = await seedBalance(1_000);
    const original = await testApp.database.models.affiliateLedgerEntry
      .findOne({
        tenantId: ids.tenant,
        affiliateCustomerId: customerId,
        type: 'COMMISSION_EARNED',
      })
      .lean()
      .exec();
    expect(original).toBeTruthy();
    const [payoutResponse, reversalResult] = await Promise.all([
      create(customerId, {
        idempotencyKey: 'reversal-payout-race',
        currency: 'COP',
        amountMinor: 1_000,
      }),
      ledgerService
        .reverseCommission(
          ids.tenant,
          original!._id,
          'Concurrent payout reservation race',
          'reversal-payout-race',
        )
        .then(() => ({ status: 200, reasonCode: null }))
        .catch((error: { statusCode?: number; reasonCode?: string }) => ({
          status: error.statusCode,
          reasonCode: error.reasonCode,
        })),
    ]);
    const outcomes = [
      {
        status: payoutResponse.status,
        reasonCode: (payoutResponse.body as { reasonCode?: string }).reasonCode,
      },
      reversalResult,
    ];
    expect(outcomes.filter(({ status }) => status === 409)).toHaveLength(1);
    expect(
      outcomes.filter(({ status }) => status === 200 || status === 201),
    ).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === 409)?.reasonCode).toMatch(
      /^AFFILIATE_(?:PAYOUT|COMMISSION)_INSUFFICIENT_AVAILABLE$/,
    );
    const detail = await affiliateDetail(customerId);
    expect(detail.balances[0]).toEqual(
      expect.objectContaining({ availableMinor: 0 }),
    );
  });

  it('returns one coherent detail snapshot while a payout settles', async () => {
    const customerId = await seedBalance(1_000);
    const payout = await createdPayout(customerId, 600, 'snapshot-create-key');
    const [detail] = await Promise.all([
      affiliateDetail(customerId),
      transition(customerId, payout.id, 'paid', {
        idempotencyKey: 'snapshot-paid-key',
        externalReference: 'SNAPSHOT-BANK-PAID',
      }).expect(200),
    ]);
    const balance = detail.balances[0] as Record<string, number>;
    const payoutView = detail.payouts[0] as { status: string };
    if (payoutView.status === 'PROCESSING') {
      expect(balance).toMatchObject({
        paidMinor: 0,
        reservedMinor: 600,
        balanceMinor: 1_000,
        availableMinor: 400,
      });
    } else {
      expect(payoutView.status).toBe('PAID');
      expect(balance).toMatchObject({
        paidMinor: 600,
        reservedMinor: 0,
        balanceMinor: 400,
        availableMinor: 400,
      });
    }
  });

  it('bounds payout history and reports truncation without truncating balances', async () => {
    const customerId = await seedBalance(1_000);
    const processingPayout = await createdPayout(
      customerId,
      200,
      'bounded-processing-payout',
    );
    await testApp.database.models.affiliatePayout.insertMany(
      Array.from({ length: 101 }, (_, index) => ({
        tenantId: ids.tenant,
        affiliateCustomerId: customerId,
        currency: 'COP',
        amountMinor: 1,
        method: 'MANUAL',
        status: 'CANCELLED',
        createdByUserId: ids.owner,
        createIdempotencyKey: `bounded-history-${customerId}-${index}`,
        reason: 'Historical cancellation',
        cancelledAt: new Date(),
      })),
    );
    const detail = await affiliateDetail(customerId);
    expect(detail.payouts).toHaveLength(100);
    expect(detail.payouts).toContainEqual(
      expect.objectContaining({
        id: processingPayout.id,
        status: 'PROCESSING',
      }),
    );
    expect(detail.history).toMatchObject({
      limit: 100,
      payoutsTruncated: true,
    });
    expect(detail.balances[0]).toMatchObject({
      earnedMinor: 1_000,
      reservedMinor: 200,
      availableMinor: 800,
    });
  });

  it('bounds active reservations so every processing payout remains actionable', async () => {
    const customerId = await seedBalance(1_000);
    await testApp.database.models.affiliatePayout.insertMany(
      Array.from({ length: 100 }, (_, index) => ({
        tenantId: ids.tenant,
        affiliateCustomerId: customerId,
        currency: 'COP',
        amountMinor: 1,
        method: 'MANUAL',
        status: 'PROCESSING',
        createdByUserId: ids.owner,
        createIdempotencyKey: `processing-capacity-${customerId}-${index}`,
      })),
    );
    await create(customerId, {
      idempotencyKey: 'processing-capacity-overflow',
      currency: 'COP',
      amountMinor: 1,
    })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('AFFILIATE_PAYOUT_PROCESSING_LIMIT'),
      );
    const detail = await affiliateDetail(customerId);
    expect(detail.payouts).toHaveLength(100);
    expect(detail.payouts.every(({ status }) => status === 'PROCESSING')).toBe(
      true,
    );
    expect(detail.balances[0]).toMatchObject({
      reservedMinor: 100,
      availableMinor: 900,
    });
  });

  it('serializes the processing cap across payout currencies', async () => {
    const customerId = await seedBalance(1_000);
    await testApp.database.models.affiliateLedgerEntry.create({
      tenantId: ids.tenant,
      affiliateCustomerId: customerId,
      currency: 'USD',
      direction: 'CREDIT',
      type: 'COMMISSION_EARNED',
      amountMinor: 1_000,
      idempotencyKey: `seed-usd-credit-${customerId}`,
    });
    await testApp.database.models.affiliateBalanceLock.create({
      tenantId: ids.tenant,
      affiliateCustomerId: customerId,
      currency: 'USD',
    });
    await testApp.database.models.affiliatePayout.insertMany(
      Array.from({ length: 99 }, (_, index) => ({
        tenantId: ids.tenant,
        affiliateCustomerId: customerId,
        currency: 'COP',
        amountMinor: 1,
        method: 'MANUAL',
        status: 'PROCESSING',
        createdByUserId: ids.owner,
        createIdempotencyKey: `cross-currency-cap-${customerId}-${index}`,
      })),
    );
    const responses = await Promise.all([
      create(customerId, {
        idempotencyKey: 'cross-currency-cap-cop',
        currency: 'COP',
        amountMinor: 1,
      }),
      create(customerId, {
        idempotencyKey: 'cross-currency-cap-usd',
        currency: 'USD',
        amountMinor: 1,
      }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(
      (
        responses.find(({ status }) => status === 409)?.body as {
          reasonCode: string;
        }
      ).reasonCode,
    ).toBe('AFFILIATE_PAYOUT_PROCESSING_LIMIT');
    expect(
      await testApp.database.models.affiliatePayout.countDocuments({
        tenantId: ids.tenant,
        affiliateCustomerId: customerId,
        status: 'PROCESSING',
      }),
    ).toBe(100);
  });

  it('marks paid once, appends one debit, and rejects terminal conflicts', async () => {
    const customerId = await seedBalance(1_000);
    const createPayload = {
      idempotencyKey: 'paid-create-key',
      currency: 'COP',
      amountMinor: 600,
      externalReference: 'PAYOUT-BATCH-7',
    };
    const created = await create(customerId, createPayload).expect(201);
    const payout = created.body as { id: string };
    const paid = {
      idempotencyKey: 'paid-terminal-key',
      externalReference: ' BANK-SETTLED-123 ',
    };
    await transition(customerId, payout.id, 'paid', paid).expect(200);
    await transition(customerId, payout.id, 'paid', paid).expect(200);
    await transition(customerId, payout.id, 'paid', {
      ...paid,
      externalReference: 'BANK-DIFFERENT',
    }).expect(409);
    await transition(customerId, payout.id, 'failed', {
      idempotencyKey: 'failed-after-paid',
      reason: 'Provider reported a failure',
    }).expect(409);
    const createReplay = await create(customerId, createPayload).expect(201);
    expect(
      createReplay.body as { status: string; externalReference: string },
    ).toMatchObject({ status: 'PAID', externalReference: 'BANK-SETTLED-123' });

    const entries = await testApp.database.models.affiliateLedgerEntry
      .find({ payoutId: payout.id })
      .lean();
    expect(entries).toEqual([
      expect.objectContaining({
        type: 'PAYOUT_PAID',
        direction: 'DEBIT',
        amountMinor: 600,
        idempotencyKey: `payout:${payout.id}`,
      }),
    ]);
    const detail = await affiliateDetail(customerId);
    expect(detail.balances[0]).toMatchObject({
      earnedMinor: 1_000,
      paidMinor: 600,
      reservedMinor: 0,
      balanceMinor: 400,
      availableMinor: 400,
    });
    expect(detail.payouts[0]).toMatchObject({
      status: 'PAID',
      externalReference: 'BANK-SETTLED-123',
    });
    expect(
      await testApp.database.models.auditEvent.countDocuments({
        action: 'AFFILIATE_PAYOUT_PAID',
        entityId: payout.id,
      }),
    ).toBe(1);
  });

  it('fails idempotently without a debit and releases the reservation', async () => {
    const customerId = await seedBalance(1_000);
    const payout = await createdPayout(customerId, 600, 'failed-create-key');
    const failed = {
      idempotencyKey: 'failed-terminal-key',
      reason: 'External transfer was rejected',
    };
    await transition(customerId, payout.id, 'failed', failed).expect(200);
    await transition(customerId, payout.id, 'failed', failed).expect(200);
    await transition(customerId, payout.id, 'failed', {
      ...failed,
      reason: 'Different terminal reason',
    }).expect(409);
    expect(
      await testApp.database.models.affiliateLedgerEntry.countDocuments({
        payoutId: payout.id,
      }),
    ).toBe(0);
    const detail = await affiliateDetail(customerId);
    expect(detail.balances[0]).toMatchObject({
      paidMinor: 0,
      reservedMinor: 0,
      balanceMinor: 1_000,
      availableMinor: 1_000,
    });
    expect(detail.payouts[0]).toMatchObject({
      status: 'FAILED',
      reason: failed.reason,
    });
  });

  it('cancels idempotently without a debit and releases the reservation', async () => {
    const customerId = await seedBalance(1_000);
    const payout = await createdPayout(customerId, 600, 'cancel-create-key');
    const cancelled = {
      idempotencyKey: 'cancel-terminal-key',
      reason: 'Operator created the reservation by mistake',
    };
    await transition(customerId, payout.id, 'cancelled', cancelled).expect(200);
    await transition(customerId, payout.id, 'cancelled', cancelled).expect(200);
    await transition(customerId, payout.id, 'cancelled', {
      ...cancelled,
      reason: 'A conflicting cancellation reason',
    }).expect(409);
    expect(
      await testApp.database.models.affiliateLedgerEntry.countDocuments({
        payoutId: payout.id,
      }),
    ).toBe(0);
    const detail = await affiliateDetail(customerId);
    expect(detail.balances[0]).toMatchObject({
      paidMinor: 0,
      reservedMinor: 0,
      availableMinor: 1_000,
    });
    expect(detail.payouts[0]).toMatchObject({
      status: 'CANCELLED',
      reason: cancelled.reason,
    });
    expect(
      await testApp.database.models.auditEvent.countDocuments({
        action: 'AFFILIATE_PAYOUT_CANCELLED',
        entityId: payout.id,
      }),
    ).toBe(1);
  });

  it('keeps Customer and payout ids scoped to the authenticated Tenant', async () => {
    const customerId = await seedBalance(1_000);
    const otherCustomerId = await seedBalance(1_000);
    const payout = await createdPayout(customerId, 200, 'scoped-create-key');
    await transition(otherCustomerId, payout.id, 'paid', {
      idempotencyKey: 'foreign-payout-terminal',
      externalReference: 'BANK-FOREIGN',
    }).expect(404);
    await create(randomUUID(), {
      idempotencyKey: 'foreign-customer-create',
      currency: 'COP',
      amountMinor: 100,
    }).expect(404);
  });

  it('allows direct managers and denies staff payout mutations', async () => {
    const customerId = await seedBalance(1_000);
    const managerPayout = await create(
      customerId,
      {
        idempotencyKey: 'manager-create-payout',
        currency: 'COP',
        amountMinor: 200,
      },
      managerToken,
    ).expect(201);
    const payoutId = (managerPayout.body as { id: string }).id;
    await transition(
      customerId,
      payoutId,
      'cancelled',
      {
        idempotencyKey: 'manager-cancel-payout',
        reason: 'Manager corrected an accidental reservation',
      },
      managerToken,
    ).expect(200);
    await create(
      customerId,
      {
        idempotencyKey: 'staff-create-denied',
        currency: 'COP',
        amountMinor: 100,
      },
      staffToken,
    ).expect(403);
    await transition(
      customerId,
      payoutId,
      'paid',
      {
        idempotencyKey: 'staff-terminal-denied',
        externalReference: 'STAFF-NOT-ALLOWED',
      },
      staffToken,
    ).expect(403);
  });

  function create(
    customerId: string,
    payload: Record<string, unknown>,
    authToken = token,
  ) {
    return request(testApp.server)
      .post(`/api/v1/customers/${customerId}/affiliate-payouts`)
      .auth(authToken, { type: 'bearer' })
      .set('x-request-id', `request-${String(payload.idempotencyKey)}`)
      .send(payload);
  }

  function transition(
    customerId: string,
    payoutId: string,
    action: 'paid' | 'failed' | 'cancelled',
    payload: Record<string, unknown>,
    authToken = token,
  ) {
    return request(testApp.server)
      .post(
        `/api/v1/customers/${customerId}/affiliate-payouts/${payoutId}/${action}`,
      )
      .auth(authToken, { type: 'bearer' })
      .set('x-request-id', `request-${String(payload.idempotencyKey)}`)
      .send(payload);
  }

  async function createdPayout(
    customerId: string,
    amountMinor: number,
    idempotencyKey: string,
  ): Promise<{ id: string }> {
    const response = await create(customerId, {
      idempotencyKey,
      currency: 'COP',
      amountMinor,
    }).expect(201);
    return response.body as { id: string };
  }

  async function affiliateDetail(customerId: string): Promise<{
    balances: Array<Record<string, unknown>>;
    payouts: Array<Record<string, unknown>>;
    history: Record<string, unknown>;
  }> {
    const response = await request(testApp.server)
      .get(`/api/v1/customers/${customerId}/affiliate`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    return response.body as {
      balances: Array<Record<string, unknown>>;
      payouts: Array<Record<string, unknown>>;
      history: Record<string, unknown>;
    };
  }

  async function seedBalance(amountMinor: number): Promise<string> {
    customerSequence += 1;
    const customerId = randomUUID();
    await testApp.database.models.customer.create({
      _id: customerId,
      tenantId: ids.tenant,
      fullName: `Payout Customer ${customerSequence}`,
      phone: `+5730076${String(customerSequence).padStart(5, '0')}`,
    });
    await testApp.database.models.affiliateLedgerEntry.create({
      tenantId: ids.tenant,
      affiliateCustomerId: customerId,
      currency: 'COP',
      direction: 'CREDIT',
      type: 'COMMISSION_EARNED',
      amountMinor,
      idempotencyKey: `seed-credit-${customerId}`,
    });
    await testApp.database.models.affiliateBalanceLock.create({
      tenantId: ids.tenant,
      affiliateCustomerId: customerId,
      currency: 'COP',
    });
    await testApp.database.models.affiliatePayoutCapacityLock.create({
      tenantId: ids.tenant,
      affiliateCustomerId: customerId,
    });
    return customerId;
  }
});
