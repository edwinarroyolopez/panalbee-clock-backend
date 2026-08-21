import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePublicProfileDto } from './accounts.dto';

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
