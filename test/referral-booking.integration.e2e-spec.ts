import request from 'supertest';
import { AffiliateCodeService } from '../src/affiliates/affiliate-code.service';
import type { TenantAuthContext } from '../src/auth/auth.types';
import {
  seedTenant,
  startTestApp,
  stopTestApp,
  TestApp,
} from './booking-availability-test-app';

const ids = {
  tenant: '72000000-0000-4000-8000-000000000001',
  location: '72000000-0000-4000-8000-000000000002',
  service: '72000000-0000-4000-8000-000000000003',
  staff: '72000000-0000-4000-8000-000000000004',
  affiliate: '72000000-0000-4000-8000-000000000005',
  owner: '72000000-0000-4000-8000-000000000006',
  affiliateOther: '72000000-0000-4000-8000-000000000007',
  affiliateBad: '72000000-0000-4000-8000-000000000008',
};

const percentageTerms = {
  discountType: 'PERCENT' as const,
  discountBasisPoints: 1_000,
  commissionType: 'PERCENT' as const,
  commissionBasisPoints: 2_000,
};

describe('public referral booking (integration e2e)', () => {
  let testApp: TestApp;
  let codes: AffiliateCodeService;
  let saveCodeId: string;
  let otherCodeId: string;
  let badCodeId: string;
  let referralAppointmentId: string;

  beforeAll(async () => {
    testApp = await startTestApp();
    codes = testApp.app.get(AffiliateCodeService);
    await seedTenant(testApp.database, {
      tenant: ids.tenant,
      location: ids.location,
      service: ids.service,
      staff: ids.staff,
      customer: ids.affiliate,
      owner: ids.owner,
      slug: 'referral-booking',
      email: 'referral-booking@example.test',
      phone: '+573007200001',
    });
    await testApp.database.models.service.updateOne(
      { _id: ids.service },
      { $set: { priceMinor: 10_000, currency: 'COP' } },
    );
    await testApp.database.models.customer.create([
      {
        _id: ids.affiliateOther,
        tenantId: ids.tenant,
        fullName: 'Other Affiliate',
        phone: '+573007200002',
      },
      {
        _id: ids.affiliateBad,
        tenantId: ids.tenant,
        fullName: 'Bad Terms Affiliate',
        phone: '+573007200003',
      },
    ]);
    const saveCode = await codes.create(auth(), ids.affiliate, {
      code: 'SAVE10',
      ...percentageTerms,
    });
    saveCodeId = saveCode.id;
    const otherCode = await codes.create(auth(), ids.affiliateOther, {
      code: 'OTHER10',
      ...percentageTerms,
    });
    otherCodeId = otherCode.id;
    const badCode = await codes.create(auth(), ids.affiliateBad, {
      code: 'TOO-MUCH',
      discountType: 'FIXED',
      discountAmountMinor: 20_000,
      discountCurrency: 'COP',
      commissionType: 'FIXED',
      commissionAmountMinor: 1_000,
      commissionCurrency: 'COP',
    });
    badCodeId = badCode.id;
  });

  afterAll(async () => stopTestApp(testApp));

  it('preserves historical no-code booking behavior and creates no conversion', async () => {
    const response = await book({
      customerName: 'No Referral',
      customerPhone: '+573007200010',
      startsAt: '2099-10-01T14:00:00Z',
      idempotencyKey: 'referral-no-code',
    }).expect(201);
    expect(response.body).not.toHaveProperty('referral');
    expect(
      await testApp.database.models.referralConversion.countDocuments({
        appointmentId: (response.body as { id: string }).id,
      }),
    ).toBe(0);
  });

  it('creates one immutable economic snapshot and returns it on exact replay', async () => {
    const payload = {
      customerName: 'Referred Customer',
      customerPhone: '+573007200011',
      startsAt: '2099-10-01T15:00:00Z',
      idempotencyKey: 'referral-valid',
      referralCode: ' save10 ',
    };
    const created = await book(payload).expect(201);
    const body = created.body as {
      id: string;
      customerId: string;
      referral: Record<string, unknown>;
    };
    referralAppointmentId = body.id;
    expect(body.referral).toEqual({
      code: 'SAVE10',
      grossAmountMinor: 10_000,
      discountAmountMinor: 1_000,
      finalAmountMinor: 9_000,
      currency: 'COP',
    });
    const conversion = await testApp.database.models.referralConversion
      .findOne({ appointmentId: body.id })
      .lean()
      .exec();
    expect(conversion).toMatchObject({
      tenantId: ids.tenant,
      affiliateCustomerId: ids.affiliate,
      referredCustomerId: body.customerId,
      serviceId: ids.service,
      codeSnapshot: 'SAVE10',
      grossAmountMinor: 10_000,
      discountBasisPoints: 1_000,
      discountValueMinor: 1_000,
      finalAmountMinor: 9_000,
      commissionBasisPoints: 2_000,
      commissionValueMinor: 1_800,
      commissionBase: 'NET_AFTER_DISCOUNT',
      source: 'PUBLIC_BOOKING',
    });
    const replay = await book(payload).expect(201);
    expect(replay.body).toMatchObject({ id: body.id, referral: body.referral });
    expect(
      await testApp.database.models.referralConversion.countDocuments({
        appointmentId: body.id,
      }),
    ).toBe(1);
  });

  it('includes normalized referral code in the idempotency fingerprint', async () => {
    await book({
      customerName: 'Referred Customer',
      customerPhone: '+573007200011',
      startsAt: '2099-10-01T15:00:00Z',
      idempotencyKey: 'referral-valid',
      referralCode: 'OTHER10',
    })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('IDEMPOTENCY_KEY_CONFLICT'),
      );
  });

  it('deduplicates concurrent exact referral replays', async () => {
    const payload = {
      customerName: 'Concurrent Referral',
      customerPhone: '+573007200012',
      startsAt: '2099-10-01T16:00:00Z',
      idempotencyKey: 'referral-concurrent',
      referralCode: 'SAVE10',
    };
    const responses = await Promise.all([book(payload), book(payload)]);
    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    const appointmentIds = responses.map(
      ({ body }) => (body as { id: string }).id,
    );
    expect(new Set(appointmentIds).size).toBe(1);
    expect(
      await testApp.database.models.referralConversion.countDocuments({
        appointmentId: appointmentIds[0],
      }),
    ).toBe(1);
  });

  it('rejects self-referral without creating an appointment or conversion', async () => {
    await book({
      customerName: 'Affiliate Customer',
      customerPhone: '+573007200001',
      startsAt: '2099-10-01T17:00:00Z',
      idempotencyKey: 'referral-self',
      referralCode: 'SAVE10',
    })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('REFERRAL_SELF_REFERRAL'),
      );
    expect(await countsForKey('referral-self')).toEqual([0, 0]);
  });

  it('rolls back a newly resolved Customer when economics fail', async () => {
    await book({
      customerName: 'Rolled Back Customer',
      customerPhone: '+573007200099',
      startsAt: '2099-10-01T18:00:00Z',
      idempotencyKey: 'referral-rollback',
      referralCode: 'TOO-MUCH',
    })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('REFERRAL_CODE_ECONOMICS_INVALID'),
      );
    expect(await countsForKey('referral-rollback')).toEqual([0, 0]);
    expect(
      await testApp.database.models.customer.countDocuments({
        tenantId: ids.tenant,
        phone: '+573007200099',
      }),
    ).toBe(0);
  });

  it('revalidates expiry, status, and currency inside each booking transaction', async () => {
    await codes.updateTerms(auth(), ids.affiliateOther, otherCodeId, {
      ...percentageTerms,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    await expectReferralFailure(
      'OTHER10',
      '+573007200020',
      '2099-10-01T19:00:00Z',
      'referral-expired',
      'REFERRAL_CODE_EXPIRED',
    );
    await codes.updateTerms(auth(), ids.affiliateOther, otherCodeId, {
      ...percentageTerms,
    });
    await codes.deactivate(auth(), ids.affiliateOther, otherCodeId);
    await expectReferralFailure(
      'OTHER10',
      '+573007200021',
      '2099-10-01T20:00:00Z',
      'referral-inactive',
      'REFERRAL_CODE_INACTIVE',
    );
    await codes.updateTerms(auth(), ids.affiliateBad, badCodeId, {
      discountType: 'FIXED',
      discountAmountMinor: 100,
      discountCurrency: 'USD',
      commissionType: 'FIXED',
      commissionAmountMinor: 100,
      commissionCurrency: 'USD',
    });
    await expectReferralFailure(
      'TOO-MUCH',
      '+573007200022',
      '2099-10-01T21:00:00Z',
      'referral-currency',
      'REFERRAL_CODE_CURRENCY_MISMATCH',
    );
  });

  it('keeps snapshot economics unchanged after code and Service edits', async () => {
    await testApp.database.models.service.updateOne(
      { _id: ids.service },
      { $set: { priceMinor: 50_000 } },
    );
    await codes.updateTerms(auth(), ids.affiliate, saveCodeId, {
      discountType: 'NONE',
      commissionType: 'FIXED',
      commissionAmountMinor: 500,
      commissionCurrency: 'COP',
    });
    const conversion = await testApp.database.models.referralConversion
      .findOne({ appointmentId: referralAppointmentId })
      .lean()
      .exec();
    expect(conversion).toMatchObject({
      grossAmountMinor: 10_000,
      discountType: 'PERCENT',
      discountValueMinor: 1_000,
      finalAmountMinor: 9_000,
      commissionType: 'PERCENT',
      commissionValueMinor: 1_800,
    });
    await expect(
      testApp.database.models.referralConversion.updateOne(
        { appointmentId: referralAppointmentId },
        { $set: { finalAmountMinor: 1 } },
      ),
    ).rejects.toThrow('affiliate financial history is append-only');
  });

  function book(payload: Record<string, unknown>) {
    return request(testApp.server)
      .post('/api/v1/public/referral-booking/appointments')
      .send({
        locationId: ids.location,
        serviceId: ids.service,
        staffId: ids.staff,
        ...payload,
      });
  }

  async function countsForKey(key: string): Promise<[number, number]> {
    const appointment = await testApp.database.models.appointment
      .findOne({ tenantId: ids.tenant, idempotencyKey: key })
      .lean()
      .exec();
    return [
      appointment ? 1 : 0,
      appointment
        ? await testApp.database.models.referralConversion.countDocuments({
            appointmentId: appointment._id,
          })
        : 0,
    ];
  }

  async function expectReferralFailure(
    referralCode: string,
    customerPhone: string,
    startsAt: string,
    idempotencyKey: string,
    reasonCode: string,
  ): Promise<void> {
    await book({
      customerName: 'Rejected Referral',
      customerPhone,
      startsAt,
      idempotencyKey,
      referralCode,
    })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe(reasonCode),
      );
    expect(await countsForKey(idempotencyKey)).toEqual([0, 0]);
    expect(
      await testApp.database.models.customer.countDocuments({
        tenantId: ids.tenant,
        phone: customerPhone,
      }),
    ).toBe(0);
  }
});

function auth(): TenantAuthContext {
  return {
    actorType: 'TENANT',
    userId: ids.owner,
    displayName: 'Owner',
    tenant: {
      id: ids.tenant,
      name: 'Referral booking',
      slug: 'referral-booking',
    },
    tenantRole: 'OWNER',
  };
}
