import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentAuth, Public, TenantRoles } from '../auth/auth.decorators';
import { TENANT_ROLES } from '../auth/auth.types';
import type { TenantOperationAuthContext } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { APPOINTMENT_MANAGEMENT_TOKEN_HEADER } from '../common/http-headers';
import { AppointmentEvidenceService } from './appointment-evidence.service';
import { APPOINTMENT_EVIDENCE_MAX_BYTES } from './appointment-evidence-file.policy';
import {
  PublicAppointmentListQueryDto,
  PublicSubmitAppointmentSurveyDto,
  SubmitAppointmentSurveyDto,
  UploadAppointmentEvidenceDto,
} from './appointment.dto';
import type {
  AppointmentEvidenceView,
  AppointmentSurveyView,
} from './appointment-feedback.view';
import { AppointmentSurveyService } from './appointment-survey.service';
import { AppointmentTimelineService } from './appointment-timeline.service';
import type { AppointmentTimelineView } from './appointment.view';
import { resolveManagementToken } from './appointments.controller';
import { bearerToken } from './customer-appointments.controller';
import { CustomerAppointmentAccessService } from './customer-appointment-access.service';

const evidenceInterceptor = FileInterceptor('file', {
  limits: { fileSize: APPOINTMENT_EVIDENCE_MAX_BYTES },
});

@Controller('appointments')
export class TenantAppointmentFeedbackController {
  constructor(
    private readonly timelines: AppointmentTimelineService,
    private readonly evidence: AppointmentEvidenceService,
  ) {}

  @TenantRoles(...TENANT_ROLES)
  @Get(':appointmentId/timeline')
  timeline(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
  ): Promise<AppointmentTimelineView> {
    return this.timelines.get(auth.tenant.id, appointmentId);
  }

  @TenantRoles('OWNER', 'MANAGER', 'AGENT')
  @Post(':appointmentId/evidence')
  @UseInterceptors(evidenceInterceptor)
  upload(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: UploadAppointmentEvidenceDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AppointmentEvidenceView> {
    return this.evidence.uploadTenant(
      auth.tenant.id,
      appointmentId,
      {
        actorUserId: auth.userId,
        actorType:
          auth.actorType === 'DELEGATED' ? 'INTERNAL_USER' : 'TENANT_USER',
      },
      dto,
      file,
    );
  }

  @TenantRoles(...TENANT_ROLES)
  @Get(':appointmentId/evidence/:evidenceId/access')
  access(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
  ): Promise<AppointmentEvidenceView> {
    return this.evidence.accessTenant(
      auth.tenant.id,
      appointmentId,
      evidenceId,
    );
  }
}

@Public()
@Controller('public/:tenantSlug/appointments')
export class PublicAppointmentFeedbackController {
  constructor(
    private readonly surveys: AppointmentSurveyService,
    private readonly evidence: AppointmentEvidenceService,
  ) {}

  @Get(':appointmentId/timeline')
  @Header('Cache-Control', 'private, no-store')
  timeline(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Query() query: PublicAppointmentListQueryDto,
    @Headers(APPOINTMENT_MANAGEMENT_TOKEN_HEADER)
    managementTokenHeader: string | undefined,
  ): Promise<AppointmentTimelineView> {
    if (query.managementToken !== undefined) {
      throw new AppException(
        400,
        'APPOINTMENT_MANAGEMENT_TOKEN_URL_FORBIDDEN',
        'Appointment management tokens are not accepted in URLs',
      );
    }
    return this.surveys.timelinePublic(
      tenantSlug,
      appointmentId,
      resolveManagementToken(managementTokenHeader, undefined),
    );
  }

  @Post(':appointmentId/evidence')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(evidenceInterceptor)
  upload(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Headers(APPOINTMENT_MANAGEMENT_TOKEN_HEADER)
    managementTokenHeader: string | undefined,
    @Body() dto: UploadAppointmentEvidenceDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AppointmentEvidenceView> {
    return this.evidence.uploadPublic(
      tenantSlug,
      appointmentId,
      resolveManagementToken(managementTokenHeader, undefined),
      dto,
      file,
    );
  }

  @Get(':appointmentId/evidence/:evidenceId/access')
  @Header('Cache-Control', 'private, no-store')
  access(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Headers(APPOINTMENT_MANAGEMENT_TOKEN_HEADER)
    managementTokenHeader: string | undefined,
  ): Promise<AppointmentEvidenceView> {
    return this.evidence.accessPublic(
      tenantSlug,
      appointmentId,
      resolveManagementToken(managementTokenHeader, undefined),
      evidenceId,
    );
  }

  @Post(':appointmentId/survey')
  @Header('Cache-Control', 'private, no-store')
  survey(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: PublicSubmitAppointmentSurveyDto,
  ): Promise<AppointmentSurveyView> {
    return this.surveys.submitPublic(tenantSlug, appointmentId, dto);
  }
}

@Public()
@Controller('public/:tenantSlug/customer-appointments')
export class PublicCustomerAppointmentFeedbackController {
  constructor(
    private readonly customerAccess: CustomerAppointmentAccessService,
    private readonly surveys: AppointmentSurveyService,
    private readonly evidence: AppointmentEvidenceService,
  ) {}

  @Get(':appointmentId/timeline')
  @Header('Cache-Control', 'private, no-store')
  async timeline(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AppointmentTimelineView> {
    const session = await this.customerAccess.authenticate(
      tenantSlug,
      bearerToken(authorization),
    );
    return this.surveys.timelineCustomer(
      session.tenantId,
      session.customerId,
      appointmentId,
    );
  }

  @Post(':appointmentId/evidence')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(evidenceInterceptor)
  async upload(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: UploadAppointmentEvidenceDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AppointmentEvidenceView> {
    const session = await this.customerAccess.authenticate(
      tenantSlug,
      bearerToken(authorization),
    );
    return this.evidence.uploadCustomer(
      session.tenantId,
      session.customerId,
      appointmentId,
      dto,
      file,
    );
  }

  @Get(':appointmentId/evidence/:evidenceId/access')
  @Header('Cache-Control', 'private, no-store')
  async access(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AppointmentEvidenceView> {
    const session = await this.customerAccess.authenticate(
      tenantSlug,
      bearerToken(authorization),
    );
    return this.evidence.accessCustomer(
      session.tenantId,
      session.customerId,
      appointmentId,
      evidenceId,
    );
  }

  @Post(':appointmentId/survey')
  @Header('Cache-Control', 'private, no-store')
  async survey(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: SubmitAppointmentSurveyDto,
  ): Promise<AppointmentSurveyView> {
    const session = await this.customerAccess.authenticate(
      tenantSlug,
      bearerToken(authorization),
    );
    return this.surveys.submitCustomer(
      session.tenantId,
      session.customerId,
      appointmentId,
      dto,
    );
  }
}
