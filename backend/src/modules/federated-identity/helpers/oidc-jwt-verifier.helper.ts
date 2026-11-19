import {
  type JsonWebKey as NodeJsonWebKey,
  createPublicKey,
  verify as cryptoVerify,
} from 'node:crypto';
import { safeJsonParseObject, UnauthorizedAppException } from '@packages/kernel/index.js';
import { constantTimeHexEqual, sha256Hex } from './pkce-and-state.helper.js';

export type OidcJwk = NodeJsonWebKey & {
  readonly kid?: string | undefined;
  readonly use?: string | undefined;
  readonly alg?: string | undefined;
  readonly kty?: string | undefined;
};

export interface OidcJwksDocument {
  readonly keys: readonly OidcJwk[];
}

interface JwtHeader extends Record<string, unknown> {
  readonly alg?: string | undefined;
  readonly kid?: string | undefined;
  readonly typ?: string | undefined;
}

const ALLOWED_JWT_ALGORITHMS: Readonly<
  Record<
    string,
    { readonly nodeAlg: string; readonly keyType: 'RSA' | 'EC'; readonly isEcdsa: boolean }
  >
> = {
  RS256: { nodeAlg: 'RSA-SHA256', keyType: 'RSA', isEcdsa: false },
  RS384: { nodeAlg: 'RSA-SHA384', keyType: 'RSA', isEcdsa: false },
  RS512: { nodeAlg: 'RSA-SHA512', keyType: 'RSA', isEcdsa: false },
  ES256: { nodeAlg: 'sha256', keyType: 'EC', isEcdsa: true },
  ES384: { nodeAlg: 'sha384', keyType: 'EC', isEcdsa: true },
};

export class OidcTokenVerificationError extends UnauthorizedAppException {
  public readonly reasonCode: string;

  constructor(i18nKey: string, reasonCode: string) {
    super(i18nKey);
    this.reasonCode = reasonCode;
  }
}

function decodeBase64UrlToString(segment: string): string {
  return Buffer.from(segment, 'base64url').toString('utf8');
}

function selectMatchingJwk(
  keys: readonly OidcJwk[],
  kid: string | undefined,
  requiredKty: 'RSA' | 'EC',
): OidcJwk | null {
  const signingKeys = keys.filter(
    (k) => (!k.use || k.use === 'sig') && (!k.kty || k.kty === requiredKty),
  );
  if (kid) {
    return signingKeys.find((k) => k.kid === kid) ?? null;
  }
  if (signingKeys.length === 1) {
    return signingKeys[0] ?? null;
  }
  return null;
}

export async function verifyOidcIdToken(params: {
  readonly idToken: string;
  readonly initialJwks: OidcJwksDocument;
  readonly refreshJwks?: (() => Promise<OidcJwksDocument>) | undefined;
  readonly expectedAudience: string;
  readonly expectedNonceHash: string;
  readonly validateIssuer: (issuer: string, claims: Record<string, unknown>) => boolean;
  readonly clockSkewSeconds?: number | undefined;
}): Promise<Record<string, unknown>> {
  const parts = params.idToken.trim().split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new OidcTokenVerificationError('federated-identity.invalidIdToken', 'malformed_jwt');
  }

  const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];
  const header = safeJsonParseObject<JwtHeader>(decodeBase64UrlToString(headerSeg), {});
  const algSpec = header.alg ? ALLOWED_JWT_ALGORITHMS[header.alg] : undefined;
  if (!algSpec) {
    throw new OidcTokenVerificationError(
      'federated-identity.invalidIdToken',
      `unsupported_alg:${String(header.alg ?? 'none')}`,
    );
  }

  let matchedKey = selectMatchingJwk(params.initialJwks.keys ?? [], header.kid, algSpec.keyType);
  if (!matchedKey && header.kid && params.refreshJwks) {
    const refreshed = await params.refreshJwks();
    matchedKey = selectMatchingJwk(refreshed.keys ?? [], header.kid, algSpec.keyType);
  }
  if (!matchedKey) {
    throw new OidcTokenVerificationError('federated-identity.invalidIdToken', 'jwk_not_found');
  }

  let signatureVerified = false;
  try {
    const publicKey = createPublicKey({ key: matchedKey as NodeJsonWebKey, format: 'jwk' });
    const signingInput = Buffer.from(`${headerSeg}.${payloadSeg}`, 'ascii');
    const signatureBuf = Buffer.from(sigSeg, 'base64url');
    signatureVerified = algSpec.isEcdsa
      ? cryptoVerify(
          algSpec.nodeAlg,
          signingInput,
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          signatureBuf,
        )
      : cryptoVerify(algSpec.nodeAlg, signingInput, publicKey, signatureBuf);
  } catch {
    signatureVerified = false;
  }

  if (!signatureVerified) {
    throw new OidcTokenVerificationError('federated-identity.invalidIdToken', 'invalid_signature');
  }

  const claims = safeJsonParseObject<Record<string, unknown>>(
    decodeBase64UrlToString(payloadSeg),
    {},
  );
  const nowSec = Math.floor(Date.now() / 1000);
  const skew = Math.max(0, params.clockSkewSeconds ?? 60);

  const exp = claims['exp'];
  if (typeof exp !== 'number' || !Number.isFinite(exp) || nowSec >= exp + skew) {
    throw new OidcTokenVerificationError('federated-identity.invalidIdToken', 'token_expired');
  }

  const nbf = claims['nbf'];
  if (typeof nbf === 'number' && Number.isFinite(nbf) && nowSec < nbf - skew) {
    throw new OidcTokenVerificationError(
      'federated-identity.invalidIdToken',
      'token_not_yet_valid',
    );
  }

  const rawIss = claims['iss'];
  if (
    typeof rawIss !== 'string' ||
    !rawIss.trim() ||
    !params.validateIssuer(rawIss.trim(), claims)
  ) {
    throw new OidcTokenVerificationError('federated-identity.invalidIdToken', 'invalid_issuer');
  }

  const rawAud = claims['aud'];
  const audValid =
    typeof rawAud === 'string'
      ? rawAud === params.expectedAudience
      : Array.isArray(rawAud) && rawAud.some((item) => item === params.expectedAudience);
  if (!audValid) {
    throw new OidcTokenVerificationError('federated-identity.invalidIdToken', 'invalid_audience');
  }

  const rawSub = claims['sub'];
  if (typeof rawSub !== 'string' || !rawSub.trim()) {
    throw new OidcTokenVerificationError('federated-identity.missingSubject', 'missing_subject');
  }

  const rawNonce = claims['nonce'];
  if (typeof rawNonce !== 'string' || !rawNonce.trim()) {
    throw new OidcTokenVerificationError('federated-identity.nonceMismatch', 'missing_nonce');
  }
  const actualNonceHash = sha256Hex(rawNonce.trim());
  if (!constantTimeHexEqual(actualNonceHash, params.expectedNonceHash)) {
    throw new OidcTokenVerificationError('federated-identity.nonceMismatch', 'nonce_mismatch');
  }

  return claims;
}
