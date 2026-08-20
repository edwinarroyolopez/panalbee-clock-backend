import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ScheduleListQueryDto {
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;
}

export class CreateScheduleDto {
  @IsUUID()
  locationId!: string;

  @IsUUID()
  staffId!: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startsAt!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endsAt!: string;
}

export class ExceptionListQueryDto extends ScheduleListQueryDto {}

export class CreateAvailabilityExceptionDto {
  @IsUUID()
  locationId!: string;

  @IsUUID()
  staffId!: string;

  @IsIn(['AVAILABLE', 'UNAVAILABLE'])
  kind!: 'AVAILABLE' | 'UNAVAILABLE';

  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsISO8601({ strict: true })
  endsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
