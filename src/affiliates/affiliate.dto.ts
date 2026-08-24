import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AffiliateTermsDto {
  @IsIn(['NONE', 'PERCENT', 'FIXED'])
  discountType!: 'NONE' | 'PERCENT' | 'FIXED';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  discountBasisPoints?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  discountAmountMinor?: number;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  discountCurrency?: string;

  @IsIn(['PERCENT', 'FIXED'])
  commissionType!: 'PERCENT' | 'FIXED';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  commissionBasisPoints?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  commissionAmountMinor?: number;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  commissionCurrency?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  startsAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  expiresAt?: string;
}

export class CreateAffiliateCodeDto extends AffiliateTermsDto {
  @IsOptional()
  @IsString()
  @Length(4, 24)
  @Matches(/^[A-Za-z0-9-]+$/)
  code?: string;
}

export class ReferralQuoteDto {
  @IsString()
  @Length(4, 24)
  code!: string;

  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  serviceId!: string;
}

export class CreateAffiliatePayoutDto {
  @IsString()
  @Length(8, 128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  idempotencyKey!: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountMinor!: number;

  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalReference?: string;
}

export class CompleteAffiliatePayoutDto {
  @IsString()
  @Length(8, 128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  idempotencyKey!: string;

  @IsString()
  @Length(2, 200)
  externalReference!: string;
}

export class FailAffiliatePayoutDto {
  @IsString()
  @Length(8, 128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  idempotencyKey!: string;

  @IsString()
  @Length(6, 500)
  reason!: string;
}
