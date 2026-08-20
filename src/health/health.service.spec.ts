import { DatabaseService } from '../database/database.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports process liveness without touching persistence', () => {
    const service = new HealthService(undefined as unknown as DatabaseService);
    expect(service.live()).toEqual({ status: 'ok' });
  });
});
