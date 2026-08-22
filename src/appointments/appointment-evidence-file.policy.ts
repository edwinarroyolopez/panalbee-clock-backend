import { AppException } from '../common/app-exception';

export const APPOINTMENT_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const APPOINTMENT_EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export function assertAppointmentEvidenceFile(
  file?: Express.Multer.File,
): asserts file is Express.Multer.File {
  if (!file?.buffer?.length) {
    invalid('APPOINTMENT_EVIDENCE_FILE_REQUIRED', 'Image file is required');
  }
  if (
    !APPOINTMENT_EVIDENCE_MIME_TYPES.includes(
      file.mimetype as (typeof APPOINTMENT_EVIDENCE_MIME_TYPES)[number],
    )
  ) {
    invalid(
      'APPOINTMENT_EVIDENCE_FILE_TYPE_INVALID',
      'Only JPEG, PNG or WEBP images are allowed',
    );
  }
  if (file.buffer.length > APPOINTMENT_EVIDENCE_MAX_BYTES) {
    invalid(
      'APPOINTMENT_EVIDENCE_FILE_TOO_LARGE',
      'Image size must be 5 MB or less',
    );
  }
  if (detectedMime(file.buffer) !== file.mimetype) {
    invalid(
      'APPOINTMENT_EVIDENCE_FILE_SIGNATURE_INVALID',
      'Image contents do not match the declared file type',
    );
  }
}

export function safeEvidenceFileName(value: string): string {
  const safe = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 || character === '/' || character === '\\'
      ? '_'
      : character;
  })
    .join('')
    .trim()
    .slice(0, 255);
  return safe || 'image';
}

function detectedMime(buffer: Buffer): string | undefined {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

function invalid(reasonCode: string, message: string): never {
  throw new AppException(400, reasonCode, message);
}
