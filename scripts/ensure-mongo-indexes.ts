import { loadEnvFile } from 'node:process';
import { createConnection } from 'mongoose';
import {
  CLOCK_MODEL_DEFINITIONS,
  syncClockIndexes,
} from '../src/database/models';

function loadLocalEnvironment(): void {
  if (process.env.NODE_ENV === 'test' || process.env.MONGODB_URI) return;
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function ensureMongoIndexes(): Promise<void> {
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
    await syncClockIndexes(connection);
  } finally {
    await connection.close();
  }
}

void ensureMongoIndexes().catch(() => {
  console.error('[MONGO_INDEX_INITIALIZATION_FAILED]');
  process.exitCode = 1;
});
