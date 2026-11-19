import { BadRequestAppException } from '@packages/kernel/index.js';
import { PasswordHasherService } from '@packages/security/index.js';

const hasher = new PasswordHasherService();

function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const val = record[key];
      if (val !== undefined) {
        sorted[key] = canonicalizeValue(val);
      }
    }
    return sorted;
  }
  return value;
}

export function computeIdempotencyFingerprint(payload: Record<string, unknown>): string {
  const canonicalJson = JSON.stringify(canonicalizeValue(payload));
  return hasher.sha256(canonicalJson);
}

export function resolveIdempotencyKey(headerKey?: string | null, bodyKey?: string | null): string {
  const cleanHeader = headerKey?.trim() || '';
  const cleanBody = bodyKey?.trim() || '';
  if (cleanHeader && cleanBody && cleanHeader !== cleanBody) {
    throw new BadRequestAppException('payments.idempotencyKeyMismatch');
  }
  const resolved = cleanHeader || cleanBody;
  if (!resolved) {
    throw new BadRequestAppException('payments.idempotencyKeyRequired');
  }
  return resolved;
}
