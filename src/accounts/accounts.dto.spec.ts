import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAccountDto, UpdatePublicProfileDto } from './accounts.dto';

const validCreateAccount = {
  businessName: 'Bee Studio',
  slug: 'bee-studio',
  ownerEmail: 'owner@example.test',
  ownerPhone: '+573001234567',
  ownerPassword: 'password',
  status: 'ACTIVE',
  publicBookingEnabled: true,
  locationName: 'Main Studio',
  timezone: 'America/Bogota',
};

describe('CreateAccountDto', () => {
  it.each(['12345678', 'x'.repeat(128)])(
    'accepts an owner password within the allowed length',
    async (ownerPassword) => {
      const dto = plainToInstance(CreateAccountDto, {
        ...validCreateAccount,
        ownerPassword,
      });

      await expect(validate(dto)).resolves.toEqual([]);
    },
  );

  it('does not transform the supplied owner password', async () => {
    const ownerPassword = '  password  ';
    const dto = plainToInstance(CreateAccountDto, {
      ...validCreateAccount,
      ownerPassword,
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.ownerPassword).toBe(ownerPassword);
  });

  it.each([undefined, '1234567', 'x'.repeat(129), 12345678])(
    'rejects a missing, non-string, or out-of-range owner password %#',
    async (ownerPassword) => {
      const dto = plainToInstance(CreateAccountDto, {
        ...validCreateAccount,
        ownerPassword,
      });
      const errors = await validate(dto);

      expect(errors).toContainEqual(
        expect.objectContaining({ property: 'ownerPassword' }),
      );
    },
  );
});

describe('UpdatePublicProfileDto', () => {
  it('accepts HTTPS profile URLs without credentials', async () => {
    const dto = plainToInstance(UpdatePublicProfileDto, {
      logo: 'https://cdn.example.test/logo.png',
      coverImage: 'https://cdn.example.test/cover.png',
      contactInfo: { website: 'https://example.test/book' },
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it.each([
    { logo: 'http://example.test/logo.png' },
    { coverImage: 'javascript:alert(1)' },
    { contactInfo: { website: 'https://user:password@example.test' } },
  ])('rejects unsafe profile URL input %#', async (input) => {
    const dto = plainToInstance(UpdatePublicProfileDto, input);

    await expect(validate(dto)).resolves.not.toEqual([]);
  });
});
