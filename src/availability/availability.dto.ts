import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';

export class AvailabilityQueryDto {
  @IsUUID()
  locationId!: string;

  @IsUUID()
  serviceId!: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;
}
