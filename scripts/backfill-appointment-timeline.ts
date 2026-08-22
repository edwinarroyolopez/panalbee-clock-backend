import { createHash } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { createConnection } from 'mongoose';
import {
  CLOCK_MODEL_DEFINITIONS,
  INDEX_NAMES,
  clockModels,
  isNamedDuplicateKey,
} from '../src/database/models';

function loadLocalEnvironment(): void {
  if (process.env.NODE_ENV === 'test' || process.env.MONGODB_URI) return;
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function backfillAppointmentTimeline(): Promise<void> {
  loadLocalEnvironment();
  const uri = process.env.MONGODB_URI;
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error('MONGODB_URI is required and must be a MongoDB URI');
  }
  const connection = await createConnection(uri, {
    minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE ?? 0),
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE ?? 10),
    serverSelectionTimeoutMS: Number(
      process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS ?? 5_000,
    ),
    socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS ?? 45_000),
  }).asPromise();
  try {
    for (const definition of CLOCK_MODEL_DEFINITIONS) {
      connection.model(definition.name, definition.schema);
    }
    const models = clockModels(connection);
    let inserted = 0;
    let existing = 0;
    for await (const appointment of models.appointment.find().lean().cursor()) {
      const idempotencyKey = `appointment:${appointment._id}:created`;
      const found = await models.appointmentTimelineEvent.exists({
        tenantId: appointment.tenantId,
        appointmentId: appointment._id,
        eventType: 'CREATED',
      });
      if (found) {
        existing += 1;
        continue;
      }
      try {
        await models.appointmentTimelineEvent.create({
          tenantId: appointment.tenantId,
          appointmentId: appointment._id,
          actorType: 'SYSTEM',
          eventType: 'CREATED',
          toStatus: 'CONFIRMED',
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          idempotencyKey,
          requestFingerprint: createHash('sha256')
            .update(
              JSON.stringify({
                type: 'CREATED',
                startsAt: appointment.startsAt.toISOString(),
                endsAt: appointment.endsAt.toISOString(),
              }),
            )
            .digest('hex'),
          createdAt: appointment.createdAt,
        });
        inserted += 1;
      } catch (error) {
        if (
          !isNamedDuplicateKey(
            error,
            INDEX_NAMES.appointmentTimelineIdempotency,
          )
        ) {
          throw error;
        }
        existing += 1;
      }
    }
    console.log(
      `[APPOINTMENT_TIMELINE_BACKFILL_OK] inserted=${inserted} existing=${existing}`,
    );
  } finally {
    await connection.close();
  }
}

void backfillAppointmentTimeline().catch(() => {
  console.error('[APPOINTMENT_TIMELINE_BACKFILL_FAILED]');
  process.exitCode = 1;
});
