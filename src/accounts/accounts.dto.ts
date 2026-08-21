import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { AccountStatus } from '../database/models';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const lowercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const CREATE_ACCOUNT_STATUSES = [
  'TRIAL',
  'ACTIVE',
  'SUSPENDED',
] as const;
export type CreateAccountStatus = (typeof CREATE_ACCOUNT_STATUSES)[number];

export class CreateAccountDto {
  @Transform(trim)
  @IsString()
  @Length(2, 160)
  businessName!: string;

  @Transform(lowercase)
  @IsString()
  @Length(2, 120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @Transform(lowercase)
  @IsEmail()
  @MaxLength(254)
  ownerEmail!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  ownerPhone!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  planCode?: string;

  @IsIn(CREATE_ACCOUNT_STATUSES)
  status!: CreateAccountStatus;

  @IsBoolean()
  publicBookingEnabled!: boolean;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  locationName!: string;

  @Transform(trim)
  @IsTimeZone()
  timezone!: string;
}

export class UpdateAccountStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status!: Extract<AccountStatus, 'ACTIVE' | 'SUSPENDED'>;

  @Transform(trim)
  @IsString()
  @Length(6, 500)
  reason!: string;
}

export class StartDelegatedSessionDto {
  @Transform(trim)
  @IsString()
  @Length(6, 500)
  reason!: string;
}

export class PublicContactInfoDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phone?: string | null;

  @IsOptional()
  @Transform(lowercase)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsUrl({
    protocols: ['https'],
    require_protocol: true,
    require_valid_protocol: true,
    disallow_auth: true,
  })
  @MaxLength(500)
  website?: string | null;
}

export class UpdatePublicProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  headline?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(3000)
  description?: string;

  @IsOptional()
  @Transform(trim)
  @IsUrl({
    protocols: ['https'],
    require_protocol: true,
    require_valid_protocol: true,
    disallow_auth: true,
  })
  @MaxLength(500)
  logo?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsUrl({
    protocols: ['https'],
    require_protocol: true,
    require_valid_protocol: true,
    disallow_auth: true,
  })
  @MaxLength(500)
  coverImage?: string | null;

  @IsOptional()
  @Transform(lowercase)
  @IsString()
  @Length(1, 50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  theme?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PublicContactInfoDto)
  contactInfo?: PublicContactInfoDto;

  @IsOptional()
  @IsBoolean()
  bookingEnabled?: boolean;
}
