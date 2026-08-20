import {
  AccountEntity,
  AccountPublicProfileEntity,
  UserEntity,
} from '../database/models';

export interface AccountListItemView {
  id: string;
  businessName: string;
  slug: string;
  status: AccountEntity['status'];
  phone: string;
  planCode: string | null;
  publicBookingEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountProfileView {
  headline: string;
  description: string;
  logo: string | null;
  coverImage: string | null;
  theme: string;
  contactInfo: {
    phone: string | null;
    email: string | null;
    website: string | null;
  };
  bookingEnabled: boolean;
}

export interface AccountDetailView extends AccountListItemView {
  tenantId: string;
  owner: {
    id: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    status: UserEntity['status'];
  };
  publicProfile: AccountProfileView;
}

export interface TenantAccountView extends AccountListItemView {
  publicProfile: AccountProfileView;
}

export interface AccountAuditView {
  id: string;
  actorType: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  requestId: string | null;
  createdAt: Date;
}

export function accountListItemView(
  account: AccountEntity,
): AccountListItemView {
  return {
    id: account._id,
    businessName: account.businessName,
    slug: account.slug,
    status: account.status,
    phone: account.phone,
    planCode: account.planCode ?? null,
    publicBookingEnabled: account.publicBookingEnabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function accountProfileView(
  profile: AccountPublicProfileEntity,
): AccountProfileView {
  return {
    headline: profile.headline,
    description: profile.description,
    logo: profile.logo ?? null,
    coverImage: profile.coverImage ?? null,
    theme: profile.theme,
    contactInfo: {
      phone: profile.contactInfo.phone ?? null,
      email: profile.contactInfo.email ?? null,
      website: profile.contactInfo.website ?? null,
    },
    bookingEnabled: profile.bookingEnabled,
  };
}
