import { validateEnvironment } from './environment';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/clock?replicaSet=rs0',
  MONGODB_MIN_POOL_SIZE: '0',
  MONGODB_MAX_POOL_SIZE: '5',
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: '5000',
  MONGODB_SOCKET_TIMEOUT_MS: '45000',
  ACCESS_TOKEN_SECRET: 'a-secure-test-value-that-is-32-bytes-long',
  MANAGEMENT_TOKEN_SECRET: 'a-different-management-test-secret-value',
  ACCESS_TOKEN_ISSUER: 'panalbee-clock-test',
  ACCESS_TOKEN_AUDIENCE: 'panalbee-clock-test-api',
  ACCESS_TOKEN_TTL_SECONDS: '300',
  CORS_ORIGINS: 'http://localhost:3001,https://clock.example.test',
};

describe('validateEnvironment', () => {
  it('returns typed parsed configuration', () => {
    expect(validateEnvironment(valid)).toMatchObject({
      NODE_ENV: 'test',
      PORT: 3000,
      MONGODB_MAX_POOL_SIZE: 5,
      ACCESS_TOKEN_TTL_SECONDS: 300,
      CORS_ORIGINS: ['http://localhost:3001', 'https://clock.example.test'],
      WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_NAME: 'login_otp_temp',
      WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_LANGUAGE: 'es_CO',
    });
  });

  it('fails fast without critical values', () => {
    expect(() => validateEnvironment({})).toThrow('NODE_ENV is required');
    expect(() =>
      validateEnvironment({ ...valid, ACCESS_TOKEN_SECRET: 'short' }),
    ).toThrow('ACCESS_TOKEN_SECRET');
  });

  it('accepts mongodb+srv and rejects non-MongoDB connection strings', () => {
    expect(
      validateEnvironment({
        ...valid,
        MONGODB_URI: 'mongodb+srv://cluster.example.test/clock',
      }).MONGODB_URI,
    ).toContain('mongodb+srv://');
    expect(() =>
      validateEnvironment({ ...valid, MONGODB_URI: 'https://example.test' }),
    ).toThrow('MONGODB_URI must be a MongoDB URI');
  });

  it('maps the governed WhatsApp environment names without aliases', () => {
    expect(
      validateEnvironment({
        ...valid,
        WHATSAPP_API_VERSION: 'v23.0',
        WHATSAPP_PERMANENT_TOKEN: 'test-token',
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify',
        WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
        WABA_ID: 'waba-id',
      }),
    ).toMatchObject({
      WHATSAPP_API_VERSION: 'v23.0',
      WHATSAPP_PERMANENT_TOKEN: 'test-token',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
      WABA_ID: 'waba-id',
    });
  });

  it('rejects an inverted MongoDB pool range', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        MONGODB_MIN_POOL_SIZE: '6',
        MONGODB_MAX_POOL_SIZE: '5',
      }),
    ).toThrow('MONGODB_MIN_POOL_SIZE');
  });

  it('validates WhatsApp customer-access template identifiers', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_NAME: 'Invalid template',
      }),
    ).toThrow('WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_NAME');
    expect(() =>
      validateEnvironment({
        ...valid,
        WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_LANGUAGE: 'spanish',
      }),
    ).toThrow('WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_LANGUAGE');
  });
});
