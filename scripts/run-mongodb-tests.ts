import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

function childEnvironment(uri: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    CI: process.env.CI,
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    NO_PROXY: process.env.NO_PROXY,
    MONGOMS_DOWNLOAD_DIR: process.env.MONGOMS_DOWNLOAD_DIR,
    MONGOMS_VERSION: process.env.MONGOMS_VERSION,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--experimental-vm-modules']
      .filter(Boolean)
      .join(' '),
    NODE_ENV: 'test',
    PORT: '3000',
    MONGODB_URI: uri,
    MONGODB_MIN_POOL_SIZE: '0',
    MONGODB_MAX_POOL_SIZE: '5',
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: '5000',
    MONGODB_SOCKET_TIMEOUT_MS: '45000',
    ACCESS_TOKEN_SECRET: randomBytes(32).toString('hex'),
    MANAGEMENT_TOKEN_SECRET: randomBytes(32).toString('hex'),
    ACCESS_TOKEN_ISSUER: 'panalbee-clock-test',
    ACCESS_TOKEN_AUDIENCE: 'panalbee-clock-test-api',
    ACCESS_TOKEN_TTL_SECONDS: '300',
    CORS_ORIGINS: 'http://localhost:3001',
  };
}

async function run(
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('yarn', args, {
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Child process failed (${signal ?? code})`));
    });
  });
}

async function runMongoTests(): Promise<void> {
  const replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  try {
    const environment = childEnvironment(
      replicaSet.getUri('panalbee_clock_test'),
    );
    await run(['db:indexes'], environment);
    await run(['db:indexes'], environment);
    await run(
      [
        'jest',
        '--config',
        './test/jest-e2e.json',
        '--runInBand',
        ...process.argv.slice(2),
      ],
      environment,
    );
  } finally {
    await replicaSet.stop();
  }
}

void runMongoTests().catch(() => {
  console.error('[MONGODB_TEST_RUN_FAILED]');
  process.exitCode = 1;
});
