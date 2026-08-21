import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('uses scrypt and timing-safe verification semantics', async () => {
    const hash = await hashPassword('correct-password');

    expect(hash).toMatch(/^scrypt\$/);
    await expect(verifyPassword('correct-password', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });
});
