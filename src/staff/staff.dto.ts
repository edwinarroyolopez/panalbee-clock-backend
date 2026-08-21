import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateStaffDto {
  @IsUUID()
  locationId!: string;

  @IsString()
  @Length(2, 120)
  displayName!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AddStaffServiceDto {
  @IsUUID()
  serviceId!: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  durationOverrideMinutes?: number;
}

export class StaffListQueryDto {
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;
}
