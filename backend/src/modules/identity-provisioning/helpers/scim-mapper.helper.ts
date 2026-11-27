import { type ProvisionedUserView, USER_STATUS } from '@modules/users/contracts/index.js';
import { SCIM_SCHEMAS } from '../enum/identity-provisioning.enum.js';
import type { ScimGroupEntity } from '../entities/scim-group.entity.js';
import type { ScimUserLinkEntity } from '../entities/scim-user-link.entity.js';
import type {
  ScimGroupMemberRef,
  ScimGroupResource,
  ScimListResponse,
  ScimPatchOperation,
  ScimUserGroupRef,
  ScimUserResource,
} from '../types/identity-provisioning.types.js';
import { ScimProtocolException } from './scim-error.helper.js';
import { formatScimEtag } from './scim-security.helper.js';

export interface NormalizedScimUserInput {
  readonly externalId?: string | undefined;
  readonly userName?: string | undefined;
  readonly email?: string | undefined;
  readonly phone?: string | null | undefined;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly fullName?: string | undefined;
  readonly active?: boolean | undefined;
}

export interface NormalizedScimGroupInput {
  readonly externalId?: string | undefined;
  readonly displayName?: string | undefined;
  readonly memberUserIds: readonly number[];
}

function asRecord(val: unknown): Record<string, unknown> | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
  return val as Record<string, unknown>;
}

function readOptionalString(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractFirstMultiValued(val: unknown): string | undefined {
  if (!Array.isArray(val)) return undefined;
  const entries = val
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const primary = entries.find((item) => item['primary'] === true) ?? entries[0];
  return readOptionalString(primary?.['value']);
}

export function buildScimUserResource(params: {
  readonly link: ScimUserLinkEntity;
  readonly user: ProvisionedUserView;
  readonly groups: readonly ScimGroupEntity[];
  readonly baseUrl: string;
}): ScimUserResource {
  const { link, user, groups, baseUrl } = params;
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const version = formatScimEtag(link.scimVersion);
  const isLocalActive = user.status === USER_STATUS.ACTIVE;
  const effectiveActive = Boolean(link.active && isLocalActive);

  const groupRefs: ScimUserGroupRef[] = groups.map((grp) => ({
    value: String(grp.id),
    display: grp.displayName,
    $ref: `${cleanBase}/Groups/${grp.id}`,
  }));

  return {
    schemas: [SCIM_SCHEMAS.USER],
    id: String(user.id),
    externalId: link.externalId,
    userName: user.username,
    name: {
      formatted: user.fullName,
      givenName: user.firstName,
      familyName: user.lastName,
    },
    displayName: user.fullName,
    active: effectiveActive,
    emails: user.email ? [{ value: user.email, type: 'work', primary: true }] : [],
    ...(user.phone ? { phoneNumbers: [{ value: user.phone, type: 'work', primary: true }] } : {}),
    groups: groupRefs,
    meta: {
      resourceType: 'User',
      created: link.createdAt ? new Date(link.createdAt).toISOString() : user.createdAt,
      lastModified: link.lastSyncedAt ? new Date(link.lastSyncedAt).toISOString() : user.updatedAt,
      location: `${cleanBase}/Users/${user.id}`,
      version,
    },
  };
}

export function buildScimGroupResource(params: {
  readonly group: ScimGroupEntity;
  readonly members: ReadonlyArray<{
    readonly userId: number;
    readonly display?: string | undefined;
  }>;
  readonly baseUrl: string;
}): ScimGroupResource {
  const { group, members, baseUrl } = params;
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const version = formatScimEtag(group.scimVersion);

  const memberRefs: ScimGroupMemberRef[] = members.map((member) => ({
    value: String(member.userId),
    ...(member.display ? { display: member.display } : {}),
    type: 'User',
    $ref: `${cleanBase}/Users/${member.userId}`,
  }));

  return {
    schemas: [SCIM_SCHEMAS.GROUP],
    id: String(group.id),
    ...(group.externalId ? { externalId: group.externalId } : {}),
    displayName: group.displayName,
    members: memberRefs,
    meta: {
      resourceType: 'Group',
      created: group.createdAt ? new Date(group.createdAt).toISOString() : undefined,
      lastModified: group.lastSyncedAt ? new Date(group.lastSyncedAt).toISOString() : undefined,
      location: `${cleanBase}/Groups/${group.id}`,
      version,
    },
  };
}

export function buildScimListResponse<T>(
  resources: readonly T[],
  totalResults: number,
  startIndex: number,
  itemsPerPage: number,
): ScimListResponse<T> {
  return {
    schemas: [SCIM_SCHEMAS.LIST_RESPONSE],
    totalResults,
    startIndex,
    itemsPerPage,
    Resources: resources,
  };
}

export function extractScimUserWriteFields(rawBody: unknown): NormalizedScimUserInput {
  const body = asRecord(rawBody);
  if (!body) {
    throw new ScimProtocolException(
      400,
      'SCIM User payload must be a JSON object',
      'invalidSyntax',
    );
  }

  const nameObj = asRecord(body['name']);
  const userName = readOptionalString(body['userName']);
  const externalId = readOptionalString(body['externalId']);
  const primaryEmail = extractFirstMultiValued(body['emails']);
  const fallbackEmail = primaryEmail ?? (userName && userName.includes('@') ? userName : undefined);
  const phone =
    body['phoneNumbers'] !== undefined
      ? (extractFirstMultiValued(body['phoneNumbers']) ?? null)
      : undefined;

  const givenName = readOptionalString(nameObj?.['givenName']);
  const familyName = readOptionalString(nameObj?.['familyName']);
  const formattedName =
    readOptionalString(body['displayName']) ?? readOptionalString(nameObj?.['formatted']);
  const active = typeof body['active'] === 'boolean' ? body['active'] : undefined;

  return {
    ...(externalId !== undefined ? { externalId } : {}),
    ...(userName !== undefined ? { userName } : {}),
    ...(fallbackEmail !== undefined ? { email: fallbackEmail.toLowerCase() } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(givenName !== undefined ? { firstName: givenName } : {}),
    ...(familyName !== undefined ? { lastName: familyName } : {}),
    ...(formattedName !== undefined ? { fullName: formattedName } : {}),
    ...(active !== undefined ? { active } : {}),
  };
}

export function applyScimUserPatchOperations(
  current: {
    readonly externalId: string;
    readonly userName: string;
    readonly email: string;
    readonly phone: string | null;
    readonly firstName: string;
    readonly lastName: string;
    readonly fullName: string;
    readonly active: boolean;
  },
  operations: readonly ScimPatchOperation[],
): NormalizedScimUserInput {
  const next: {
    externalId: string;
    userName: string;
    email: string;
    phone: string | null;
    firstName: string;
    lastName: string;
    fullName: string;
    active: boolean;
  } = { ...current };

  for (const opItem of operations) {
    const op = opItem.op.toLowerCase();
    const path = (opItem.path ?? '').trim().toLowerCase();
    const val = opItem.value;

    if (!path) {
      const valObj = asRecord(val);
      if (valObj) {
        const extracted = extractScimUserWriteFields(valObj);
        if (extracted.externalId !== undefined) next.externalId = extracted.externalId;
        if (extracted.userName !== undefined) next.userName = extracted.userName;
        if (extracted.email !== undefined) next.email = extracted.email;
        if (extracted.phone !== undefined) next.phone = extracted.phone;
        if (extracted.firstName !== undefined) next.firstName = extracted.firstName;
        if (extracted.lastName !== undefined) next.lastName = extracted.lastName;
        if (extracted.fullName !== undefined) next.fullName = extracted.fullName;
        if (extracted.active !== undefined) next.active = extracted.active;
      }
      continue;
    }

    if (path === 'active') {
      if (op === 'remove') {
        next.active = false;
      } else if (typeof val === 'boolean') {
        next.active = val;
      } else if (typeof val === 'string') {
        next.active = val.trim().toLowerCase() === 'true';
      }
    } else if (path === 'externalid' && op !== 'remove') {
      const s = readOptionalString(val);
      if (s) next.externalId = s;
    } else if (path === 'username' && op !== 'remove') {
      const s = readOptionalString(val);
      if (s) next.userName = s;
    } else if (path === 'displayname' || path === 'name.formatted') {
      if (op === 'remove') {
        next.fullName = `${next.firstName} ${next.lastName}`.trim();
      } else {
        const s = readOptionalString(val);
        if (s) next.fullName = s;
      }
    } else if (path === 'name.givenname') {
      const s = readOptionalString(val);
      if (s && op !== 'remove') {
        next.firstName = s;
        next.fullName = `${next.firstName} ${next.lastName}`.trim();
      }
    } else if (path === 'name.familyname') {
      const s = readOptionalString(val);
      if (s && op !== 'remove') {
        next.lastName = s;
        next.fullName = `${next.firstName} ${next.lastName}`.trim();
      }
    } else if (path === 'name') {
      const nameRec = asRecord(val);
      if (nameRec && op !== 'remove') {
        const g = readOptionalString(nameRec['givenName']);
        const f = readOptionalString(nameRec['familyName']);
        const fm = readOptionalString(nameRec['formatted']);
        if (g) next.firstName = g;
        if (f) next.lastName = f;
        next.fullName = fm ?? `${next.firstName} ${next.lastName}`.trim();
      }
    } else if (path === 'emails' || path.startsWith('emails[')) {
      if (op !== 'remove') {
        const emailVal = Array.isArray(val)
          ? extractFirstMultiValued(val)
          : readOptionalString(asRecord(val)?.['value'] ?? val);
        if (emailVal) next.email = emailVal.toLowerCase();
      }
    } else if (path === 'phonenumbers' || path.startsWith('phonenumbers[')) {
      if (op === 'remove') {
        next.phone = null;
      } else {
        const phoneVal = Array.isArray(val)
          ? extractFirstMultiValued(val)
          : readOptionalString(asRecord(val)?.['value'] ?? val);
        next.phone = phoneVal ?? null;
      }
    }
  }

  return next;
}

function parseMemberUserIds(rawMembers: unknown): number[] {
  if (!Array.isArray(rawMembers)) return [];
  const ids: number[] = [];
  for (const item of rawMembers) {
    const rec = asRecord(item);
    const rawId = rec?.['value'] ?? item;
    const parsed = Number(rawId);
    if (Number.isInteger(parsed) && parsed > 0) {
      ids.push(parsed);
    }
  }
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

export function extractScimGroupWriteFields(rawBody: unknown): NormalizedScimGroupInput {
  const body = asRecord(rawBody);
  if (!body) {
    throw new ScimProtocolException(
      400,
      'SCIM Group payload must be a JSON object',
      'invalidSyntax',
    );
  }
  const externalId = readOptionalString(body['externalId']);
  const displayName = readOptionalString(body['displayName']);
  const memberUserIds = parseMemberUserIds(body['members']);
  return {
    ...(externalId !== undefined ? { externalId } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
    memberUserIds,
  };
}

export function applyScimGroupPatchOperations(
  current: {
    readonly externalId: string | null;
    readonly displayName: string;
    readonly memberUserIds: readonly number[];
  },
  operations: readonly ScimPatchOperation[],
): {
  readonly externalId: string | null;
  readonly displayName: string;
  readonly memberUserIds: number[];
} {
  let externalId = current.externalId;
  let displayName = current.displayName;
  const memberSet = new Set<number>(current.memberUserIds);

  for (const opItem of operations) {
    const op = opItem.op.toLowerCase();
    const rawPath = (opItem.path ?? '').trim();
    const pathLower = rawPath.toLowerCase();

    if (!pathLower) {
      const valRec = asRecord(opItem.value);
      if (valRec) {
        const nextDisplay = readOptionalString(valRec['displayName']);
        const nextExt = readOptionalString(valRec['externalId']);
        if (nextDisplay && op !== 'remove') displayName = nextDisplay;
        if (nextExt && op !== 'remove') externalId = nextExt;
        if (valRec['members'] !== undefined) {
          const ids = parseMemberUserIds(valRec['members']);
          if (op === 'replace') {
            memberSet.clear();
            ids.forEach((id) => memberSet.add(id));
          } else if (op === 'add') {
            ids.forEach((id) => memberSet.add(id));
          } else if (op === 'remove') {
            ids.forEach((id) => memberSet.delete(id));
          }
        }
      }
      continue;
    }

    if (pathLower === 'displayname' && op !== 'remove') {
      const s = readOptionalString(opItem.value);
      if (s) displayName = s;
      continue;
    }

    if (pathLower === 'externalid') {
      externalId = op === 'remove' ? null : (readOptionalString(opItem.value) ?? externalId);
      continue;
    }

    // Hỗ trợ chuẩn RFC 7644: `members[value eq "123"]` (Okta / Microsoft Entra ID)
    const memberSelectorMatch = /^members\[\s*value\s+eq\s+"?(\d+)"?\s*\]$/i.exec(rawPath);
    if (memberSelectorMatch?.[1]) {
      const targetId = Number(memberSelectorMatch[1]);
      if (Number.isInteger(targetId) && targetId > 0) {
        if (op === 'remove') {
          memberSet.delete(targetId);
        } else if (op === 'add' || op === 'replace') {
          memberSet.add(targetId);
        }
      }
      continue;
    }

    if (pathLower === 'members') {
      const ids = parseMemberUserIds(opItem.value);
      if (op === 'remove') {
        if (opItem.value === undefined) {
          memberSet.clear();
        } else {
          ids.forEach((id) => memberSet.delete(id));
        }
      } else if (op === 'replace') {
        memberSet.clear();
        ids.forEach((id) => memberSet.add(id));
      } else if (op === 'add') {
        ids.forEach((id) => memberSet.add(id));
      }
    }
  }

  return {
    externalId,
    displayName,
    memberUserIds: Array.from(memberSet).sort((a, b) => a - b),
  };
}

export function buildScimServiceProviderConfig(baseUrl: string): Record<string, unknown> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return {
    schemas: [SCIM_SCHEMAS.SERVICE_PROVIDER_CONFIG],
    documentationUri: `${cleanBase}/ServiceProviderConfig`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 500 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: true },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'SCIM Client static Bearer Token with optional IP Allowlist',
        primary: true,
      },
    ],
    meta: {
      location: `${cleanBase}/ServiceProviderConfig`,
      resourceType: 'ServiceProviderConfig',
    },
  };
}

export function buildScimResourceTypes(baseUrl: string): Record<string, unknown> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return {
    schemas: [SCIM_SCHEMAS.LIST_RESPONSE],
    totalResults: 2,
    startIndex: 1,
    itemsPerPage: 2,
    Resources: [
      {
        schemas: [SCIM_SCHEMAS.RESOURCE_TYPE],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        schema: SCIM_SCHEMAS.USER,
        meta: {
          location: `${cleanBase}/ResourceTypes/User`,
          resourceType: 'ResourceType',
        },
      },
      {
        schemas: [SCIM_SCHEMAS.RESOURCE_TYPE],
        id: 'Group',
        name: 'Group',
        endpoint: '/Groups',
        schema: SCIM_SCHEMAS.GROUP,
        meta: {
          location: `${cleanBase}/ResourceTypes/Group`,
          resourceType: 'ResourceType',
        },
      },
    ],
  };
}

export function buildScimSchemas(baseUrl: string): Record<string, unknown> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return {
    schemas: [SCIM_SCHEMAS.LIST_RESPONSE],
    totalResults: 2,
    startIndex: 1,
    itemsPerPage: 2,
    Resources: [
      {
        id: SCIM_SCHEMAS.USER,
        name: 'User',
        description: 'Core SCIM 2.0 User Account',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true },
          { name: 'externalId', type: 'string', multiValued: false, required: false },
          { name: 'displayName', type: 'string', multiValued: false, required: false },
          { name: 'active', type: 'boolean', multiValued: false, required: false },
          { name: 'emails', type: 'complex', multiValued: true, required: false },
          { name: 'phoneNumbers', type: 'complex', multiValued: true, required: false },
          { name: 'groups', type: 'complex', multiValued: true, required: false },
        ],
        meta: {
          location: `${cleanBase}/Schemas/${SCIM_SCHEMAS.USER}`,
          resourceType: 'Schema',
        },
      },
      {
        id: SCIM_SCHEMAS.GROUP,
        name: 'Group',
        description: 'Core SCIM 2.0 Group',
        attributes: [
          { name: 'displayName', type: 'string', multiValued: false, required: true },
          { name: 'externalId', type: 'string', multiValued: false, required: false },
          { name: 'members', type: 'complex', multiValued: true, required: false },
        ],
        meta: {
          location: `${cleanBase}/Schemas/${SCIM_SCHEMAS.GROUP}`,
          resourceType: 'Schema',
        },
      },
    ],
  };
}
