import { createHmac } from 'node:crypto';
import { AppException } from '../../common/app-exception';
import {
  validateWhatsAppSignature,
  verifyWhatsAppToken,
} from './whatsapp-signature';

describe('WhatsApp signature validation', () => {
  const secret = 'test-whatsapp-app-secret';
  const rawBody = Buffer.from('{"entry":[]}');

  it('accepts a normalized sha256 signature over the exact raw bytes', () => {
    const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
    expect(() =>
      validateWhatsAppSignature(
        rawBody,
        ` SHA256=${digest.toUpperCase()} `,
        secret,
      ),
    ).not.toThrow();
  });

  it.each([undefined, '', 'sha256=nope', `sha256=${'0'.repeat(64)}`])(
    'rejects an invalid signature without leaking the digest',
    (signature) => {
      try {
        validateWhatsAppSignature(rawBody, signature, secret);
        throw new Error('signature unexpectedly accepted');
      } catch (error) {
        expect(error).toBeInstanceOf(AppException);
        expect((error as AppException).reasonCode).toBe(
          'WEBHOOK_SIGNATURE_INVALID',
        );
      }
    },
  );

  it('verifies the configured challenge token and rejects a mismatch', () => {
    expect(() => verifyWhatsAppToken('expected', 'expected')).not.toThrow();
    try {
      verifyWhatsAppToken('wrong', 'expected');
      throw new Error('token unexpectedly accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).reasonCode).toBe(
        'WEBHOOK_VERIFICATION_FAILED',
      );
    }
  });
});
