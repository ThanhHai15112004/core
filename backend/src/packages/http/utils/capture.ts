import { redactSensitiveData } from '@packages/logging/index.js';

export const MASK = '••••••••';
const EMAIL = /^([^@\s])[^@\s]*(@[^@\s]+\.[^@\s]+)$/;

/** `user@example.com` → `u***@example.com`. */
export function maskEmails<T>(input: T): T {
  if (typeof input === 'string') return input.replace(EMAIL, '$1***$2') as T;
  if (Array.isArray(input)) return input.map((v: unknown) => maskEmails(v)) as T;
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, maskEmails(v)]),
    ) as T;
  }
  return input;
}

/** Redact theo tên field (dùng chung logic với log) + che email. */
export function redactPayload<T>(input: T): T {
  return maskEmails(redactSensitiveData(input));
}

/** IPv4 che octet cuối, IPv6 giữ 4 nhóm đầu. */
export function maskIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.x');
  const groups = ip.split(':');
  return groups.length > 4 ? `${groups.slice(0, 4).join(':')}:…` : ip;
}
