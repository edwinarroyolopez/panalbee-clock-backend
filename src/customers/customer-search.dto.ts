import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** POST keeps contact search terms out of URLs and intermediary URL logs. */
export class SearchCustomersDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;

  @IsOptional()
  @IsUUID('4')
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export interface CustomerSearchPage {
  items: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
  }[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}
