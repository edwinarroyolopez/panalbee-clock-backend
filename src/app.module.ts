import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccountsModule } from './accounts/accounts.module';
import { AuditModule } from './audit/audit.module';
import { DelegatedActionAuditInterceptor } from './audit/delegated-action-audit.interceptor';
import { AppointmentsModule } from './appointments/appointments.module';
import { AccessTokenGuard } from './auth/access-token.guard';
import { AuthModule } from './auth/auth.module';
import { AuthorityGuard } from './auth/authority.guard';
import { BackofficeModule } from './backoffice/backoffice.module';
import { CatalogModule } from './catalog/catalog.module';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MessagingModule } from './messaging/messaging.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SchedulesModule } from './schedules/schedules.module';
import { StaffModule } from './staff/staff.module';
import { TenantsModule } from './tenants/tenants.module';
import { CustomersModule } from './customers/customers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuditModule,
    AccountsModule,
    AuthModule,
    HealthModule,
    TenantsModule,
    CustomersModule,
    CatalogModule,
    StaffModule,
    SchedulesModule,
    AppointmentsModule,
    MessagingModule,
    NotificationsModule,
    BackofficeModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: AuthorityGuard },
    {
      provide: APP_INTERCEPTOR,
      useClass: DelegatedActionAuditInterceptor,
    },
  ],
})
export class AppModule {}
