import { INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { AccountsModule } from '../src/accounts/accounts.module';
import { AppointmentsModule } from '../src/appointments/appointments.module';
import { AppointmentEvidenceStorageService } from '../src/appointments/appointment-evidence-storage.service';
import { AuditModule } from '../src/audit/audit.module';
import { DelegatedActionAuditInterceptor } from '../src/audit/delegated-action-audit.interceptor';
import { AccessTokenGuard } from '../src/auth/access-token.guard';
import { AuthModule } from '../src/auth/auth.module';
import { AuthorityGuard } from '../src/auth/authority.guard';
import { AvailabilityModule } from '../src/availability/availability.module';
import { ChannelAdapter } from '../src/channels/channel-adapter';
import { CHANNEL_ADAPTERS } from '../src/channels/channel-adapter.registry';
import { CatalogModule } from '../src/catalog/catalog.module';
import { configureApplication } from '../src/common/configure-application';
import { validateEnvironment } from '../src/config/environment';
import { CustomersModule } from '../src/customers/customers.module';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { SchedulesModule } from '../src/schedules/schedules.module';
import { StaffModule } from '../src/staff/staff.module';
import { hashPassword } from '../src/auth/password';
import { TenantsModule } from '../src/tenants/tenants.module';

export const testPassword = 'correct-password';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuditModule,
    AccountsModule,
    AuthModule,
    TenantsModule,
    CustomersModule,
    CatalogModule,
    StaffModule,
    SchedulesModule,
    AvailabilityModule,
    AppointmentsModule,
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
class BookingAvailabilityTestModule {}

export interface TestApp {
  app: INestApplication;
  server: Server;
  database: DatabaseService;
}

export async function startTestApp(
  adapters?: readonly ChannelAdapter[],
  evidenceStorage?: Pick<
    AppointmentEvidenceStorageService,
    'uploadPrivateImage' | 'signedUrl' | 'deletePrivateImage'
  >,
): Promise<TestApp> {
  let builder = Test.createTestingModule({
    imports: [BookingAvailabilityTestModule],
  });
  if (adapters) {
    builder = builder.overrideProvider(CHANNEL_ADAPTERS).useValue(adapters);
  }
  if (evidenceStorage) {
    builder = builder
      .overrideProvider(AppointmentEvidenceStorageService)
      .useValue(evidenceStorage);
  }
  const fixture = await builder.compile();
  const app = fixture.createNestApplication();
  configureApplication(app);
  await app.init();
  return {
    app,
    server: app.getHttpServer() as Server,
    database: app.get(DatabaseService),
  };
}

export async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
}

export async function login(server: Server, email: string): Promise<string> {
  const response = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password: testPassword })
    .expect(200);
  return (response.body as { accessToken: string }).accessToken;
}

export interface TenantFixture {
  tenant: string;
  location: string;
  service: string;
  staff: string;
  customer: string;
  owner: string;
  slug: string;
  email: string;
  phone: string;
  timezone?: string;
  durationMinutes?: number;
  scheduleStart?: string;
  scheduleEnd?: string;
  scheduleDays?: number[];
}

export async function seedTenant(
  database: DatabaseService,
  fixture: TenantFixture,
): Promise<void> {
  const passwordHash = await hashPassword(testPassword);
  await database.models.tenant.create({
    _id: fixture.tenant,
    name: `Tenant ${fixture.slug}`,
    slug: fixture.slug,
  });
  await database.models.location.create({
    _id: fixture.location,
    tenantId: fixture.tenant,
    name: 'Main',
    timezone: fixture.timezone ?? 'America/Bogota',
  });
  await database.models.service.create({
    _id: fixture.service,
    tenantId: fixture.tenant,
    name: 'Consultation',
    durationMinutes: fixture.durationMinutes ?? 60,
  });
  await database.models.staff.create({
    _id: fixture.staff,
    tenantId: fixture.tenant,
    locationId: fixture.location,
    displayName: 'Alex',
  });
  await database.models.staffService.create({
    tenantId: fixture.tenant,
    staffId: fixture.staff,
    serviceId: fixture.service,
  });
  await database.models.customer.create({
    _id: fixture.customer,
    tenantId: fixture.tenant,
    fullName: 'Ada Customer',
    phone: fixture.phone,
  });
  await database.models.user.create({
    _id: fixture.owner,
    email: fixture.email,
    displayName: 'Owner User',
    passwordHash,
    actorType: 'TENANT',
  });
  await database.models.tenantMembership.create({
    tenantId: fixture.tenant,
    userId: fixture.owner,
    role: 'OWNER',
  });
  await database.models.schedule.insertMany(
    (fixture.scheduleDays ?? [0, 1, 2, 3, 4, 5, 6]).map((dayOfWeek) => ({
      tenantId: fixture.tenant,
      locationId: fixture.location,
      staffId: fixture.staff,
      dayOfWeek,
      startsAt: fixture.scheduleStart ?? '09:00',
      endsAt: fixture.scheduleEnd ?? '17:00',
    })),
  );
}
