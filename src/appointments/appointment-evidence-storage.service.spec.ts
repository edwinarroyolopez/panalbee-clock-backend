import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/app-exception';
import { Environment } from '../config/environment';
import { AppointmentEvidenceStorageService } from './appointment-evidence-storage.service';

describe('AppointmentEvidenceStorageService', () => {
  it('fails safely when Cloudinary credentials are unavailable', async () => {
    const config = {
      get: () => undefined,
    } as unknown as ConfigService<Environment, true>;
    const storage = new AppointmentEvidenceStorageService(config);

    expect(() => storage.signedUrl('private/key', 'png')).toThrow(
      expect.objectContaining({
        reasonCode: 'APPOINTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
        message: 'Appointment evidence storage is unavailable',
      }) as AppException,
    );
    await expect(
      storage.uploadPrivateImage('tenant', 'appointment', {} as never),
    ).rejects.toMatchObject({
      reasonCode: 'APPOINTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
    });
  });
});
