import { IsIn, IsString, Length } from 'class-validator';

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export class UpdateTenantStatusDto {
  @IsIn(TENANT_STATUSES)
  status!: TenantStatus;

  @IsString()
  @Length(6, 500)
  reason!: string;
}
