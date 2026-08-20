import { sanitizeAuditMetadata, validateAuditReason } from './audit.service';

describe('AuditService', () => {
  it('redacts sensitive metadata recursively', () => {
    expect(
      sanitizeAuditMetadata({
        token: 'not-for-audit',
        safe: 'value',
        nested: { authorization: 'Bearer credential' },
      }),
    ).toEqual({
      token: '[REDACTED]',
      safe: 'value',
      nested: { authorization: '[REDACTED]' },
    });
  });

  it('validates sensitive reasons inside the service boundary', () => {
    try {
      validateAuditReason('short');
      throw new Error('Expected reason validation to fail');
    } catch (error) {
      expect(error).toMatchObject({ reasonCode: 'AUDIT_REASON_INVALID' });
    }
  });
});
