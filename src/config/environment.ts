export type NodeEnvironment = 'development' | 'test' | 'production';

export interface Environment {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  MONGODB_URI: string;
  MONGODB_MIN_POOL_SIZE: number;
  MONGODB_MAX_POOL_SIZE: number;
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: number;
  MONGODB_SOCKET_TIMEOUT_MS: number;
  ACCESS_TOKEN_SECRET: string;
  MANAGEMENT_TOKEN_SECRET: string;
  ACCESS_TOKEN_ISSUER: string;
  ACCESS_TOKEN_AUDIENCE: string;
  ACCESS_TOKEN_TTL_SECONDS: number;
  CORS_ORIGINS: string[];
  WHATSAPP_API_VERSION?: string;
  WHATSAPP_PERMANENT_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
  WABA_ID?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_API_BASE_URL?: string;
  WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_NAME: string;
  WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_LANGUAGE: string;
}

function requiredString(values: Record<string, unknown>, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid environment: ${name} is required`);
  }
  return value;
}

function optionalString(
  values: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = values[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function integer(
  values: Record<string, unknown>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = values[name] ?? String(fallback);
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid environment: ${name} must be an integer`);
  }
  return value;
}

function mongoUri(values: Record<string, unknown>): string {
  const value = requiredString(values, 'MONGODB_URI');
  if (!/^mongodb(?:\+srv)?:\/\//.test(value)) {
    throw new Error('Invalid environment: MONGODB_URI must be a MongoDB URI');
  }
  return value;
}

function corsOrigins(values: Record<string, unknown>): string[] {
  const entries = requiredString(values, 'CORS_ORIGINS')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new Error('Invalid environment: CORS_ORIGINS is required');
  }

  return entries.map((entry) => {
    try {
      const url = new URL(entry);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.origin !== entry ||
        url.username ||
        url.password
      ) {
        throw new Error();
      }
      return entry;
    } catch {
      throw new Error('Invalid environment: CORS_ORIGINS contains an origin');
    }
  });
}

export function validateEnvironment(
  values: Record<string, unknown>,
): Environment {
  const nodeEnvironment = requiredString(values, 'NODE_ENV');
  if (!['development', 'test', 'production'].includes(nodeEnvironment)) {
    throw new Error('Invalid environment: NODE_ENV is not supported');
  }

  const accessTokenSecret = requiredString(values, 'ACCESS_TOKEN_SECRET');
  if (Buffer.byteLength(accessTokenSecret, 'utf8') < 32) {
    throw new Error(
      'Invalid environment: ACCESS_TOKEN_SECRET must be at least 32 bytes',
    );
  }
  const managementTokenSecret = requiredString(
    values,
    'MANAGEMENT_TOKEN_SECRET',
  );
  if (Buffer.byteLength(managementTokenSecret, 'utf8') < 32) {
    throw new Error(
      'Invalid environment: MANAGEMENT_TOKEN_SECRET must be at least 32 bytes',
    );
  }

  const minPoolSize = integer(values, 'MONGODB_MIN_POOL_SIZE', 0, 0, 50);
  const maxPoolSize = integer(values, 'MONGODB_MAX_POOL_SIZE', 10, 1, 100);
  if (minPoolSize > maxPoolSize) {
    throw new Error(
      'Invalid environment: MONGODB_MIN_POOL_SIZE must not exceed MONGODB_MAX_POOL_SIZE',
    );
  }
  const customerAccessTemplateName =
    optionalString(values, 'WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_NAME') ??
    'login_otp_temp';
  const customerAccessTemplateLanguage =
    optionalString(values, 'WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_LANGUAGE') ??
    'es_CO';
  if (!/^[a-z0-9_]{1,512}$/.test(customerAccessTemplateName)) {
    throw new Error(
      'Invalid environment: WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_NAME is invalid',
    );
  }
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(customerAccessTemplateLanguage)) {
    throw new Error(
      'Invalid environment: WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_LANGUAGE is invalid',
    );
  }

  return {
    NODE_ENV: nodeEnvironment as NodeEnvironment,
    PORT: integer(values, 'PORT', 3000, 1, 65535),
    MONGODB_URI: mongoUri(values),
    MONGODB_MIN_POOL_SIZE: minPoolSize,
    MONGODB_MAX_POOL_SIZE: maxPoolSize,
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: integer(
      values,
      'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
      5_000,
      100,
      60_000,
    ),
    MONGODB_SOCKET_TIMEOUT_MS: integer(
      values,
      'MONGODB_SOCKET_TIMEOUT_MS',
      45_000,
      1_000,
      300_000,
    ),
    ACCESS_TOKEN_SECRET: accessTokenSecret,
    MANAGEMENT_TOKEN_SECRET: managementTokenSecret,
    ACCESS_TOKEN_ISSUER: requiredString(values, 'ACCESS_TOKEN_ISSUER').trim(),
    ACCESS_TOKEN_AUDIENCE: requiredString(
      values,
      'ACCESS_TOKEN_AUDIENCE',
    ).trim(),
    ACCESS_TOKEN_TTL_SECONDS: integer(
      values,
      'ACCESS_TOKEN_TTL_SECONDS',
      300,
      60,
      900,
    ),
    CORS_ORIGINS: corsOrigins(values),
    WHATSAPP_API_VERSION: optionalString(values, 'WHATSAPP_API_VERSION'),
    WHATSAPP_PERMANENT_TOKEN: optionalString(
      values,
      'WHATSAPP_PERMANENT_TOKEN',
    ),
    WHATSAPP_APP_SECRET: optionalString(values, 'WHATSAPP_APP_SECRET'),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalString(
      values,
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    ),
    WABA_ID: optionalString(values, 'WABA_ID'),
    WHATSAPP_PHONE_NUMBER_ID: optionalString(
      values,
      'WHATSAPP_PHONE_NUMBER_ID',
    ),
    WHATSAPP_API_BASE_URL: optionalString(values, 'WHATSAPP_API_BASE_URL'),
    WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_NAME: customerAccessTemplateName,
    WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_LANGUAGE: customerAccessTemplateLanguage,
  };
}
