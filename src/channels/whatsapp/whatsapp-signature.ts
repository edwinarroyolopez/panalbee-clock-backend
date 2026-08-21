import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppException } from '../../common/app-exception';

const SIGNATURE = /^sha256=([a-f0-9]{64})$/i;

export function validateWhatsAppSignature(
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string | undefined,
): void {
  if (!appSecret) {
    throw new AppException(
      503,
      'CHANNEL_CREDENTIALS_MISSING',
      'WhatsApp webhook credentials are not configured',
    );
  }

  const match = signature?.trim().match(SIGNATURE);
  const supplied = match ? Buffer.from(match[1], 'hex') : Buffer.alloc(0);
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new AppException(
      401,
      'WEBHOOK_SIGNATURE_INVALID',
      'Webhook signature is invalid',
    );
  }
}

export function verifyWhatsAppToken(
  supplied: string,
  configured: string | undefined,
): void {
  if (!configured) {
    throw new AppException(
      503,
      'CHANNEL_CREDENTIALS_MISSING',
      'WhatsApp webhook credentials are not configured',
    );
  }

  const left = Buffer.from(supplied);
  const right = Buffer.from(configured);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new AppException(
      403,
      'WEBHOOK_VERIFICATION_FAILED',
      'Webhook verification failed',
    );
  }
}
