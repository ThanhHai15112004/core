import { safeJsonParseObject } from '@packages/kernel/index.js';
import {
  FEDERATED_DRIVER_CODE,
  FEDERATED_PROTECTED_DENIED_ROLES,
  FEDERATED_ROLE_SYNC_MODE,
  type FederatedRoleSyncMode,
} from '../enum/federated-identity.enum.js';
import type {
  FederatedProviderExtraConfig,
  FederatedRoleSyncPolicy,
  OAuthAdapterResolvedConfig,
  OidcClaimMappingConfig,
  OidcProviderOptions,
  SamlProviderConfig,
  VerifiedExternalProfile,
} from '../types/federated-identity.types.js';
import { parseSamlConfig } from './saml-config.helper.js';

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export const DEFAULT_OIDC_OPTIONS: OidcProviderOptions = {
  discoveryEnabled: true,
  discoveryUrl: null,
  allowedIssuers: [],
  fetchUserInfo: false,
  allowedEmailDomains: [],
  extraAuthorizeParams: {},
};

export const DEFAULT_OIDC_CLAIM_MAPPING: OidcClaimMappingConfig = {
  emailClaim: 'email',
  emailVerifiedClaim: 'email_verified',
  nameClaim: 'name',
  firstNameClaim: 'given_name',
  lastNameClaim: 'family_name',
  avatarClaim: 'picture',
  groupsClaim: 'groups',
  tenantIdClaim: 'tid',
  extraAttributeClaims: {},
};

export const DEFAULT_ROLE_SYNC_POLICY: FederatedRoleSyncPolicy = {
  enabled: false,
  mode: FEDERATED_ROLE_SYNC_MODE.ADDITIVE,
  allowedRoleCodes: [],
  deniedRoleCodes: [...FEDERATED_PROTECTED_DENIED_ROLES],
  defaultRoleCodes: [],
  groupRoleMappings: {},
  requireMatchedGroup: false,
};

export function normalizeIssuerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function asRecord(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function toStringOrDefault(val: unknown, fallback: string): string {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : fallback;
}

function toStringArray(val: unknown): string[] {
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

function normalizeEmailDomains(val: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of toStringArray(val)) {
    const clean = item.replace(/^@+/, '').toLowerCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function normalizeRoleCodes(val: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of toStringArray(val)) {
    const clean = item.toUpperCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function normalizeStringRecord(val: unknown): Record<string, string> {
  const obj = asRecord(val);
  const out: Record<string, string> = {};
  for (const [key, rawVal] of Object.entries(obj)) {
    const cleanKey = key.trim();
    if (!cleanKey || FORBIDDEN_PATH_SEGMENTS.has(cleanKey)) continue;
    if (typeof rawVal === 'string' && rawVal.trim().length > 0) {
      out[cleanKey] = rawVal.trim();
    }
  }
  return out;
}

function normalizeGroupRoleMappings(val: unknown): Record<string, readonly string[]> {
  const obj = asRecord(val);
  const out: Record<string, readonly string[]> = {};
  for (const [groupName, rawRoles] of Object.entries(obj)) {
    const cleanGroup = groupName.trim();
    if (!cleanGroup || FORBIDDEN_PATH_SEGMENTS.has(cleanGroup)) continue;
    const roles = normalizeRoleCodes(rawRoles);
    if (roles.length > 0) {
      out[cleanGroup] = roles;
    }
  }
  return out;
}

function normalizeRoleSyncMode(val: unknown): FederatedRoleSyncMode {
  if (typeof val !== 'string') return DEFAULT_ROLE_SYNC_POLICY.mode;
  const upper = val.trim().toUpperCase();
  if (upper === FEDERATED_ROLE_SYNC_MODE.ASSIGN_ON_CREATE) {
    return FEDERATED_ROLE_SYNC_MODE.ASSIGN_ON_CREATE;
  }
  if (upper === FEDERATED_ROLE_SYNC_MODE.SYNC_MANAGED) {
    return FEDERATED_ROLE_SYNC_MODE.SYNC_MANAGED;
  }
  return FEDERATED_ROLE_SYNC_MODE.ADDITIVE;
}

export function parseFederatedExtraConfig(
  raw: Record<string, unknown> | string | null | undefined,
  driverCode?: string,
): FederatedProviderExtraConfig {
  const root =
    typeof raw === 'string'
      ? safeJsonParseObject<Record<string, unknown>>(raw, {})
      : asRecord(raw);

  const rawOidc = asRecord(root['oidcOptions']);
  const rawMapping = asRecord(root['claimMapping']);
  const rawRoleSync = asRecord(root['roleSyncPolicy']);

  const defaultDiscovery = driverCode?.trim().toLowerCase() === FEDERATED_DRIVER_CODE.OIDC;
  const discoveryUrlRaw = rawOidc['discoveryUrl'];

  const oidcOptions: OidcProviderOptions = {
    discoveryEnabled:
      typeof rawOidc['discoveryEnabled'] === 'boolean'
        ? rawOidc['discoveryEnabled']
        : defaultDiscovery,
    discoveryUrl:
      typeof discoveryUrlRaw === 'string' && discoveryUrlRaw.trim().length > 0
        ? discoveryUrlRaw.trim()
        : null,
    allowedIssuers: toStringArray(rawOidc['allowedIssuers']).map(normalizeIssuerUrl),
    fetchUserInfo:
      typeof rawOidc['fetchUserInfo'] === 'boolean'
        ? rawOidc['fetchUserInfo']
        : DEFAULT_OIDC_OPTIONS.fetchUserInfo,
    allowedEmailDomains: normalizeEmailDomains(rawOidc['allowedEmailDomains']),
    extraAuthorizeParams: normalizeStringRecord(rawOidc['extraAuthorizeParams']),
  };

  const claimMapping: OidcClaimMappingConfig = {
    emailClaim: toStringOrDefault(rawMapping['emailClaim'], DEFAULT_OIDC_CLAIM_MAPPING.emailClaim),
    emailVerifiedClaim: toStringOrDefault(
      rawMapping['emailVerifiedClaim'],
      DEFAULT_OIDC_CLAIM_MAPPING.emailVerifiedClaim,
    ),
    nameClaim: toStringOrDefault(rawMapping['nameClaim'], DEFAULT_OIDC_CLAIM_MAPPING.nameClaim),
    firstNameClaim: toStringOrDefault(
      rawMapping['firstNameClaim'],
      DEFAULT_OIDC_CLAIM_MAPPING.firstNameClaim,
    ),
    lastNameClaim: toStringOrDefault(
      rawMapping['lastNameClaim'],
      DEFAULT_OIDC_CLAIM_MAPPING.lastNameClaim,
    ),
    avatarClaim: toStringOrDefault(
      rawMapping['avatarClaim'],
      DEFAULT_OIDC_CLAIM_MAPPING.avatarClaim,
    ),
    groupsClaim: toStringOrDefault(
      rawMapping['groupsClaim'],
      DEFAULT_OIDC_CLAIM_MAPPING.groupsClaim,
    ),
    tenantIdClaim: toStringOrDefault(
      rawMapping['tenantIdClaim'],
      DEFAULT_OIDC_CLAIM_MAPPING.tenantIdClaim,
    ),
    extraAttributeClaims: normalizeStringRecord(rawMapping['extraAttributeClaims']),
  };

  const customDenied = normalizeRoleCodes(rawRoleSync['deniedRoleCodes']);
  const mergedDenied = Array.from(
    new Set([...FEDERATED_PROTECTED_DENIED_ROLES, ...customDenied]),
  );

  const roleSyncPolicy: FederatedRoleSyncPolicy = {
    enabled:
      typeof rawRoleSync['enabled'] === 'boolean'
        ? rawRoleSync['enabled']
        : DEFAULT_ROLE_SYNC_POLICY.enabled,
    mode: normalizeRoleSyncMode(rawRoleSync['mode']),
    allowedRoleCodes: normalizeRoleCodes(rawRoleSync['allowedRoleCodes']),
    deniedRoleCodes: mergedDenied,
    defaultRoleCodes: normalizeRoleCodes(rawRoleSync['defaultRoleCodes']),
    groupRoleMappings: normalizeGroupRoleMappings(rawRoleSync['groupRoleMappings']),
    requireMatchedGroup:
      typeof rawRoleSync['requireMatchedGroup'] === 'boolean'
        ? rawRoleSync['requireMatchedGroup']
        : DEFAULT_ROLE_SYNC_POLICY.requireMatchedGroup,
  };

  const hasSamlConfig =
    driverCode?.trim().toLowerCase() === FEDERATED_DRIVER_CODE.SAML ||
    Boolean(root['samlConfig']);
  const samlConfig = hasSamlConfig
    ? parseSamlConfig(root, driverCode ?? FEDERATED_DRIVER_CODE.SAML)
    : undefined;

  return {
    oidcOptions,
    claimMapping,
    roleSyncPolicy,
    ...(samlConfig ? { samlConfig } : {}),
  };
}

export interface PartialFederatedExtraConfigPatch {
  readonly oidcOptions?: Partial<OidcProviderOptions> | undefined;
  readonly claimMapping?: Partial<OidcClaimMappingConfig> | undefined;
  readonly roleSyncPolicy?: Partial<FederatedRoleSyncPolicy> | undefined;
  readonly samlConfig?: SamlProviderConfig | undefined;
}

export function mergeFederatedExtraConfig(
  existing: FederatedProviderExtraConfig,
  patch: PartialFederatedExtraConfigPatch,
  driverCode?: string,
): FederatedProviderExtraConfig {
  const nextSaml = patch.samlConfig ?? existing.samlConfig;
  const mergedRaw: Record<string, unknown> = {
    oidcOptions: {
      ...existing.oidcOptions,
      ...(patch.oidcOptions ?? {}),
    },
    claimMapping: {
      ...existing.claimMapping,
      ...(patch.claimMapping ?? {}),
    },
    roleSyncPolicy: {
      ...existing.roleSyncPolicy,
      ...(patch.roleSyncPolicy ?? {}),
    },
    ...(nextSaml ? { samlConfig: nextSaml } : {}),
  };
  return parseFederatedExtraConfig(mergedRaw, driverCode);
}

export function getClaimByPath(claims: Record<string, unknown>, path: string): unknown {
  const cleanPath = path.trim();
  if (!cleanPath) return undefined;
  if (Object.prototype.hasOwnProperty.call(claims, cleanPath)) {
    return claims[cleanPath];
  }
  const segments = cleanPath.split('.').filter((s) => s.length > 0);
  if (segments.length === 0) return undefined;

  let current: unknown = claims;
  for (const seg of segments) {
    if (FORBIDDEN_PATH_SEGMENTS.has(seg)) return undefined;
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, seg)) {
      return undefined;
    }
    current = record[seg];
  }
  return current;
}

export function extractGroupsFromClaimValue(raw: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const pushGroup = (val: string) => {
    const clean = val.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        pushGroup(item);
      } else if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        if (typeof rec['name'] === 'string') {
          pushGroup(rec['name']);
        } else if (typeof rec['code'] === 'string') {
          pushGroup(rec['code']);
        } else if (typeof rec['id'] === 'string') {
          pushGroup(rec['id']);
        }
      }
    }
    return out;
  }

  if (typeof raw === 'string' && raw.trim().length > 0) {
    const tokens = raw.includes(',') ? raw.split(',') : raw.split(/\s+/);
    for (const token of tokens) {
      pushGroup(token);
    }
  }

  return out;
}

function resolveClaimWithFallback(
  claims: Record<string, unknown>,
  userInfoClaims: Record<string, unknown> | null | undefined,
  path: string,
): unknown {
  const primary = getClaimByPath(claims, path);
  if (primary !== undefined && primary !== null && primary !== '') {
    return primary;
  }
  if (!userInfoClaims) return primary;
  return getClaimByPath(userInfoClaims, path);
}

function toCleanString(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
}

function toBooleanClaim(val: unknown): boolean {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    return lower === 'true' || lower === '1';
  }
  return false;
}

function toPrimitiveAttribute(val: unknown): string | number | boolean | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => String(item)).join(',');
  }
  return null;
}

export function mapOidcClaimsWithConfig(params: {
  readonly claims: Record<string, unknown>;
  readonly userInfoClaims?: Record<string, unknown> | null | undefined;
  readonly config: OAuthAdapterResolvedConfig;
  readonly driverCode: string;
  readonly resolvedIssuer: string;
  readonly claimMapping: OidcClaimMappingConfig;
}): VerifiedExternalProfile {
  const { claims, userInfoClaims, config, driverCode, resolvedIssuer, claimMapping } = params;

  const rawEmail =
    toCleanString(resolveClaimWithFallback(claims, userInfoClaims, claimMapping.emailClaim)) ??
    (() => {
      const fallback = toCleanString(
        resolveClaimWithFallback(claims, userInfoClaims, 'preferred_username'),
      );
      return fallback && fallback.includes('@') ? fallback : null;
    })();
  const email = rawEmail ? rawEmail.toLowerCase() : null;

  const emailVerifiedRaw = resolveClaimWithFallback(
    claims,
    userInfoClaims,
    claimMapping.emailVerifiedClaim,
  );
  const emailVerified =
    toBooleanClaim(emailVerifiedRaw) ||
    claims['xms_edov'] === true ||
    claims['xms_edov'] === 1;

  const firstName = toCleanString(
    resolveClaimWithFallback(claims, userInfoClaims, claimMapping.firstNameClaim),
  );
  const lastName = toCleanString(
    resolveClaimWithFallback(claims, userInfoClaims, claimMapping.lastNameClaim),
  );
  const explicitName = toCleanString(
    resolveClaimWithFallback(claims, userInfoClaims, claimMapping.nameClaim),
  );
  const displayName =
    explicitName ?? ([lastName, firstName].filter(Boolean).join(' ') || email);

  const avatarUrl = toCleanString(
    resolveClaimWithFallback(claims, userInfoClaims, claimMapping.avatarClaim),
  );
  const tenantId =
    toCleanString(resolveClaimWithFallback(claims, userInfoClaims, claimMapping.tenantIdClaim)) ??
    config.tenantId?.trim() ??
    null;

  const tokenGroups = extractGroupsFromClaimValue(
    getClaimByPath(claims, claimMapping.groupsClaim),
  );
  const userInfoGroups = userInfoClaims
    ? extractGroupsFromClaimValue(getClaimByPath(userInfoClaims, claimMapping.groupsClaim))
    : [];
  const groups = Array.from(new Set([...tokenGroups, ...userInfoGroups]));

  const attributes: Record<string, string | number | boolean | null> = {};
  for (const [attrKey, claimPath] of Object.entries(claimMapping.extraAttributeClaims)) {
    const rawAttr = resolveClaimWithFallback(claims, userInfoClaims, claimPath);
    if (rawAttr !== undefined) {
      attributes[attrKey] = toPrimitiveAttribute(rawAttr);
    }
  }

  const issuerToPersist =
    toCleanString(claims['iss']) ? String(claims['iss']).trim() : resolvedIssuer;

  return {
    providerCode: config.providerCode,
    driverCode,
    issuer: issuerToPersist,
    subject: String(claims['sub']).trim(),
    tenantId,
    email,
    emailVerified,
    displayName,
    firstName,
    lastName,
    avatarUrl,
    ...(groups.length > 0 ? { groups } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    rawClaimsSummary: {
      issuer: issuerToPersist,
      emailVerified,
      groupsCount: groups.length,
      ...(tenantId ? { tenantId } : {}),
      ...(Object.keys(attributes).length > 0
        ? { mappedAttributeKeys: Object.keys(attributes) }
        : {}),
    },
  };
}

export function isEmailDomainAllowed(
  email: string | null | undefined,
  allowedEmailDomains: readonly string[],
): boolean {
  if (allowedEmailDomains.length === 0) return true;
  if (!email || !email.includes('@')) return false;
  const domain = email.trim().toLowerCase().split('@').pop() ?? '';
  if (!domain) return false;
  return allowedEmailDomains.some((allowed) => allowed.trim().toLowerCase() === domain);
}
