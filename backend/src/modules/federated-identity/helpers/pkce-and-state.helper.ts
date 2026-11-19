import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequestAppException } from '@packages/kernel/index.js';

export interface PkcePair {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: 'S256';
}

export function generateOpaqueSecret(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function constantTimeHexEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

export function assertRedirectUriAllowed(
  rawRedirectUri: string,
  providerAllowlist: readonly string[],
  globalAllowlist: readonly string[],
): string {
  const trimmed = rawRedirectUri.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestAppException('federated-identity.invalidRedirectUri');
  }

  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.hash.length > 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new BadRequestAppException('federated-identity.invalidRedirectUri');
  }

  const effectiveAllowlist = providerAllowlist.length > 0 ? providerAllowlist : globalAllowlist;

  const candidateNormalized = parsed.toString();
  const isAllowed = effectiveAllowlist.some((allowed) => {
    const clean = allowed.trim();
    if (!clean) return false;
    try {
      const allowedUrl = new URL(clean);
      return allowedUrl.toString() === candidateNormalized;
    } catch {
      return clean === trimmed;
    }
  });

  if (!isAllowed) {
    throw new BadRequestAppException('federated-identity.invalidRedirectUri');
  }

  return trimmed;
}
