export interface CustomerAccessContext {
  tenantId: string;
  customerId: string;
}

export interface CustomerAccessCodeResult {
  accepted: true;
  expiresInSeconds: number;
}

export interface CustomerSessionResult {
  accessToken: string;
  expiresAt: string;
}
