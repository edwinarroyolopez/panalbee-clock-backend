import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

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
  @IsIn(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'])
  status?: string;

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

export class PublicRescheduleAppointmentDto extends RescheduleAppointmentDto {
  @IsString()
  @Length(40, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  managementToken!: string;
}
