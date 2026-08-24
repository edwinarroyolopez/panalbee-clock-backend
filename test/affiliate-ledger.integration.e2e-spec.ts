import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AffiliateCodeService } from '../src/affiliates/affiliate-code.service';
import { AffiliateLedgerService } from '../src/affiliates/affiliate-ledger.service';
import type { TenantAuthContext } from '../src/auth/auth.types';
import { AFFILIATE_APPEND_ONLY_ERROR } from '../src/database/models';
import {
  login,
  seedTenant,
  startTestApp,
  stopTestApp,
  TestApp,
} from './booking-availability-test-app';

const ids = {
  tenant: '74000000-0000-4000-8000-000000000001',
  location: '74000000-0000-4000-8000-000000000002',
  service: '74000000-0000-4000-8000-000000000003',
  staff: '74000000-0000-4000-8000-000000000004',
  affiliate: '74000000-0000-4000-8000-000000000005',
  owner: '74000000-0000-4000-8000-000000000006',
  referred: '74000000-0000-4000-8000-000000000007',
};

describe('affiliate commission ledger (integration e2e)', () => {
  let testApp: TestApp;
  let token: string;
  let codeId: string;
  let ledger: AffiliateLedgerService;
  let codes: AffiliateCodeService;

  beforeAll(async () => {
    testApp = await startTestApp();
    ledger = testApp.app.get(AffiliateLedgerService);
    codes = testApp.app.get(AffiliateCodeService);
    await seedTenant(testApp.database, {
      tenant: ids.tenant,
      location: ids.location,
      service: ids.service,
      staff: ids.staff,
      customer: ids.affiliate,
      owner: ids.owner,
      slug: 'affiliate-ledger',
      email: 'affiliate-ledger@example.test',
      phone: '+573007400001',
    });
    await testApp.database.models.customer.create({
      _id: ids.referred,
      tenantId: ids.tenant,
      fullName: 'Referred Customer',
      phone: '+573007400002',
    });
    const code = await codes.create(auth(), ids.affiliate, {
      code: 'LEDGER20',
      discountType: 'PERCENT',
      discountBasisPoints: 1_000,
      commissionType: 'PERCENT',
      commissionBasisPoints: 2_000,
    });
    codeId = code.id;
    token = await login(testApp.server, 'affiliate-ledger@example.test');
  });

  afterAll(async () => stopTestApp(testApp));

  it('does not credit booking, pending, confirmed, cancelled, or no-show states', async () => {
    await insertAttributedAppointment('PENDING', futureRange());
    await insertAttributedAppointment('CONFIRMED', futureRange());
    const cancelledId = await insertAttributedAppointment(
      'CONFIRMED',
      futureRange(),
    );
    await request(testApp.server)
      .post(`/api/v1/appointments/${cancelledId}/cancel`)
      .auth(token, { type: 'bearer' })
      .send({ reason: 'Customer requested cancellation' })
      .expect(200);
    const noShowId = await insertAttributedAppointment(
      'CONFIRMED',
      pastRange(),
    );
    await request(testApp.server)
      .post(`/api/v1/appointments/${noShowId}/no-show`)
      .auth(token, { type: 'bearer' })
      .send({
        idempotencyKey: `no-show-${noShowId}`,
        reason: 'CUSTOMER_DID_NOT_ARRIVE',
      })
      .expect(200);
    expect(await ledgerEntries()).toHaveLength(0);
  });

  it('credits the immutable conversion snapshot once and exposes its balance', async () => {
    const appointmentId = await insertAttributedAppointment(
      'CONFIRMED',
      pastRange(),
    );
    await codes.updateTerms(auth(), ids.affiliate, codeId, {
      discountType: 'NONE',
      commissionType: 'FIXED',
      commissionAmountMinor: 999,
      commissionCurrency: 'COP',
    });
    await codes.retire(auth(), ids.affiliate, codeId);
    const command = { idempotencyKey: `complete-${appointmentId}` };
    await complete(appointmentId, command).expect(200);
    await complete(appointmentId, command).expect(200);

    const entries = await ledgerEntries(appointmentId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tenantId: ids.tenant,
      affiliateCustomerId: ids.affiliate,
      appointmentId,
      currency: 'COP',
      direction: 'CREDIT',
      type: 'COMMISSION_EARNED',
      amountMinor: 1_800,
    });
    expect(
      await testApp.database.models.affiliateBalanceLock.countDocuments({
        tenantId: ids.tenant,
        affiliateCustomerId: ids.affiliate,
        currency: 'COP',
      }),
    ).toBe(1);
    const detail = await request(testApp.server)
      .get(`/api/v1/customers/${ids.affiliate}/affiliate`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    const detailBody = detail.body as {
      balances: unknown;
      activity: Array<{
        code: string;
        state: string;
        appointment: { id: string; status: string };
        service: { id: string; name: string };
        referredCustomer: { id: string; fullName: string };
        economics: Record<string, unknown>;
        ledger: Array<Record<string, unknown>>;
      }>;
    };
    expect(detailBody.balances).toEqual([
      {
        currency: 'COP',
        expectedMinor: 3_600,
        earnedMinor: 1_800,
        paidMinor: 0,
        reservedMinor: 0,
        balanceMinor: 1_800,
        availableMinor: 1_800,
      },
    ]);
    const earnedActivity = detailBody.activity.find(
      ({ appointment }) => appointment.id === appointmentId,
    );
    expect(earnedActivity).toMatchObject({
      code: 'LEDGER20',
      state: 'EARNED',
      appointment: { id: appointmentId, status: 'COMPLETED' },
      service: { id: ids.service, name: 'Consultation' },
      referredCustomer: {
        id: ids.referred,
        fullName: 'Referred Customer',
      },
      economics: {
        grossAmountMinor: 10_000,
        discountAmountMinor: 1_000,
        finalAmountMinor: 9_000,
        commissionAmountMinor: 1_800,
        currency: 'COP',
      },
      ledger: [
        {
          type: 'COMMISSION_EARNED',
          direction: 'CREDIT',
          amountMinor: 1_800,
        },
      ],
    });
  });

  it('serializes concurrent completion commands into one earned credit', async () => {
    const appointmentId = await insertAttributedAppointment(
      'CONFIRMED',
      pastRange(),
    );
    const responses = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        complete(appointmentId, {
          idempotencyKey: `concurrent-${appointmentId}-${index}`,
        }),
      ),
    );
    expect(responses.map(({ status }) => status).sort()).toEqual([
      200, 409, 409,
    ]);
    expect(await ledgerEntries(appointmentId)).toHaveLength(1);
  });

  it('rolls back completion if the commission event cannot be appended', async () => {
    const appointmentId = await insertAttributedAppointment(
      'CONFIRMED',
      pastRange(),
    );
    const conversion = await testApp.database.models.referralConversion
      .findOne({ appointmentId })
      .lean()
      .exec();
    await testApp.database.models.affiliateLedgerEntry.create({
      tenantId: ids.tenant,
      affiliateCustomerId: ids.referred,
      conversionId: conversion!._id,
      appointmentId: randomUUID(),
      currency: 'COP',
      direction: 'CREDIT',
      type: 'COMMISSION_EARNED',
      amountMinor: 1,
      idempotencyKey: `commission:${conversion!._id}`,
    });
    await complete(appointmentId, {
      idempotencyKey: `rollback-${appointmentId}`,
    }).expect(500);
    const appointment = await testApp.database.models.appointment
      .findById(appointmentId)
      .lean()
      .exec();
    expect(appointment?.status).toBe('CONFIRMED');
    expect(
      await testApp.database.models.appointmentTimelineEvent.countDocuments({
        tenantId: ids.tenant,
        appointmentId,
        eventType: 'COMPLETED',
      }),
    ).toBe(0);
  });

  it('keeps entries append-only, reversal-capable, and separated by currency', async () => {
    const credit = await testApp.database.models.affiliateLedgerEntry
      .findOne({ tenantId: ids.tenant, type: 'COMMISSION_EARNED' })
      .sort({ amountMinor: -1 })
      .exec();
    expect(credit).not.toBeNull();
    const reversal = await ledger.reverseCommission(
      ids.tenant,
      credit!._id,
      'Commission correction',
      `reversal-${credit!._id}`,
    );
    const replay = await ledger.reverseCommission(
      ids.tenant,
      credit!._id,
      'Commission correction',
      `reversal-${credit!._id}`,
    );
    expect(replay._id).toBe(reversal._id);
    await expect(
      ledger.reverseCommission(
        ids.tenant,
        credit!._id,
        'Different correction',
        `other-reversal-${credit!._id}`,
      ),
    ).rejects.toMatchObject({
      reasonCode: 'AFFILIATE_COMMISSION_ALREADY_REVERSED',
    });
    await testApp.database.models.affiliateLedgerEntry.create({
      tenantId: ids.tenant,
      affiliateCustomerId: ids.affiliate,
      currency: 'USD',
      direction: 'CREDIT',
      type: 'COMMISSION_EARNED',
      amountMinor: 500,
      idempotencyKey: 'usd-commission-fixture',
    });
    expect(await ledger.balances(ids.tenant, ids.affiliate)).toEqual([
      { currency: 'COP', balanceMinor: 1_800 },
      { currency: 'USD', balanceMinor: 500 },
    ]);
    await expect(
      credit!.updateOne({ $set: { amountMinor: 1 } }),
    ).rejects.toThrow(AFFILIATE_APPEND_ONLY_ERROR);
    await expect(credit!.deleteOne()).rejects.toThrow(
      AFFILIATE_APPEND_ONLY_ERROR,
    );
  });

  function complete(appointmentId: string, payload: Record<string, unknown>) {
    return request(testApp.server)
      .post(`/api/v1/appointments/${appointmentId}/complete`)
      .auth(token, { type: 'bearer' })
      .send(payload);
  }

  async function ledgerEntries(appointmentId?: string) {
    return testApp.database.models.affiliateLedgerEntry
      .find({
        tenantId: ids.tenant,
        ...(appointmentId ? { appointmentId } : {}),
      })
      .lean()
      .exec();
  }

  async function insertAttributedAppointment(
    status: 'PENDING' | 'CONFIRMED',
    range: { startsAt: Date; endsAt: Date },
  ): Promise<string> {
    const appointmentId = randomUUID();
    await testApp.database.models.appointment.create({
      _id: appointmentId,
      tenantId: ids.tenant,
      locationId: ids.location,
      serviceId: ids.service,
      staffId: ids.staff,
      customerId: ids.referred,
      status,
      ...range,
      idempotencyKey: `seed-${appointmentId}`,
      requestFingerprint: appointmentId.replaceAll('-', '').padEnd(64, '0'),
    });
    await testApp.database.models.referralConversion.create({
      tenantId: ids.tenant,
      affiliateCodeId: codeId,
      affiliateCustomerId: ids.affiliate,
      referredCustomerId: ids.referred,
      appointmentId,
      serviceId: ids.service,
      codeSnapshot: 'LEDGER20',
      grossAmountMinor: 10_000,
      discountType: 'PERCENT',
      discountBasisPoints: 1_000,
      discountValueMinor: 1_000,
      finalAmountMinor: 9_000,
      currency: 'COP',
      commissionType: 'PERCENT',
      commissionBasisPoints: 2_000,
      commissionValueMinor: 1_800,
      commissionBase: 'NET_AFTER_DISCOUNT',
      source: 'PUBLIC_BOOKING',
    });
    return appointmentId;
  }
});

function futureRange(): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: new Date(Date.now() + 60 * 60_000),
    endsAt: new Date(Date.now() + 2 * 60 * 60_000),
  };
}

function pastRange(): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: new Date(Date.now() - 2 * 60 * 60_000),
    endsAt: new Date(Date.now() - 60 * 60_000),
  };
}

function auth(): TenantAuthContext {
  return {
    actorType: 'TENANT',
    userId: ids.owner,
    displayName: 'Owner',
    tenant: {
      id: ids.tenant,
      name: 'Affiliate ledger',
      slug: 'affiliate-ledger',
    },
    tenantRole: 'OWNER',
  };
}
