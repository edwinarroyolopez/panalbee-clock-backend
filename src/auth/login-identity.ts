export const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizeLoginPhone(phone: string): string {
  return phone.trim();
}
