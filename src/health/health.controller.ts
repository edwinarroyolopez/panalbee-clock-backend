import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
import { HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return this.health.live();
  }

  @Get('ready')
  ready(): Promise<{ status: 'ok' }> {
    return this.health.ready();
  }
}
