import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { strict as assert } from 'node:assert';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { configureApplication } from '../src/common/configure-application';
import { DatabaseService } from '../src/database/database.service';
import { syncClockIndexes } from '../src/database/models';
import { hashPassword } from '../src/auth/password';

const STARTUP_TIMEOUT_MS = 180_000;

const backendDirectory = resolve(__dirname, '..');
const workspaceDirectory = resolve(backendDirectory, '..');
const adminDirectory = resolve(workspaceDirectory, 'panalbee-clock-admin');
const webDirectory = resolve(workspaceDirectory, 'panalbee-clock-web');
const backofficeDirectory = resolve(
  workspaceDirectory,
  'panalbee-clock-backoffice',
);
const loadModule = createRequire(__filename);

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

interface ManagedChild {
  name: string;
  process: ChildProcess;
  result?: ChildResult;
  completion: Promise<ChildResult>;
}

const children: ManagedChild[] = [];
const redactedValues = new Set<string>();
let application: INestApplication | undefined;
let replicaSet: MongoMemoryReplSet | undefined;
let cleanupPromise: Promise<void> | undefined;

function randomSecret(bytes = 32): string {
  const value = randomBytes(bytes).toString('base64url');
  redactedValues.add(value);
  return value;
}

function connectedPort(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  const port = Number(value);
  if (port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

function calendarDateInBogota(daysAhead: number): string {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (!part) throw new Error('Could not calculate the connected test date');
    return part;
  };
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function safeChildEnvironment(
  nodeEnvironment: 'development' | 'test',
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    CI: process.env.CI,
    TERM: process.env.TERM,
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    NO_PROXY: process.env.NO_PROXY,
    NODE_ENV: nodeEnvironment,
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.once('error', () => {
      rejectPort(new Error(`Required port ${port} is already occupied`));
    });
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) => (error ? rejectPort(error) : resolvePort()));
    });
  });
}

function startChild(
  name: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ManagedChild {
  console.log(`[connected] starting ${name}`);
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: 'inherit',
  });
  const managed = {} as ManagedChild;
  managed.name = name;
  managed.process = child;
  managed.completion = new Promise<ChildResult>((resolveChild) => {
    child.once('error', (error) =>
      resolveChild({ code: null, signal: null, error }),
    );
    child.once('exit', (code, signal) => resolveChild({ code, signal }));
  }).then((result) => {
    managed.result = result;
    return result;
  });
  children.push(managed);
  return managed;
}

async function waitForUrl(
  name: string,
  url: string,
  child?: ManagedChild,
): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child?.result) {
      throw new Error(`${name} exited before becoming ready`);
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status >= 200 && response.status < 400) {
        console.log(`[connected] ${name} is ready`);
        return;
      }
    } catch {
      // The process is still starting.
    }
    await delay(500);
  }
  throw new Error(`${name} did not become ready before the timeout`);
}

async function terminateChildren(): Promise<void> {
  const spawned = children.filter(({ process: child }) => child.pid);
  for (const { process: child } of spawned) {
    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  await Promise.race([
    Promise.all(spawned.map(({ completion }) => completion)),
    delay(5_000),
  ]);
  for (const { process: child } of spawned) {
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  await Promise.all(spawned.map(({ completion }) => completion));
}

function cleanup(): Promise<void> {
  cleanupPromise ??= (async () => {
    await terminateChildren();
    if (application) {
      await application.close();
      application = undefined;
    }
    if (replicaSet) {
      await replicaSet.stop();
      replicaSet = undefined;
    }
  })();
  return cleanupPromise;
}

async function runPlaywright(environment: NodeJS.ProcessEnv): Promise<void> {
  const playwright = startChild(
    'Playwright Chromium connected suite',
    process.execPath,
    [
      resolve(backofficeDirectory, 'node_modules/playwright/cli.js'),
      'test',
      '--config',
      'playwright.connected.config.ts',
    ],
    backofficeDirectory,
    environment,
  );
  const result = await playwright.completion;
  if (result.error || result.code !== 0) {
    throw new Error(
      `Playwright connected suite failed (${result.signal ?? result.code ?? 'spawn'})`,
    );
  }
}

async function assertDatabaseState(
  database: DatabaseService,
  platformAdminId: string,
  accountSlug: string,
  appointmentDate: string,
): Promise<void> {
  const models = database.models;
  assert.equal(
    await models.account.countDocuments({}),
    1,
    'expected one Account',
  );
  assert.equal(
    await models.tenant.countDocuments({}),
    1,
    'expected one Tenant',
  );
  assert.equal(
    await models.location.countDocuments({}),
    1,
    'expected one Location',
  );
  assert.equal(
    await models.user.countDocuments({}),
    2,
    'expected admin and owner users',
  );
  assert.equal(
    await models.tenantMembership.countDocuments({}),
    1,
    'expected one membership',
  );
  assert.equal(
    await models.accountPublicProfile.countDocuments({}),
    1,
    'expected one public profile',
  );

  const account = await models.account
    .findOne({ slug: accountSlug })
    .lean()
    .exec();
  assert.ok(account, 'connected Account was not persisted');
  assert.equal(account.status, 'ACTIVE');
  assert.equal(account.publicBookingEnabled, true);
  const tenant = await models.tenant.findById(account.tenantId).lean().exec();
  assert.ok(tenant, 'connected Tenant was not persisted');
  assert.equal(tenant.status, 'ACTIVE');
  assert.equal(tenant.slug, accountSlug);
  const location = await models.location
    .findOne({ tenantId: tenant._id })
    .lean()
    .exec();
  assert.ok(location, 'first connected Location was not persisted');
  assert.equal(location.timezone, 'America/Bogota');
  assert.equal(location.publicBookingEnabled, true);
  const owner = await models.user.findById(account.ownerUserId).lean().exec();
  assert.ok(owner, 'active Account owner was not persisted');
  assert.equal(owner.actorType, 'TENANT');
  assert.equal(owner.status, 'ACTIVE');
  assert.ok(owner.passwordHash, 'owner password must be stored only as a hash');
  assert.equal(
    await models.tenantMembership.countDocuments({
      tenantId: tenant._id,
      userId: owner._id,
      role: 'OWNER',
    }),
    1,
    'expected one OWNER membership',
  );
  const profile = await models.accountPublicProfile
    .findOne({ accountId: account._id })
    .lean()
    .exec();
  assert.ok(profile, 'Account public profile was not persisted');
  assert.equal(profile.bookingEnabled, true);
  assert.equal(profile.headline, 'Carefully connected appointments');

  assert.ok(
    (await models.service.countDocuments({ tenantId: tenant._id })) >= 1,
    'expected a Service',
  );
  assert.ok(
    (await models.staff.countDocuments({ tenantId: tenant._id })) >= 1,
    'expected Staff',
  );
  assert.ok(
    (await models.staffService.countDocuments({ tenantId: tenant._id })) >= 1,
    'expected StaffService eligibility',
  );
  const expectedDay = new Date(`${appointmentDate}T12:00:00.000Z`).getUTCDay();
  assert.ok(
    (await models.schedule.countDocuments({
      tenantId: tenant._id,
      dayOfWeek: expectedDay,
    })) >= 1,
    'expected a matching recurring Schedule',
  );

  assert.equal(
    await models.appointment.countDocuments({ tenantId: tenant._id }),
    1,
    'expected one Appointment',
  );
  assert.equal(
    await models.customer.countDocuments({ tenantId: tenant._id }),
    1,
    'expected one public customer',
  );
  const appointment = await models.appointment
    .findOne({ tenantId: tenant._id })
    .lean()
    .exec();
  assert.ok(appointment, 'connected Appointment was not persisted');
  assert.equal(appointment.status, 'CONFIRMED');
  assert.equal(appointment.sourceChannel, 'WEB');
  assert.equal(
    await models.appointmentIntervalLock.countDocuments({
      tenantId: tenant._id,
      appointmentId: appointment._id,
    }),
    30,
    'expected exactly 30 locks after reschedule',
  );
  assert.equal(
    await models.appointmentIntervalLock.countDocuments({}),
    30,
    'expected no stale appointment locks',
  );

  assert.equal(
    await models.auditEvent.countDocuments({
      tenantId: tenant._id,
      action: 'ACCOUNT_CREATED',
      entityType: 'account',
      entityId: account._id,
      actorUserId: platformAdminId,
      actorType: 'INTERNAL_USER',
    }),
    1,
    'expected ACCOUNT_CREATED audit provenance',
  );
  assert.equal(
    await models.auditEvent.countDocuments({
      tenantId: tenant._id,
      action: 'PUBLIC_PROFILE_UPDATED',
      entityType: 'account',
      entityId: account._id,
      actorUserId: platformAdminId,
      actorType: 'INTERNAL_USER',
    }),
    1,
    'expected PUBLIC_PROFILE_UPDATED audit provenance',
  );
  assert.equal(
    await models.auditEvent.countDocuments({
      tenantId: tenant._id,
      action: 'APPOINTMENT_CREATED',
      entityType: 'appointment',
      entityId: appointment._id,
      actorType: 'CUSTOMER',
    }),
    1,
    'expected APPOINTMENT_CREATED audit event',
  );
  assert.equal(
    await models.auditEvent.countDocuments({
      tenantId: tenant._id,
      action: 'APPOINTMENT_RESCHEDULED',
      entityType: 'appointment',
      entityId: appointment._id,
      actorUserId: platformAdminId,
      actorType: 'INTERNAL_USER',
    }),
    1,
    'expected APPOINTMENT_RESCHEDULED audit event',
  );

  assert.equal(
    await models.delegatedSession.countDocuments({}),
    1,
    'expected one DelegatedSession',
  );
  const delegatedSession = await models.delegatedSession
    .findOne({})
    .lean()
    .exec();
  assert.ok(delegatedSession, 'DelegatedSession was not persisted');
  assert.equal(delegatedSession.platformAdminId, platformAdminId);
  assert.equal(delegatedSession.targetTenantId, tenant._id);
  assert.equal(delegatedSession.status, 'REVOKED');
  assert.ok(delegatedSession.exchangedAt, 'DelegatedSession was not exchanged');
  assert.ok(delegatedSession.revokedAt, 'DelegatedSession was not revoked');
  assert.equal(delegatedSession.revokedBy, platformAdminId);
  assert.equal(
    await models.auditEvent.countDocuments({
      tenantId: tenant._id,
      action: 'DELEGATED_SESSION_STARTED',
      entityType: 'account',
      entityId: account._id,
      actorUserId: platformAdminId,
      'metadata.sessionId': delegatedSession._id,
    }),
    1,
    'expected delegated start provenance',
  );
  assert.equal(
    await models.auditEvent.countDocuments({
      tenantId: tenant._id,
      action: 'DELEGATED_SESSION_ENDED',
      entityType: 'account',
      entityId: account._id,
      actorUserId: platformAdminId,
      'metadata.sessionId': delegatedSession._id,
      'metadata.status': 'REVOKED',
    }),
    1,
    'expected delegated end provenance',
  );

  const attempted = await models.auditEvent
    .find({
      tenantId: tenant._id,
      action: 'DELEGATED_ACTION_ATTEMPTED',
      entityType: 'delegated_session',
      entityId: delegatedSession._id,
      actorUserId: platformAdminId,
      actorType: 'INTERNAL_USER',
      reason: delegatedSession.reason,
    })
    .lean()
    .exec();
  const completed = await models.auditEvent
    .find({
      tenantId: tenant._id,
      action: 'DELEGATED_ACTION_COMPLETED',
      entityType: 'delegated_session',
      entityId: delegatedSession._id,
      actorUserId: platformAdminId,
      actorType: 'INTERNAL_USER',
      reason: delegatedSession.reason,
    })
    .lean()
    .exec();
  assert.ok(attempted.length > 0, 'expected delegated attempted provenance');
  assert.ok(completed.length > 0, 'expected delegated completed provenance');
  const attemptedRequestIds = attempted.map((event) => {
    assert.ok(event.requestId, 'attempted delegated action needs a request ID');
    return event.requestId;
  });
  const completedRequestIds = completed.map((event) => {
    assert.ok(event.requestId, 'completed delegated action needs a request ID');
    return event.requestId;
  });
  assert.equal(
    new Set(attemptedRequestIds).size,
    attemptedRequestIds.length,
    'attempted delegated action request IDs must be unique',
  );
  assert.equal(
    new Set(completedRequestIds).size,
    completedRequestIds.length,
    'completed delegated action request IDs must be unique',
  );
  assert.deepEqual(
    [...attemptedRequestIds].sort(),
    [...completedRequestIds].sort(),
    'delegated attempts and completions need identical request IDs',
  );
  for (const event of completed) {
    assert.equal(event.metadata.sessionId, delegatedSession._id);
    assert.equal(typeof event.metadata.method, 'string');
    assert.equal(typeof event.metadata.path, 'string');
    assert.ok(
      typeof event.metadata.statusCode === 'number' &&
        event.metadata.statusCode >= 200 &&
        event.metadata.statusCode < 300,
      'completed delegated action needs a successful status',
    );
  }

  console.log(
    '[connected] Mongo assertions passed: provisioning, catalog, booking locks, audit provenance, and revoked delegation',
  );
}

function installSignalCleanup(): void {
  for (const [signal, exitCode] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    process.once(signal, () => {
      process.exitCode = exitCode;
      void cleanup().finally(() => process.exit(exitCode));
    });
  }
}

async function runConnectedGate(): Promise<void> {
  const BACKEND_PORT = connectedPort('CONNECTED_BACKEND_PORT', 7100);
  const ADMIN_PORT = connectedPort('CONNECTED_ADMIN_PORT', 3001);
  const WEB_PORT = connectedPort('CONNECTED_WEB_PORT', 3002);
  const BACKOFFICE_PORT = connectedPort('CONNECTED_BACKOFFICE_PORT', 3003);
  const REQUIRED_PORTS = [BACKEND_PORT, ADMIN_PORT, WEB_PORT, BACKOFFICE_PORT];
  if (new Set(REQUIRED_PORTS).size !== REQUIRED_PORTS.length) {
    throw new Error('Connected gate ports must be distinct');
  }

  const startedAt = Date.now();
  installSignalCleanup();
  await Promise.all(REQUIRED_PORTS.map(assertPortAvailable));

  const platformAdminId = randomUUID();
  const platformEmail = `platform-${randomBytes(6).toString('hex')}@connected.test`;
  const platformPhone = `+573${randomInt(1_000_000_000).toString().padStart(9, '0')}`;
  const platformPassword = randomSecret(24);
  const accessTokenSecret = randomSecret();
  const managementTokenSecret = randomSecret();
  const accountSlug = `connected-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const appointmentDate = calendarDateInBogota(21);

  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const mongoUri = replicaSet.getUri('panalbee_clock_account_saas_connected');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: String(BACKEND_PORT),
    MONGODB_URI: mongoUri,
    MONGODB_MIN_POOL_SIZE: '0',
    MONGODB_MAX_POOL_SIZE: '10',
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: '5000',
    MONGODB_SOCKET_TIMEOUT_MS: '45000',
    ACCESS_TOKEN_SECRET: accessTokenSecret,
    MANAGEMENT_TOKEN_SECRET: managementTokenSecret,
    ACCESS_TOKEN_ISSUER: 'panalbee-clock-connected',
    ACCESS_TOKEN_AUDIENCE: 'panalbee-clock-connected-api',
    ACCESS_TOKEN_TTL_SECONDS: '900',
    CORS_ORIGINS: [
      `http://127.0.0.1:${ADMIN_PORT}`,
      `http://127.0.0.1:${WEB_PORT}`,
      `http://127.0.0.1:${BACKOFFICE_PORT}`,
      `http://localhost:${ADMIN_PORT}`,
      `http://localhost:${WEB_PORT}`,
      `http://localhost:${BACKOFFICE_PORT}`,
    ].join(','),
  });

  // AppModule validates process.env while loading, so it must remain a late import.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const appModule: typeof import('../src/app.module') =
    loadModule('../src/app.module');
  application = await NestFactory.create(appModule.AppModule, {
    rawBody: true,
  });
  configureApplication(application);
  await application.init();
  const database = application.get<DatabaseService>(DatabaseService);
  await database.assertReplicaSet();
  await syncClockIndexes(database.connection);
  await database.models.user.create({
    _id: platformAdminId,
    email: platformEmail,
    phone: platformPhone,
    displayName: 'Connected Platform Admin',
    passwordHash: await hashPassword(platformPassword),
    actorType: 'INTERNAL',
    internalRole: 'PLATFORM_ADMIN',
    status: 'ACTIVE',
  });
  await application.listen(BACKEND_PORT, '127.0.0.1');
  await waitForUrl(
    'Backend',
    `http://127.0.0.1:${BACKEND_PORT}/api/v1/health/ready`,
  );

  const nextCli = (directory: string): string =>
    resolve(directory, 'node_modules/next/dist/bin/next');
  const admin = startChild(
    `Admin on 127.0.0.1:${ADMIN_PORT}`,
    process.execPath,
    [
      nextCli(adminDirectory),
      'dev',
      '-p',
      String(ADMIN_PORT),
      '-H',
      '127.0.0.1',
    ],
    adminDirectory,
    {
      ...safeChildEnvironment('development'),
      NEXT_PUBLIC_API_URL: `http://127.0.0.1:${BACKEND_PORT}`,
    },
  );
  const web = startChild(
    `Web on 127.0.0.1:${WEB_PORT}`,
    process.execPath,
    [nextCli(webDirectory), 'dev', '-p', String(WEB_PORT), '-H', '127.0.0.1'],
    webDirectory,
    {
      ...safeChildEnvironment('development'),
      NEXT_PUBLIC_API_URL: `http://127.0.0.1:${BACKEND_PORT}`,
    },
  );
  const backoffice = startChild(
    `Backoffice on 127.0.0.1:${BACKOFFICE_PORT}`,
    process.execPath,
    [
      nextCli(backofficeDirectory),
      'dev',
      '-p',
      String(BACKOFFICE_PORT),
      '-H',
      '127.0.0.1',
    ],
    backofficeDirectory,
    {
      ...safeChildEnvironment('development'),
      BACKEND_API_URL: `http://127.0.0.1:${BACKEND_PORT}`,
      NEXT_PUBLIC_ADMIN_URL: `http://localhost:${ADMIN_PORT}`,
      NEXT_PUBLIC_WEB_URL: `http://localhost:${WEB_PORT}`,
    },
  );
  await Promise.all([
    waitForUrl('Admin', `http://127.0.0.1:${ADMIN_PORT}`, admin),
    waitForUrl('Web', `http://127.0.0.1:${WEB_PORT}`, web),
    waitForUrl('Backoffice', `http://127.0.0.1:${BACKOFFICE_PORT}`, backoffice),
  ]);

  await runPlaywright({
    ...safeChildEnvironment('test'),
    CONNECTED_BACKEND_PORT: String(BACKEND_PORT),
    CONNECTED_ADMIN_PORT: String(ADMIN_PORT),
    CONNECTED_WEB_PORT: String(WEB_PORT),
    CONNECTED_BACKOFFICE_PORT: String(BACKOFFICE_PORT),
    CONNECTED_PLATFORM_PHONE: platformPhone,
    CONNECTED_PLATFORM_PASSWORD: platformPassword,
    CONNECTED_ACCOUNT_SLUG: accountSlug,
    CONNECTED_APPOINTMENT_DATE: appointmentDate,
  });
  await assertDatabaseState(
    database,
    platformAdminId,
    accountSlug,
    appointmentDate,
  );
  console.log(
    `[connected] Account SaaS gate passed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );
}

function redactedError(error: unknown): string {
  let message =
    error instanceof Error ? error.message : 'Unknown connected gate failure';
  for (const value of redactedValues)
    message = message.replaceAll(value, '[REDACTED]');
  return message;
}

void runConnectedGate()
  .catch((error: unknown) => {
    console.error(`[ACCOUNT_SAAS_CONNECTED_FAILED] ${redactedError(error)}`);
    process.exitCode = 1;
  })
  .finally(cleanup);
