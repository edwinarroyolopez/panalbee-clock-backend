import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BackofficeController } from './backoffice.controller';
import { BackofficeAuditController } from './backoffice-audit.controller';
import { BackofficeService } from './backoffice.service';

@Module({
  imports: [AuditModule],
  controllers: [BackofficeController, BackofficeAuditController],
  providers: [BackofficeService],
})
export class BackofficeModule {}
