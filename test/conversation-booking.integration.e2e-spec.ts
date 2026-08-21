import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import { DatabaseService } from '../src/database/database.service';
import {
  openMessagingApp,
  signedWebhook,
  WhatsAppTestHarness,
  whatsappPayload,
} from './channel-test-support';

const ids = {
  tenant: 'f1000000-0000-4000-8000-000000000001',
  location: 'f2000000-0000-4000-8000-000000000001',
  service: 'f3000000-0000-4000-8000-000000000001',
  staff: 'f4000000-0000-4000-8000-000000000001',
  channel: 'f5000000-0000-4000-8000-000000000001',
};

describe('conversation to booking vertical (MongoDB integration)', () => {
  const harness = new WhatsAppTestHarness();
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;

  beforeAll(async () => {
    ({ app, server } = await openMessagingApp(harness));
    database = app.get(DatabaseService);
    await database.models.tenant.create({
      _id: ids.tenant,
      name: 'Conversation Booking',
      slug: 'conversation-booking',
    });
    await database.models.location.create({
      _id: ids.location,
      tenantId: ids.tenant,
      name: 'Main',
      timezone: 'America/Bogota',
    });
    await database.models.service.create({
      _id: ids.service,
      tenantId: ids.tenant,
      name: 'Facial',
      durationMinutes: 60,
    });
    await database.models.staff.create({
      _id: ids.staff,
      tenantId: ids.tenant,
      locationId: ids.location,
      displayName: 'Valentina',
    });
    await database.models.staffService.create({
      tenantId: ids.tenant,
      staffId: ids.staff,
      serviceId: ids.service,
    });
    await database.models.schedule.create({
      tenantId: ids.tenant,
      locationId: ids.location,
      staffId: ids.staff,
      dayOfWeek: 5,
      startsAt: '08:00',
      endsAt: '18:00',
    });
    await database.models.channel.create({
      _id: ids.channel,
      tenantId: ids.tenant,
      type: 'WHATSAPP',
      externalAccountId: 'conversation-booking-phone',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('uses persisted steps to atomically create the confirmed appointment', async () => {
    const inputs = [
      { type: 'interactive' as const, id: 'book', title: 'Book' },
      { type: 'text' as const, text: ids.service },
      { type: 'text' as const, text: ids.staff },
      { type: 'text' as const, text: '2026-08-21' },
      { type: 'text' as const, text: '10:00' },
      { type: 'text' as const, text: 'Andrea Lopez' },
      { type: 'interactive' as const, id: 'confirm', title: 'Confirm' },
    ];

    for (const [index, input] of inputs.entries()) {
      const payload = whatsappPayload(
        'conversation-booking-phone',
        '573009990001',
        `wamid.booking.${index}`,
        input,
      );
      const response = await signedWebhook(server, payload);
      expect({ index, status: response.status }).toEqual({
        index,
        status: 200,
      });
    }

    const appointments = await database.models.appointment
      .find({ tenantId: ids.tenant })
      .lean()
      .exec();
    expect(appointments).toHaveLength(1);
    const appointment = appointments[0];
    const conversation = await database.models.conversation
      .findOne({ tenantId: ids.tenant, customerId: appointment.customerId })
      .lean()
      .exec();
    expect(appointment).toMatchObject({
      status: 'CONFIRMED',
      sourceChannel: 'WHATSAPP',
      startsAt: new Date('2026-08-21T15:00:00.000Z'),
    });
    expect(conversation?.state).toBe('MAIN_MENU');
    expect(
      await database.models.notification.countDocuments({
        tenantId: ids.tenant,
        appointmentId: appointment._id,
      }),
    ).toBe(1);
    expect(
      await database.models.appointmentIntervalLock.countDocuments({
        tenantId: ids.tenant,
        appointmentId: appointment._id,
      }),
    ).toBe(60);
  });
});
