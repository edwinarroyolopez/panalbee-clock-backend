import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppointmentEvidenceStorageService } from '../src/appointments/appointment-evidence-storage.service';
import { tokenHash } from '../src/appointments/appointments.service';
import {
  APPOINTMENT_EVIDENCE_APPEND_ONLY_ERROR,
  APPOINTMENT_SURVEY_APPEND_ONLY_ERROR,
} from '../src/database/models';
import {
  login,
  seedTenant,
  startTestApp,
  stopTestApp,
  TestApp,
} from './booking-availability-test-app';

const ids = {
  tenantA: '7e000000-0000-4000-8000-000000000001',
  locationA: '7e000000-0000-4000-8000-000000000002',
  serviceA: '7e000000-0000-4000-8000-000000000003',
  staffA: '7e000000-0000-4000-8000-000000000004',
  customerA: '7e000000-0000-4000-8000-000000000005',
  ownerA: '7e000000-0000-4000-8000-000000000006',
  appointmentA: '7e000000-0000-4000-8000-000000000007',
  appointmentA2: '7e000000-0000-4000-8000-000000000008',
  pendingA: '7e000000-0000-4000-8000-000000000009',
  tenantB: '7f000000-0000-4000-8000-000000000001',
  locationB: '7f000000-0000-4000-8000-000000000002',
  serviceB: '7f000000-0000-4000-8000-000000000003',
  staffB: '7f000000-0000-4000-8000-000000000004',
  customerB: '7f000000-0000-4000-8000-000000000005',
  ownerB: '7f000000-0000-4000-8000-000000000006',
  appointmentB: '7f000000-0000-4000-8000-000000000007',
};

const managementToken = 'm'.repeat(43);
const customerSessionToken = 'c'.repeat(43);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class FakeEvidenceStorage implements Pick<
  AppointmentEvidenceStorageService,
  'uploadPrivateImage' | 'signedUrl' | 'deletePrivateImage'
> {
  uploads = 0;
  deletes: string[] = [];

  uploadPrivateImage() {
    this.uploads += 1;
    return Promise.resolve({
      storageKey: `private/evidence-${this.uploads}`,
      format: 'png' as const,
      sizeBytes: png.length,
      width: 32,
      height: 32,
    });
  }

  signedUrl(storageKey: string) {
    return {
      url: `https://evidence.example.test/signed/${encodeURIComponent(storageKey)}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  deletePrivateImage(storageKey: string) {
    this.deletes.push(storageKey);
    return Promise.resolve();
  }
}

describe('appointment evidence and survey (security e2e)', () => {
  const storage = new FakeEvidenceStorage();
  let testApp: TestApp;
  let tenantToken: string;
  let staffEvidenceId: string;
  let surveyEvidenceId: string;

  beforeAll(async () => {
    testApp = await startTestApp(undefined, storage);
    await seedTenant(testApp.database, {
      tenant: ids.tenantA,
      location: ids.locationA,
      service: ids.serviceA,
      staff: ids.staffA,
      customer: ids.customerA,
      owner: ids.ownerA,
      slug: 'appointment-feedback-a',
      email: 'appointment-feedback-a@example.test',
      phone: '+12025550711',
    });
    await seedTenant(testApp.database, {
      tenant: ids.tenantB,
      location: ids.locationB,
      service: ids.serviceB,
      staff: ids.staffB,
      customer: ids.customerB,
      owner: ids.ownerB,
      slug: 'appointment-feedback-b',
      email: 'appointment-feedback-b@example.test',
      phone: '+12025550712',
    });
    await testApp.database.models.appointment.create([
      appointment('A', ids.appointmentA, 'COMPLETED', managementToken),
      appointment('A', ids.appointmentA2, 'COMPLETED'),
      appointment('A', ids.pendingA, 'CONFIRMED'),
      appointment('B', ids.appointmentB, 'COMPLETED', 'b'.repeat(43)),
    ]);
    await testApp.database.models.appointmentTimelineEvent.create({
      tenantId: ids.tenantA,
      appointmentId: ids.appointmentA,
      eventType: 'COMPLETED',
      actorType: 'TENANT_USER',
      actorUserId: ids.ownerA,
      fromStatus: 'IN_PROGRESS',
      toStatus: 'COMPLETED',
      note: 'Internal service note',
      idempotencyKey: 'feedback-completed-event',
      requestFingerprint: 'a'.repeat(64),
    });
    await testApp.database.models.customerAccessChallenge.create({
      tenantId: ids.tenantA,
      phoneHash: '1'.repeat(64),
      requestBucket: 1,
      requesterHash: '2'.repeat(64),
      customerId: ids.customerA,
      codeHash: '3'.repeat(64),
      codeExpiresAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 60 * 60_000),
      consumedAt: new Date(),
      sessionTokenHash: tokenHash(customerSessionToken),
    });
    tenantToken = await login(
      testApp.server,
      'appointment-feedback-a@example.test',
    );
  });

  afterAll(async () => stopTestApp(testApp));

  it('stores validated private staff evidence once and returns only signed access', async () => {
    const path = `/api/v1/appointments/${ids.appointmentA}/evidence`;
    const uploaded = await request(testApp.server)
      .post(path)
      .auth(tenantToken, { type: 'bearer' })
      .field('idempotencyKey', 'staff-evidence-upload')
      .attach('file', png, {
        filename: '../service.png',
        contentType: 'image/png',
      })
      .expect(201);
    const uploadBody = uploaded.body as {
      id: string;
      scope: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      url: string;
    };
    expect(uploadBody).toMatchObject({
      scope: 'SERVICE',
      fileName: 'service.png',
      mimeType: 'image/png',
      sizeBytes: png.length,
    });
    expect(uploadBody.url).toContain('https://evidence.example.test/signed/');
    expect(uploadBody).not.toHaveProperty('storageKey');
    const evidenceId = uploadBody.id;
    staffEvidenceId = evidenceId;

    await request(testApp.server)
      .post(path)
      .auth(tenantToken, { type: 'bearer' })
      .field('idempotencyKey', 'staff-evidence-upload')
      .attach('file', png, {
        filename: '../service.png',
        contentType: 'image/png',
      })
      .expect(201)
      .expect(({ body }: { body: { id: string } }) =>
        expect(body.id).toBe(evidenceId),
      );
    await request(testApp.server)
      .post(path)
      .auth(tenantToken, { type: 'bearer' })
      .field('idempotencyKey', 'staff-evidence-upload')
      .attach('file', Buffer.concat([png, Buffer.from([0])]), {
        filename: 'changed.png',
        contentType: 'image/png',
      })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('IDEMPOTENCY_KEY_CONFLICT'),
      );
    expect(storage.uploads).toBe(1);
    expect(
      await testApp.database.models.appointmentEvidence.countDocuments({
        tenantId: ids.tenantA,
        appointmentId: ids.appointmentA,
      }),
    ).toBe(1);
    expect(
      await testApp.database.models.appointmentTimelineEvent.countDocuments({
        tenantId: ids.tenantA,
        appointmentId: ids.appointmentA,
        eventType: 'EVIDENCE_ADDED',
      }),
    ).toBe(1);

    await request(testApp.server)
      .get(
        `/api/v1/appointments/${ids.appointmentA}/evidence/${evidenceId}/access`,
      )
      .auth(tenantToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) =>
        expect(body).not.toHaveProperty('storageKey'),
      );
  });

  it('rejects invalid bytes, invalid status, and cross-tenant evidence', async () => {
    const uploadsBefore = storage.uploads;
    await request(testApp.server)
      .post(`/api/v1/appointments/${ids.appointmentA}/evidence`)
      .auth(tenantToken, { type: 'bearer' })
      .field('idempotencyKey', 'invalid-signature-upload')
      .attach('file', Buffer.from('not png'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe(
          'APPOINTMENT_EVIDENCE_FILE_SIGNATURE_INVALID',
        ),
      );
    await request(testApp.server)
      .post(`/api/v1/appointments/${ids.pendingA}/evidence`)
      .auth(tenantToken, { type: 'bearer' })
      .field('idempotencyKey', 'invalid-status-upload')
      .attach('file', png, {
        filename: 'pending.png',
        contentType: 'image/png',
      })
      .expect(409);
    await request(testApp.server)
      .post(`/api/v1/appointments/${ids.appointmentB}/evidence`)
      .auth(tenantToken, { type: 'bearer' })
      .field('idempotencyKey', 'cross-tenant-upload')
      .attach('file', png, {
        filename: 'foreign.png',
        contentType: 'image/png',
      })
      .expect(404);
    expect(storage.uploads).toBe(uploadsBefore);
  });

  it('redacts internal timeline data from management-token customers', async () => {
    await request(testApp.server)
      .get(
        `/api/v1/public/appointment-feedback-a/appointments/${ids.appointmentA}/timeline?managementToken=${managementToken}`,
      )
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe(
          'APPOINTMENT_MANAGEMENT_TOKEN_URL_FORBIDDEN',
        ),
      );
    const publicTimeline = await request(testApp.server)
      .get(
        `/api/v1/public/appointment-feedback-a/appointments/${ids.appointmentA}/timeline`,
      )
      .set('X-Appointment-Management-Token', managementToken)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    const serialized = JSON.stringify(publicTimeline.body);
    expect(serialized).not.toContain('Internal service note');
    expect(serialized).not.toContain(ids.ownerA);
    expect(serialized).not.toContain('TENANT_USER');
    expect(serialized).not.toContain('EVIDENCE_ADDED');
    await request(testApp.server)
      .get(
        `/api/v1/public/appointment-feedback-a/appointments/${ids.appointmentA}/evidence/${staffEvidenceId}/access`,
      )
      .set('X-Appointment-Management-Token', managementToken)
      .expect(404);

    const internalTimeline = await request(testApp.server)
      .get(`/api/v1/appointments/${ids.appointmentA}/timeline`)
      .auth(tenantToken, { type: 'bearer' })
      .expect(200);
    expect(JSON.stringify(internalTimeline.body)).toContain(
      'Internal service note',
    );
  });

  it('submits one idempotent survey with owned optional evidence', async () => {
    const evidence = await request(testApp.server)
      .post(
        `/api/v1/public/appointment-feedback-a/appointments/${ids.appointmentA}/evidence`,
      )
      .set('X-Appointment-Management-Token', managementToken)
      .field('idempotencyKey', 'customer-survey-evidence')
      .attach('file', png, { filename: 'visit.png', contentType: 'image/png' })
      .expect(201)
      .expect('Cache-Control', 'private, no-store');
    const evidenceId = (evidence.body as { id: string }).id;
    surveyEvidenceId = evidenceId;
    await request(testApp.server)
      .get(
        `/api/v1/public/appointment-feedback-a/appointments/${ids.appointmentA}/evidence/${evidenceId}/access`,
      )
      .set('X-Appointment-Management-Token', managementToken)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    const surveyPath = `/api/v1/public/appointment-feedback-a/appointments/${ids.appointmentA}/survey`;
    const payload = {
      managementToken,
      idempotencyKey: 'customer-survey-submit',
      rating: 5,
      comment: 'Excellent service',
      evidenceId,
    };
    const submitted = await request(testApp.server)
      .post(surveyPath)
      .send(payload)
      .expect(201)
      .expect('Cache-Control', 'private, no-store');
    const surveyId = (submitted.body as { id: string }).id;
    await request(testApp.server)
      .post(surveyPath)
      .send(payload)
      .expect(201)
      .expect(({ body }: { body: { id: string } }) =>
        expect(body.id).toBe(surveyId),
      );
    await request(testApp.server)
      .post(surveyPath)
      .send({ ...payload, rating: 1 })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('IDEMPOTENCY_KEY_CONFLICT'),
      );
    await request(testApp.server)
      .post(surveyPath)
      .send({ ...payload, idempotencyKey: 'another-survey-key' })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('APPOINTMENT_SURVEY_ALREADY_SUBMITTED'),
      );
    expect(
      await testApp.database.models.appointmentSurveyResponse.countDocuments({
        tenantId: ids.tenantA,
        appointmentId: ids.appointmentA,
      }),
    ).toBe(1);
    const timeline = await request(testApp.server)
      .get(
        `/api/v1/public/appointment-feedback-a/appointments/${ids.appointmentA}/timeline`,
      )
      .set('X-Appointment-Management-Token', managementToken)
      .expect(200);
    expect(timeline.body).toMatchObject({
      survey: {
        id: surveyId,
        rating: 5,
        comment: 'Excellent service',
        evidenceId,
      },
    });

    const storedEvidence = await testApp.database.models.appointmentEvidence
      .findById(evidenceId)
      .lean()
      .exec();
    const storedSurvey = await testApp.database.models.appointmentSurveyResponse
      .findById(surveyId)
      .lean()
      .exec();
    await expect(
      testApp.database.models.appointmentEvidence.updateOne(
        { _id: storedEvidence!._id },
        { $set: { originalFileName: 'mutated.png' } },
      ),
    ).rejects.toThrow(APPOINTMENT_EVIDENCE_APPEND_ONLY_ERROR);
    await expect(
      testApp.database.models.appointmentSurveyResponse.deleteOne({
        _id: storedSurvey!._id,
      }),
    ).rejects.toThrow(APPOINTMENT_SURVEY_APPEND_ONLY_ERROR);
  });

  it('supports customer sessions and rejects non-completed or foreign appointments', async () => {
    const base = '/api/v1/public/appointment-feedback-a/customer-appointments';
    await request(testApp.server)
      .get(`${base}/${ids.appointmentA2}/timeline`)
      .auth(customerSessionToken, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    await request(testApp.server)
      .post(`${base}/${ids.appointmentA2}/survey`)
      .auth(customerSessionToken, { type: 'bearer' })
      .send({
        idempotencyKey: 'foreign-evidence-survey',
        rating: 4,
        evidenceId: surveyEvidenceId,
      })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('APPOINTMENT_SURVEY_EVIDENCE_INVALID'),
      );
    await request(testApp.server)
      .post(`${base}/${ids.appointmentA2}/survey`)
      .auth(customerSessionToken, { type: 'bearer' })
      .send({ idempotencyKey: 'session-survey-submit', rating: 4 })
      .expect(201);
    await request(testApp.server)
      .post(`${base}/${ids.pendingA}/survey`)
      .auth(customerSessionToken, { type: 'bearer' })
      .send({ idempotencyKey: 'pending-survey-submit', rating: 4 })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('APPOINTMENT_SURVEY_STATUS_INVALID'),
      );
    await request(testApp.server)
      .get(`${base}/${ids.appointmentB}/timeline`)
      .auth(customerSessionToken, { type: 'bearer' })
      .expect(404);
  });

  function appointment(
    tenant: 'A' | 'B',
    id: string,
    status: 'CONFIRMED' | 'COMPLETED',
    token?: string,
  ) {
    const isA = tenant === 'A';
    return {
      _id: id,
      tenantId: isA ? ids.tenantA : ids.tenantB,
      locationId: isA ? ids.locationA : ids.locationB,
      serviceId: isA ? ids.serviceA : ids.serviceB,
      staffId: isA ? ids.staffA : ids.staffB,
      customerId: isA ? ids.customerA : ids.customerB,
      status,
      startsAt: new Date(Date.now() - 2 * 60 * 60_000),
      endsAt: new Date(Date.now() - 60 * 60_000),
      ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      ...(token ? { managementTokenHash: tokenHash(token) } : {}),
      idempotencyKey: `feedback-${id}`,
      requestFingerprint: createHash('sha256').update(id).digest('hex'),
    };
  }
});
