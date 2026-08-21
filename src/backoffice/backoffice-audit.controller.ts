import { Controller, Get } from '@nestjs/common';
import { InternalRoles } from '../auth/auth.decorators';
import { BackofficeAuditView, BackofficeService } from './backoffice.service';

@Controller('backoffice/audit')
export class BackofficeAuditController {
  constructor(private readonly backoffice: BackofficeService) {}

  @InternalRoles('PLATFORM_ADMIN', 'PLATFORM_SUPPORT')
  @Get()
  audit(): Promise<{ items: BackofficeAuditView[] }> {
    return this.backoffice.listAudit();
  }
}
