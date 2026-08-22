import { AppException } from '../common/app-exception';
import {
  APPOINTMENT_EVIDENCE_MAX_BYTES,
  assertAppointmentEvidenceFile,
  safeEvidenceFileName,
} from './appointment-evidence-file.policy';

describe('appointment evidence file policy', () => {
  it.each([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    [
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    [
      'image/webp',
      Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    ],
  ])('accepts a valid %s signature', (mimetype, buffer) => {
    expect(() =>
      assertAppointmentEvidenceFile(file(buffer, mimetype)),
    ).not.toThrow();
  });

  it.each([
    [undefined, 'APPOINTMENT_EVIDENCE_FILE_REQUIRED'],
    [
      file(Buffer.from('plain text'), 'text/plain'),
      'APPOINTMENT_EVIDENCE_FILE_TYPE_INVALID',
    ],
    [
      file(Buffer.from('not a png'), 'image/png'),
      'APPOINTMENT_EVIDENCE_FILE_SIGNATURE_INVALID',
    ],
    [
      file(
        Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff]),
          Buffer.alloc(APPOINTMENT_EVIDENCE_MAX_BYTES),
        ]),
        'image/jpeg',
      ),
      'APPOINTMENT_EVIDENCE_FILE_TOO_LARGE',
    ],
  ])('rejects invalid evidence safely', (candidate, reasonCode) => {
    try {
      assertAppointmentEvidenceFile(candidate);
      throw new Error('Expected policy rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).reasonCode).toBe(reasonCode);
    }
  });

  it('normalizes path separators and control characters in stored names', () => {
    expect(safeEvidenceFileName('../bad\u0000\\name.png')).toBe(
      '.._bad__name.png',
    );
  });
});

function file(buffer: Buffer, mimetype: string): Express.Multer.File {
  return {
    buffer,
    mimetype,
    originalname: 'evidence.bin',
    fieldname: 'file',
    encoding: '7bit',
    size: buffer.length,
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
  };
}
