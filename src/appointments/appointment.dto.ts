import {
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { APPOINTMENT_NO_SHOW_REASONS } from '../database/models';

export class AppointmentListQueryDto {
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsIn([
    'PENDING',
    'CONFIRMED',
    'IN_PROGRESS',
    'CANCELLED',
    'COMPLETED',
    'NO_SHOW',
  ])
  status?: string;

  @IsOptional()
  @IsIn(['OUTCOME_REQUIRED'])
  attention?: 'OUTCOME_REQUIRED';

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class CreateTenantAppointmentDto {
  @IsUUID()
  locationId!: string;

  @IsUUID()
  serviceId!: string;

  @IsUUID()
  staffId!: string;

  @IsUUID()
  customerId!: string;

  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  startsAt!: string;

  @IsString()
  @Length(8, 128)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CreatePublicAppointmentDto {
  @IsUUID()
  locationId!: string;

  @IsUUID()
  serviceId!: string;

  @IsUUID()
  staffId!: string;

  @IsString()
  @Length(2, 160)
  customerName!: string;

  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/)
  customerPhone!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  customerEmail?: string;

  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  startsAt!: string;

  @IsString()
  @Length(8, 128)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class PublicAppointmentListQueryDto {
  @IsOptional()
  @IsString()
  @Length(40, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  managementToken?: string;
}

export class RequestCustomerAccessCodeDto {
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/)
  phone!: string;
}

export class VerifyCustomerAccessCodeDto extends RequestCustomerAccessCodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class CancelAppointmentDto {
  @IsString()
  @Length(2, 500)
  reason!: string;
}

export class PublicCancelAppointmentDto extends CancelAppointmentDto {
  @IsString()
  @Length(40, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  managementToken!: string;
}

export class RescheduleAppointmentDto {
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  startsAt!: string;
}

export class TenantRescheduleAppointmentDto extends RescheduleAppointmentDto {
  @IsString()
  @Length(2, 500)
  reason!: string;
}

export class PublicRescheduleAppointmentDto extends RescheduleAppointmentDto {
  @IsString()
  @Length(40, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  managementToken!: string;
}

export class AppointmentCommandDto {
  @IsString()
  @Length(8, 128)
  idempotencyKey!: string;
}

export class CompleteAppointmentDto extends AppointmentCommandDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class NoShowAppointmentDto extends CompleteAppointmentDto {
  @IsString()
  @IsIn(APPOINTMENT_NO_SHOW_REASONS)
  reason!: (typeof APPOINTMENT_NO_SHOW_REASONS)[number];
}

export class UploadAppointmentEvidenceDto extends AppointmentCommandDto {}

export class SubmitAppointmentSurveyDto extends AppointmentCommandDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsUUID()
  evidenceId?: string;
}

export class PublicSubmitAppointmentSurveyDto extends SubmitAppointmentSurveyDto {
  @IsString()
  @Length(40, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  managementToken!: string;
}
