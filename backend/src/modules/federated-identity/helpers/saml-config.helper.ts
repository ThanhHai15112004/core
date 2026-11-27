import { BadRequestAppException, safeJsonParseObject } from '@packages/kernel/index.js';
import { FieldEncryptionService, defaultFieldEncryptionService } from '@packages/security/index.js';
import {
  SAML_BINDING,
  SAML_CERT_STATUS,
  SAML_DEFAULTS,
  type SamlBinding,
  type SamlCertStatus,
} from '../enum/federated-identity.enum.js';
import type {
  SamlAttributeMappingConfig,
  SamlIdpCertificateConfig,
  SamlProviderConfig,
  SamlProviderConfigView,
  SamlSpCertificatePublicView,
  SamlSpCertificateStoredConfig,
} from '../types/federated-identity.types.js';
import { inspectX509Certificate } from './saml-certificate.helper.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const DEFAULT_SAML_ATTRIBUTE_MAPPING: SamlAttributeMappingConfig = {
  subjectAttribute: null,
  emailAttribute: 'email',
  emailVerifiedAttribute: null,
  nameAttribute: 'displayName',
  firstNameAttribute: 'firstName',
  lastNameAttribute: 'lastName',
  avatarAttribute: null,
  groupsAttribute: 'groups',
  tenantIdAttribute: null,
  extraAttributes: {},
  requireEmail: true,
  requiredAttributes: [],
  treatEmailAsVerified: true,
};

export function buildDefaultSpEntityId(
  providerCode: string,
  baseUrl: string = SAML_DEFAULTS.DEFAULT_BASE_URL,
): string {
  const cleanCode = providerCode.trim().toLowerCase() || 'saml';
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/federated-identity/saml/${encodeURIComponent(cleanCode)}/metadata`;
}

export function buildDefaultAcsUrl(
  providerCode: string,
  baseUrl: string = SAML_DEFAULTS.DEFAULT_BASE_URL,
): string {
  const cleanCode = providerCode.trim().toLowerCase() || 'saml';
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/federated-identity/saml/${encodeURIComponent(cleanCode)}/acs`;
}

function asRecord(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function cleanOptionalString(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
}

function cleanStringOrDefault(val: unknown, fallback: string): string {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : fallback;
}

function normalizeSamlBinding(val: unknown): SamlBinding {
  if (typeof val !== 'string') return SAML_DEFAULTS.BINDING;
  const upper = val.trim().toUpperCase();
  return upper === SAML_BINDING.HTTP_POST ? SAML_BINDING.HTTP_POST : SAML_BINDING.HTTP_REDIRECT;
}

function normalizeCertStatus(val: unknown): SamlCertStatus {
  if (typeof val !== 'string') return SAML_CERT_STATUS.ACTIVE;
  const upper = val.trim().toUpperCase();
  if (upper === SAML_CERT_STATUS.TRANSITIONING) return SAML_CERT_STATUS.TRANSITIONING;
  if (upper === SAML_CERT_STATUS.REVOKED) return SAML_CERT_STATUS.REVOKED;
  return SAML_CERT_STATUS.ACTIVE;
}

function normalizeStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of val) {
    if (typeof item !== 'string') continue;
    const clean = item.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function normalizeExtraAttributes(val: unknown): Record<string, string> {
  const obj = asRecord(val);
  const out: Record<string, string> = {};
  for (const [key, rawVal] of Object.entries(obj)) {
    const cleanKey = key.trim();
    if (!cleanKey || FORBIDDEN_KEYS.has(cleanKey)) continue;
    if (typeof rawVal === 'string' && rawVal.trim().length > 0) {
      out[cleanKey] = rawVal.trim();
    }
  }
  return out;
}

function parseIdpCertificates(rawList: unknown): SamlIdpCertificateConfig[] {
  if (!Array.isArray(rawList)) return [];
  const out: SamlIdpCertificateConfig[] = [];
  for (const item of rawList) {
    const rec = asRecord(item);
    const rawPem = cleanOptionalString(rec['pem']);
    if (!rawPem) continue;
    const inspected = inspectX509Certificate(rawPem);
    out.push({
      id: cleanStringOrDefault(
        rec['id'],
        `cert_${inspected.fingerprint256.slice(0, 12).toLowerCase()}`,
      ),
      label: cleanOptionalString(rec['label']),
      pem: inspected.pem,
      fingerprint256: inspected.fingerprint256,
      subject: inspected.subject,
      validFrom: cleanStringOrDefault(rec['validFrom'], inspected.validFrom),
      validTo: cleanStringOrDefault(rec['validTo'], inspected.validTo),
      status: normalizeCertStatus(rec['status']),
      graceEndsAt: cleanOptionalString(rec['graceEndsAt']),
    });
  }
  return out;
}

function parseStoredSpCertificates(rawList: unknown): SamlSpCertificateStoredConfig[] {
  if (!Array.isArray(rawList)) return [];
  const out: SamlSpCertificateStoredConfig[] = [];
  for (const item of rawList) {
    const rec = asRecord(item);
    const rawPem = cleanOptionalString(rec['pem']);
    if (!rawPem) continue;
    const inspected = inspectX509Certificate(rawPem);
    out.push({
      id: cleanStringOrDefault(
        rec['id'],
        `sp_${inspected.fingerprint256.slice(0, 12).toLowerCase()}`,
      ),
      label: cleanOptionalString(rec['label']),
      pem: inspected.pem,
      fingerprint256: inspected.fingerprint256,
      subject: inspected.subject,
      validFrom: cleanStringOrDefault(rec['validFrom'], inspected.validFrom),
      validTo: cleanStringOrDefault(rec['validTo'], inspected.validTo),
      status: normalizeCertStatus(rec['status']),
      graceEndsAt: cleanOptionalString(rec['graceEndsAt']),
      privateKeyEncrypted: cleanOptionalString(rec['privateKeyEncrypted']),
    });
  }
  return out;
}

export function parseSamlAttributeMapping(raw: unknown): SamlAttributeMappingConfig {
  const obj = asRecord(raw);
  return {
    subjectAttribute:
      obj['subjectAttribute'] === null
        ? null
        : (cleanOptionalString(obj['subjectAttribute']) ??
          DEFAULT_SAML_ATTRIBUTE_MAPPING.subjectAttribute),
    emailAttribute: cleanStringOrDefault(
      obj['emailAttribute'],
      DEFAULT_SAML_ATTRIBUTE_MAPPING.emailAttribute,
    ),
    emailVerifiedAttribute:
      obj['emailVerifiedAttribute'] === null
        ? null
        : cleanOptionalString(obj['emailVerifiedAttribute']),
    nameAttribute: cleanStringOrDefault(
      obj['nameAttribute'],
      DEFAULT_SAML_ATTRIBUTE_MAPPING.nameAttribute,
    ),
    firstNameAttribute: cleanStringOrDefault(
      obj['firstNameAttribute'],
      DEFAULT_SAML_ATTRIBUTE_MAPPING.firstNameAttribute,
    ),
    lastNameAttribute: cleanStringOrDefault(
      obj['lastNameAttribute'],
      DEFAULT_SAML_ATTRIBUTE_MAPPING.lastNameAttribute,
    ),
    avatarAttribute:
      obj['avatarAttribute'] === null ? null : cleanOptionalString(obj['avatarAttribute']),
    groupsAttribute: cleanStringOrDefault(
      obj['groupsAttribute'],
      DEFAULT_SAML_ATTRIBUTE_MAPPING.groupsAttribute,
    ),
    tenantIdAttribute:
      obj['tenantIdAttribute'] === null ? null : cleanOptionalString(obj['tenantIdAttribute']),
    extraAttributes: normalizeExtraAttributes(obj['extraAttributes']),
    requireEmail:
      typeof obj['requireEmail'] === 'boolean'
        ? obj['requireEmail']
        : DEFAULT_SAML_ATTRIBUTE_MAPPING.requireEmail,
    requiredAttributes: normalizeStringArray(obj['requiredAttributes']),
    treatEmailAsVerified:
      typeof obj['treatEmailAsVerified'] === 'boolean'
        ? obj['treatEmailAsVerified']
        : DEFAULT_SAML_ATTRIBUTE_MAPPING.treatEmailAsVerified,
  };
}

export function parseSamlConfig(
  raw: Record<string, unknown> | string | null | undefined,
  providerCode: string,
  baseUrl?: string,
): SamlProviderConfig {
  const root =
    typeof raw === 'string' ? safeJsonParseObject<Record<string, unknown>>(raw, {}) : asRecord(raw);
  const rawSaml = root['samlConfig'] ? asRecord(root['samlConfig']) : root;

  const spEntityId = cleanStringOrDefault(
    rawSaml['spEntityId'],
    buildDefaultSpEntityId(providerCode, baseUrl),
  );
  const acsUrl = cleanStringOrDefault(rawSaml['acsUrl'], buildDefaultAcsUrl(providerCode, baseUrl));
  const rawSkew = Number(rawSaml['clockSkewSeconds']);
  const clockSkewSeconds = Number.isFinite(rawSkew)
    ? Math.max(0, Math.min(300, Math.trunc(rawSkew)))
    : SAML_DEFAULTS.CLOCK_SKEW_SECONDS;

  return {
    spEntityId,
    acsUrl,
    nameIdFormat: cleanStringOrDefault(rawSaml['nameIdFormat'], SAML_DEFAULTS.NAME_ID_FORMAT),
    idpEntityId: cleanOptionalString(rawSaml['idpEntityId']),
    idpSsoUrl: cleanOptionalString(rawSaml['idpSsoUrl']),
    idpSsoBinding: normalizeSamlBinding(rawSaml['idpSsoBinding']),
    wantAssertionsSigned:
      typeof rawSaml['wantAssertionsSigned'] === 'boolean' ? rawSaml['wantAssertionsSigned'] : true,
    authnRequestsSigned:
      typeof rawSaml['authnRequestsSigned'] === 'boolean' ? rawSaml['authnRequestsSigned'] : false,
    allowIdpInitiated:
      typeof rawSaml['allowIdpInitiated'] === 'boolean' ? rawSaml['allowIdpInitiated'] : false,
    clockSkewSeconds,
    idpCertificates: parseIdpCertificates(rawSaml['idpCertificates']),
    spCertificates: parseStoredSpCertificates(rawSaml['spCertificates']),
    attributeMapping: parseSamlAttributeMapping(rawSaml['attributeMapping']),
  };
}

export interface SamlSpCertificatePatchInput {
  readonly id?: string | undefined;
  readonly label?: string | null | undefined;
  readonly pem: string;
  readonly privateKey?: string | null | undefined;
  readonly status?: SamlCertStatus | undefined;
  readonly graceEndsAt?: string | null | undefined;
}

export type SamlAttributeMappingPatchInput = {
  readonly [K in keyof SamlAttributeMappingConfig]?: SamlAttributeMappingConfig[K] | undefined;
};

export interface SamlConfigPatchInput {
  readonly spEntityId?: string | undefined;
  readonly acsUrl?: string | undefined;
  readonly nameIdFormat?: string | undefined;
  readonly idpEntityId?: string | null | undefined;
  readonly idpSsoUrl?: string | null | undefined;
  readonly idpSsoBinding?: SamlBinding | undefined;
  readonly wantAssertionsSigned?: boolean | undefined;
  readonly authnRequestsSigned?: boolean | undefined;
  readonly allowIdpInitiated?: boolean | undefined;
  readonly clockSkewSeconds?: number | undefined;
  readonly idpCertificates?:
    | readonly {
        readonly id?: string | undefined;
        readonly label?: string | null | undefined;
        readonly pem: string;
        readonly status?: SamlCertStatus | undefined;
        readonly graceEndsAt?: string | null | undefined;
      }[]
    | undefined;
  readonly spCertificates?: readonly SamlSpCertificatePatchInput[] | undefined;
  readonly attributeMapping?: SamlAttributeMappingPatchInput | undefined;
}

function assertValidHttpUrlIfSet(value: string | null | undefined): void {
  if (!value) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestAppException('federated-identity.samlNotConfigured');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestAppException('federated-identity.samlNotConfigured');
  }
}

export function mergeSamlConfig(
  existing: SamlProviderConfig | undefined,
  patch: SamlConfigPatchInput | undefined,
  providerCode: string,
  encryptionService: FieldEncryptionService = defaultFieldEncryptionService,
): SamlProviderConfig {
  const base = existing ?? parseSamlConfig({}, providerCode);
  if (!patch) return base;

  if (patch.acsUrl !== undefined) assertValidHttpUrlIfSet(patch.acsUrl);
  if (patch.idpSsoUrl !== undefined) assertValidHttpUrlIfSet(patch.idpSsoUrl);

  const existingSpByFp = new Map(base.spCertificates.map((c) => [c.fingerprint256, c]));
  const nextSpCerts: SamlSpCertificateStoredConfig[] =
    patch.spCertificates !== undefined
      ? patch.spCertificates.map((item) => {
          const inspected = inspectX509Certificate(item.pem);
          const prev = existingSpByFp.get(inspected.fingerprint256);
          let privateKeyEncrypted = prev?.privateKeyEncrypted ?? null;
          if (item.privateKey !== undefined) {
            privateKeyEncrypted =
              item.privateKey && item.privateKey.trim().length > 0
                ? encryptionService.encrypt(item.privateKey.trim())
                : null;
          }
          return {
            id:
              item.id?.trim() ||
              prev?.id ||
              `sp_${inspected.fingerprint256.slice(0, 12).toLowerCase()}`,
            label: item.label !== undefined ? item.label : (prev?.label ?? null),
            pem: inspected.pem,
            fingerprint256: inspected.fingerprint256,
            subject: inspected.subject,
            validFrom: inspected.validFrom,
            validTo: inspected.validTo,
            status: item.status ?? prev?.status ?? SAML_CERT_STATUS.ACTIVE,
            graceEndsAt:
              item.graceEndsAt !== undefined ? item.graceEndsAt : (prev?.graceEndsAt ?? null),
            privateKeyEncrypted,
          };
        })
      : [...base.spCertificates];

  const nextIdpCerts: SamlIdpCertificateConfig[] =
    patch.idpCertificates !== undefined
      ? patch.idpCertificates.map((item) => {
          const inspected = inspectX509Certificate(item.pem);
          return {
            id: item.id?.trim() || `cert_${inspected.fingerprint256.slice(0, 12).toLowerCase()}`,
            label: item.label ?? null,
            pem: inspected.pem,
            fingerprint256: inspected.fingerprint256,
            subject: inspected.subject,
            validFrom: inspected.validFrom,
            validTo: inspected.validTo,
            status: item.status ?? SAML_CERT_STATUS.ACTIVE,
            graceEndsAt: item.graceEndsAt ?? null,
          };
        })
      : [...base.idpCertificates];

  const nextAttrMapping = parseSamlAttributeMapping({
    ...base.attributeMapping,
    ...(patch.attributeMapping ?? {}),
  });

  const rawSkew =
    patch.clockSkewSeconds !== undefined ? Number(patch.clockSkewSeconds) : base.clockSkewSeconds;

  return {
    spEntityId: patch.spEntityId?.trim() || base.spEntityId,
    acsUrl: patch.acsUrl?.trim() || base.acsUrl,
    nameIdFormat: patch.nameIdFormat?.trim() || base.nameIdFormat,
    idpEntityId:
      patch.idpEntityId !== undefined ? patch.idpEntityId?.trim() || null : base.idpEntityId,
    idpSsoUrl: patch.idpSsoUrl !== undefined ? patch.idpSsoUrl?.trim() || null : base.idpSsoUrl,
    idpSsoBinding: patch.idpSsoBinding ?? base.idpSsoBinding,
    wantAssertionsSigned:
      patch.wantAssertionsSigned !== undefined
        ? patch.wantAssertionsSigned
        : base.wantAssertionsSigned,
    authnRequestsSigned:
      patch.authnRequestsSigned !== undefined
        ? patch.authnRequestsSigned
        : base.authnRequestsSigned,
    allowIdpInitiated:
      patch.allowIdpInitiated !== undefined ? patch.allowIdpInitiated : base.allowIdpInitiated,
    clockSkewSeconds: Math.max(0, Math.min(300, Math.trunc(rawSkew))),
    idpCertificates: nextIdpCerts,
    spCertificates: nextSpCerts,
    attributeMapping: nextAttrMapping,
  };
}

export function toPublicSamlConfigView(config: SamlProviderConfig): SamlProviderConfigView {
  const spCertificates: SamlSpCertificatePublicView[] = config.spCertificates.map((c) => ({
    id: c.id,
    label: c.label ?? null,
    pem: c.pem,
    fingerprint256: c.fingerprint256,
    subject: c.subject,
    validFrom: c.validFrom,
    validTo: c.validTo,
    status: c.status,
    graceEndsAt: c.graceEndsAt,
    hasPrivateKey: Boolean(c.privateKeyEncrypted),
  }));

  return {
    spEntityId: config.spEntityId,
    acsUrl: config.acsUrl,
    nameIdFormat: config.nameIdFormat,
    idpEntityId: config.idpEntityId,
    idpSsoUrl: config.idpSsoUrl,
    idpSsoBinding: config.idpSsoBinding,
    wantAssertionsSigned: config.wantAssertionsSigned,
    authnRequestsSigned: config.authnRequestsSigned,
    allowIdpInitiated: config.allowIdpInitiated,
    clockSkewSeconds: config.clockSkewSeconds,
    idpCertificates: config.idpCertificates,
    spCertificates,
    attributeMapping: config.attributeMapping,
  };
}

export function isSamlProviderConfigured(config: SamlProviderConfig | undefined): boolean {
  if (!config) return false;
  const hasSp = Boolean(config.spEntityId?.trim() && config.acsUrl?.trim());
  const hasIdp = Boolean(config.idpEntityId?.trim() && config.idpSsoUrl?.trim());
  const hasCert = config.idpCertificates.some((c) => c.status !== SAML_CERT_STATUS.REVOKED);
  return hasSp && hasIdp && hasCert;
}
