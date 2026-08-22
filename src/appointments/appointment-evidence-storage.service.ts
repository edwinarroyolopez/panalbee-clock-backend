import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type { UploadApiResponse } from 'cloudinary';
import { AppException } from '../common/app-exception';
import { Environment } from '../config/environment';

export interface StoredAppointmentEvidence {
  storageKey: string;
  format: 'jpg' | 'jpeg' | 'png' | 'webp';
  sizeBytes: number;
  width: number;
  height: number;
}

@Injectable()
export class AppointmentEvidenceStorageService {
  constructor(private readonly config: ConfigService<Environment, true>) {
    const values = this.values();
    if (values) {
      cloudinary.config({
        cloud_name: values.cloudName,
        api_key: values.apiKey,
        api_secret: values.apiSecret,
      });
    }
  }

  async uploadPrivateImage(
    tenantId: string,
    appointmentId: string,
    file: Express.Multer.File,
  ): Promise<StoredAppointmentEvidence> {
    this.assertConfigured();
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `panalbee-clock/${tenantId}/appointments/${appointmentId}`,
          resource_type: 'image',
          type: 'authenticated',
          use_filename: false,
          unique_filename: true,
          overwrite: false,
        },
        (error, uploaded) => {
          if (error || !uploaded) return reject(storageFailure());
          resolve(uploaded);
        },
      );
      stream.on('error', () => reject(storageFailure()));
      stream.end(file.buffer);
    });
    if (
      !result.public_id ||
      !['jpg', 'jpeg', 'png', 'webp'].includes(result.format) ||
      !result.bytes ||
      !result.width ||
      !result.height
    ) {
      throw storageFailure();
    }
    return {
      storageKey: result.public_id,
      format: result.format as StoredAppointmentEvidence['format'],
      sizeBytes: result.bytes,
      width: result.width,
      height: result.height,
    };
  }

  signedUrl(
    storageKey: string,
    format: string,
  ): {
    url: string;
    expiresAt: string;
  } {
    this.assertConfigured();
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 300;
    return {
      url: cloudinary.utils.private_download_url(storageKey, format, {
        resource_type: 'image',
        type: 'authenticated',
        expires_at: expiresAtSeconds,
        attachment: false,
      }),
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
  }

  async deletePrivateImage(storageKey: string): Promise<void> {
    if (!this.values()) return;
    try {
      await cloudinary.uploader.destroy(storageKey, {
        resource_type: 'image',
        type: 'authenticated',
        invalidate: true,
      });
    } catch {
      // Best-effort compensation; the original persistence error remains primary.
    }
  }

  private values():
    { cloudName: string; apiKey: string; apiSecret: string } | undefined {
    const cloudName = this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    const apiKey = this.config.get('CLOUDINARY_API_KEY', { infer: true });
    const apiSecret = this.config.get('CLOUDINARY_API_SECRET', { infer: true });
    return cloudName && apiKey && apiSecret
      ? { cloudName, apiKey, apiSecret }
      : undefined;
  }

  private assertConfigured(): void {
    if (!this.values()) throw storageUnavailable();
  }
}

function storageFailure(): AppException {
  return new AppException(
    502,
    'APPOINTMENT_EVIDENCE_STORAGE_FAILED',
    'Appointment evidence could not be stored',
  );
}

function storageUnavailable(): AppException {
  return new AppException(
    503,
    'APPOINTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
    'Appointment evidence storage is unavailable',
  );
}
