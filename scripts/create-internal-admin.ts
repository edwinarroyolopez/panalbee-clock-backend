import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { createConnection } from 'mongoose';
import {
  E164_PHONE_PATTERN,
  normalizeLoginPhone,
} from '../src/auth/login-identity';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { MODEL_NAMES, UserEntity, UserSchema } from '../src/database/models';

function loadLocalEnvironment(): void {
  if (process.env.MONGODB_URI) return;
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('ADMIN_PASSWORD_STDIN_REQUIRED');
  let password = '';
  for await (const chunk of process.stdin as AsyncIterable<unknown>) {
    if (typeof chunk === 'string') password += chunk;
    else if (Buffer.isBuffer(chunk)) password += chunk.toString('utf8');
    else throw new Error('ADMIN_PASSWORD_INVALID');
  }
  return password.replace(/\r?\n$/, '');
}

async function createInternalAdmin(): Promise<void> {
  loadLocalEnvironment();
  const uri = process.env.MONGODB_URI;
  const phone = normalizeLoginPhone(process.env.ADMIN_PHONE ?? '');
  const displayName =
    process.env.ADMIN_DISPLAY_NAME?.trim() || 'Platform Administrator';
  const password = await readPassword();
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri))
    throw new Error('MONGODB_URI_INVALID');
  if (!E164_PHONE_PATTERN.test(phone)) throw new Error('ADMIN_PHONE_INVALID');
  if (password.length < 8 || password.length > 128)
    throw new Error('ADMIN_PASSWORD_INVALID');

  const connection = await createConnection(uri, {
    minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE ?? 0),
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE ?? 10),
    serverSelectionTimeoutMS: Number(
      process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS ?? 5_000,
    ),
    socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS ?? 45_000),
  }).asPromise();
  try {
    const users = connection.model<UserEntity>(MODEL_NAMES.User, UserSchema);
    await users.syncIndexes();
    const passwordHash = await hashPassword(password);
    const result = await users.updateOne(
      { phone },
      {
        $setOnInsert: {
          _id: randomUUID(),
          phone,
          displayName,
          passwordHash,
          actorType: 'INTERNAL',
          internalRole: 'PLATFORM_ADMIN',
          status: 'ACTIVE',
        },
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    const account = await users.findOne({ phone }).lean().exec();
    const valid =
      account?.actorType === 'INTERNAL' &&
      account.internalRole === 'PLATFORM_ADMIN' &&
      account.status === 'ACTIVE' &&
      account.displayName === displayName &&
      (await verifyPassword(password, account.passwordHash));
    if (!valid) throw new Error('ADMIN_ACCOUNT_CONFLICT');
    console.log(`[INTERNAL_ADMIN_READY] created=${result.upsertedCount === 1}`);
  } finally {
    await connection.close();
  }
}

void createInternalAdmin().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : 'UNKNOWN';
  const safeCode = /^[A-Z_]+$/.test(code) ? code : 'DATABASE_OPERATION_FAILED';
  console.error(`[INTERNAL_ADMIN_PROVISION_FAILED] code=${safeCode}`);
  process.exitCode = 1;
});
