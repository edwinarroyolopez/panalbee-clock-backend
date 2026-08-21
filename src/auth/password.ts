import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: 64 * 1024 * 1024,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, saltValue, keyValue] =
    encoded.split('$');

  if (
    algorithm !== 'scrypt' ||
    Number(cost) !== COST ||
    Number(blockSize) !== BLOCK_SIZE ||
    Number(parallelization) !== PARALLELIZATION ||
    !saltValue ||
    !keyValue
  ) {
    return false;
  }

  const salt = Buffer.from(saltValue, 'base64url');
  const expected = Buffer.from(keyValue, 'base64url');
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;

  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}
