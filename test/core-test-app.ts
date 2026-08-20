import { INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import { AuditModule } from '../src/audit/audit.module';
import { AccessTokenGuard } from '../src/auth/access-token.guard';
import { AuthModule } from '../src/auth/auth.module';
import { AuthorityGuard } from '../src/auth/authority.guard';
import { BackofficeModule } from '../src/backoffice/backoffice.module';
import { CatalogModule } from '../src/catalog/catalog.module';
import { configureApplication } from '../src/common/configure-application';
import { validateEnvironment } from '../src/config/environment';
import { CustomersModule } from '../src/customers/customers.module';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { HealthModule } from '../src/health/health.module';
import { SchedulesModule } from '../src/schedules/schedules.module';
import { StaffModule } from '../src/staff/staff.module';
import { TenantsModule } from '../src/tenants/tenants.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    HealthModule,
    TenantsModule,
    CustomersModule,
    CatalogModule,
    StaffModule,
    SchedulesModule,
    BackofficeModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: AuthorityGuard },
  ],
})
class CoreTestModule {}

export interface CoreTestApplication {
  app: INestApplication;
  database: DatabaseService;
  server: Server;
}

export async function createCoreTestApplication(): Promise<CoreTestApplication> {
  const fixture = await Test.createTestingModule({
    imports: [CoreTestModule],
  }).compile();
  const app = fixture.createNestApplication();
  configureApplication(app);
  await app.init();
  return {
    app,
    database: app.get(DatabaseService),
    server: app.getHttpServer() as Server,
  };
}

export async function clearMongo(database: DatabaseService): Promise<void> {
  const collections = Object.values(database.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}
