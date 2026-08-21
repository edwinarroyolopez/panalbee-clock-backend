import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.database.ping();
      await this.database.assertReplicaSet();
      return { status: 'ok' };
    } catch {
      throw new AppException(
        503,
        'DATABASE_UNAVAILABLE',
        'Service is not ready',
      );
    }
  }
}
