import { X509Certificate, createHash } from 'node:crypto';
import { BadRequestAppException } from '@packages/kernel/index.js';
import { SAML_CERT_STATUS, SAML_DEFAULTS } from '../enum/federated-identity.enum.js';
import type {
  SamlCertificateStatus,
  SamlIdpCertificateConfig,
} from '../types/federated-identity.types.js';

export interface InspectedX509Certificate {
  readonly pem: string;
  readonly fingerprint256: string;
  readonly subject: string | null;
  readonly validFrom: string;
  readonly validTo: string;
}

export interface SamlCertificatesHealth {
  readonly activeCount: number;
  readonly transitioningCount: number;
  readonly revokedCount: number;
  readonly expiredCount: number;
  readonly expiringSoonCount: number;
  readonly eligibleCount: number;
  readonly warnings: readonly string[];
}

export function stripPemHeaders(pemOrBase64: string): string {
  return pemOrBase64
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/[\r\n\s]+/g, '')
    .trim();
}

export function normalizePemCertificate(rawCert: string): string {
  const base64 = stripPemHeaders(rawCert);
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new BadRequestAppException('federated-identity.samlInvalidCertificate');
  }
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.slice(i, i + 64));
  }
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

export function inspectX509Certificate(rawCert: string): InspectedX509Certificate {
  const pem = normalizePemCertificate(rawCert);
  try {
    const x509 = new X509Certificate(pem);
    const validFromDate = new Date(x509.validFrom);
    const validToDate = new Date(x509.validTo);
    const validFrom = Number.isNaN(validFromDate.getTime())
      ? new Date(0).toISOString()
      : validFromDate.toISOString();
    const validTo = Number.isNaN(validToDate.getTime())
      ? new Date(0).toISOString()
      : validToDate.toISOString();
    const fingerprint256 =
      x509.fingerprint256?.replace(/:/g, '').toUpperCase() ||
      createHash('sha256').update(x509.raw).digest('hex').toUpperCase();
    return {
      pem,
      fingerprint256,
      subject: x509.subject?.trim() || null,
      validFrom,
      validTo,
    };
  } catch {
    throw new BadRequestAppException('federated-identity.samlInvalidCertificate');
  }
}

export function buildIdpCertificateRecord(input: {
  readonly id?: string | undefined;
  readonly label?: string | null | undefined;
  readonly pem: string;
  readonly status?: SamlCertificateStatus | undefined;
  readonly graceEndsAt?: string | null | undefined;
}): SamlIdpCertificateConfig {
  const inspected = inspectX509Certificate(input.pem);
  return {
    id: input.id?.trim() || `cert_${inspected.fingerprint256.slice(0, 12).toLowerCase()}`,
    label: input.label?.trim() || null,
    pem: inspected.pem,
    fingerprint256: inspected.fingerprint256,
    subject: inspected.subject,
    validFrom: inspected.validFrom,
    validTo: inspected.validTo,
    status: input.status ?? SAML_CERT_STATUS.ACTIVE,
    graceEndsAt: input.graceEndsAt ?? null,
  };
}

export function isCertificateEligibleAt(
  cert: SamlIdpCertificateConfig,
  now: Date,
  clockSkewSeconds: number,
): boolean {
  if (cert.status === SAML_CERT_STATUS.REVOKED) return false;
  const nowMs = now.getTime();
  const skewMs = Math.max(0, clockSkewSeconds) * 1000;
  const validFromMs = new Date(cert.validFrom).getTime();
  const validToMs = new Date(cert.validTo).getTime();
  if (Number.isNaN(validFromMs) || Number.isNaN(validToMs)) return false;
  if (nowMs + skewMs < validFromMs) return false;
  if (nowMs - skewMs > validToMs) return false;

  if (cert.status === SAML_CERT_STATUS.TRANSITIONING && cert.graceEndsAt) {
    const graceMs = new Date(cert.graceEndsAt).getTime();
    if (!Number.isNaN(graceMs) && nowMs > graceMs) {
      return false;
    }
  }
  return true;
}

export function getEligibleIdpVerificationCerts(
  certs: readonly SamlIdpCertificateConfig[],
  now: Date = new Date(),
  clockSkewSeconds: number = SAML_DEFAULTS.CLOCK_SKEW_SECONDS,
): SamlIdpCertificateConfig[] {
  const eligible = certs.filter((c) => isCertificateEligibleAt(c, now, clockSkewSeconds));
  return eligible.sort((a, b) => {
    if (a.status === b.status) return 0;
    return a.status === SAML_CERT_STATUS.ACTIVE ? -1 : 1;
  });
}

export function mergeIdpCertificatesForRotation(
  existingCerts: readonly SamlIdpCertificateConfig[],
  incomingPems: readonly string[],
  options: {
    readonly mergeCertificates?: boolean | undefined;
    readonly transitionGraceDays?: number | undefined;
    readonly now?: Date | undefined;
  } = {},
): {
  readonly certificates: SamlIdpCertificateConfig[];
  readonly transitionedCount: number;
  readonly activeCount: number;
} {
  const now = options.now ?? new Date();
  const merge = options.mergeCertificates ?? true;
  const graceDays = Math.max(
    1,
    Math.min(90, Math.trunc(options.transitionGraceDays ?? SAML_DEFAULTS.TRANSITION_GRACE_DAYS)),
  );
  const graceDeadlineMs = now.getTime() + graceDays * 86_400_000;

  const incomingByFp = new Map<string, SamlIdpCertificateConfig>();
  for (const rawPem of incomingPems) {
    const rec = buildIdpCertificateRecord({ pem: rawPem, status: SAML_CERT_STATUS.ACTIVE });
    if (!incomingByFp.has(rec.fingerprint256)) {
      incomingByFp.set(rec.fingerprint256, rec);
    }
  }

  const resultMap = new Map<string, SamlIdpCertificateConfig>();
  let transitionedCount = 0;

  for (const existing of existingCerts) {
    const incomingMatch = incomingByFp.get(existing.fingerprint256);
    if (incomingMatch) {
      resultMap.set(existing.fingerprint256, {
        ...incomingMatch,
        id: existing.id,
        label: existing.label ?? incomingMatch.label ?? null,
        status: SAML_CERT_STATUS.ACTIVE,
        graceEndsAt: null,
      });
      continue;
    }

    if (existing.status === SAML_CERT_STATUS.REVOKED) {
      resultMap.set(existing.fingerprint256, existing);
      continue;
    }

    if (merge) {
      const validToMs = new Date(existing.validTo).getTime();
      const effectiveGraceMs = Number.isNaN(validToMs)
        ? graceDeadlineMs
        : Math.min(validToMs, graceDeadlineMs);
      const nextGraceEndsAt = existing.graceEndsAt ?? new Date(effectiveGraceMs).toISOString();
      resultMap.set(existing.fingerprint256, {
        ...existing,
        status: SAML_CERT_STATUS.TRANSITIONING,
        graceEndsAt: nextGraceEndsAt,
      });
      transitionedCount += 1;
    }
  }

  for (const [fp, rec] of incomingByFp.entries()) {
    if (!resultMap.has(fp)) {
      resultMap.set(fp, rec);
    }
  }

  const certificates = Array.from(resultMap.values());
  const activeCount = certificates.filter((c) => c.status === SAML_CERT_STATUS.ACTIVE).length;
  return { certificates, transitionedCount, activeCount };
}

export function evaluateCertificatesHealth(
  certs: readonly SamlIdpCertificateConfig[],
  now: Date = new Date(),
  clockSkewSeconds: number = SAML_DEFAULTS.CLOCK_SKEW_SECONDS,
): SamlCertificatesHealth {
  const nowMs = now.getTime();
  const soonThresholdMs = nowMs + 30 * 86_400_000;
  let activeCount = 0;
  let transitioningCount = 0;
  let revokedCount = 0;
  let expiredCount = 0;
  let expiringSoonCount = 0;
  const warnings: string[] = [];

  for (const cert of certs) {
    if (cert.status === SAML_CERT_STATUS.ACTIVE) activeCount += 1;
    else if (cert.status === SAML_CERT_STATUS.TRANSITIONING) transitioningCount += 1;
    else revokedCount += 1;

    if (cert.status === SAML_CERT_STATUS.REVOKED) continue;
    const validToMs = new Date(cert.validTo).getTime();
    if (!Number.isNaN(validToMs)) {
      if (validToMs < nowMs) {
        expiredCount += 1;
        warnings.push(`Certificate ${cert.fingerprint256.slice(0, 12)} expired at ${cert.validTo}`);
      } else if (validToMs <= soonThresholdMs) {
        expiringSoonCount += 1;
        warnings.push(
          `Certificate ${cert.fingerprint256.slice(0, 12)} expires soon at ${cert.validTo}`,
        );
      }
    }
  }

  const eligibleCount = getEligibleIdpVerificationCerts(certs, now, clockSkewSeconds).length;
  if (eligibleCount === 0) {
    warnings.push('No eligible active or transitioning IdP certificates available');
  }

  return {
    activeCount,
    transitioningCount,
    revokedCount,
    expiredCount,
    expiringSoonCount,
    eligibleCount,
    warnings,
  };
}
