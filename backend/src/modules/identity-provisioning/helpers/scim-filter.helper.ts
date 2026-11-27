import type { ScimGroupResource, ScimUserResource } from '../types/identity-provisioning.types.js';
import { ScimProtocolException } from './scim-error.helper.js';

export type ScimFilterOperator = 'eq' | 'co' | 'sw' | 'pr';

export interface ScimFilterClause {
  readonly attribute: string;
  readonly operator: ScimFilterOperator;
  readonly value?: string | undefined;
}

const CLAUSE_REGEX =
  /^([a-zA-Z0-9_.="-]+(?:\[[^\]]+\][a-zA-Z0-9_.-]*)?)\s+(eq|co|sw|pr)(?:\s+(?:"((?:[^"\\]|\\.)*)"|(true|false|\d+(?:\.\d+)?)))?$/i;

function normalizeScimAttributePath(rawAttr: string): string {
  const cleaned = rawAttr.trim().toLowerCase();
  if (cleaned.startsWith('emails[') && cleaned.endsWith('.value')) {
    return 'emails.value';
  }
  if (cleaned.startsWith('phonenumbers[') && cleaned.endsWith('.value')) {
    return 'phonenumbers.value';
  }
  return cleaned;
}

/** Phân tích biểu thức `filter` chuẩn SCIM 2.0 (hỗ trợ `eq`, `co`, `sw`, `pr` và toán tử `and`) */
export function parseScimFilter(filter?: string | null): ScimFilterClause[] {
  if (!filter || !filter.trim()) return [];

  const parts = filter
    .trim()
    .split(/\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  const clauses: ScimFilterClause[] = [];
  for (const part of parts) {
    const unwrapped = part.startsWith('(') && part.endsWith(')') ? part.slice(1, -1).trim() : part;
    const match = CLAUSE_REGEX.exec(unwrapped);
    if (!match) {
      throw new ScimProtocolException(
        400,
        `Invalid or unsupported SCIM filter expression: "${part}"`,
        'invalidFilter',
      );
    }
    const rawAttr = match[1];
    const rawOp = match[2]?.toLowerCase() as ScimFilterOperator | undefined;
    const quotedVal = match[3];
    const primitiveVal = match[4];

    if (!rawAttr || !rawOp) {
      throw new ScimProtocolException(
        400,
        `Invalid SCIM filter clause: "${part}"`,
        'invalidFilter',
      );
    }

    if (rawOp !== 'pr' && quotedVal === undefined && primitiveVal === undefined) {
      throw new ScimProtocolException(
        400,
        `SCIM filter operator "${rawOp}" requires a comparison value`,
        'invalidFilter',
      );
    }

    const unescapedVal =
      quotedVal !== undefined
        ? quotedVal.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        : primitiveVal;

    clauses.push({
      attribute: normalizeScimAttributePath(rawAttr),
      operator: rawOp,
      ...(unescapedVal !== undefined ? { value: unescapedVal } : {}),
    });
  }

  return clauses;
}

function matchScalarValues(
  candidates: readonly (string | boolean | undefined)[],
  clause: ScimFilterClause,
): boolean {
  const nonEmpty = candidates.filter((c): c is string | boolean => c !== undefined && c !== '');
  if (clause.operator === 'pr') {
    return nonEmpty.length > 0;
  }

  const target = (clause.value ?? '').toLowerCase();
  return nonEmpty.some((cand) => {
    const str = String(cand).toLowerCase();
    switch (clause.operator) {
      case 'eq':
        return str === target;
      case 'co':
        return str.includes(target);
      case 'sw':
        return str.startsWith(target);
      default:
        return false;
    }
  });
}

export function matchesScimUserFilter(
  user: ScimUserResource,
  clauses: readonly ScimFilterClause[],
): boolean {
  for (const clause of clauses) {
    let candidates: (string | boolean | undefined)[] = [];
    switch (clause.attribute) {
      case 'id':
        candidates = [user.id];
        break;
      case 'username':
        candidates = [user.userName];
        break;
      case 'externalid':
        candidates = [user.externalId];
        break;
      case 'displayname':
        candidates = [user.displayName];
        break;
      case 'name.formatted':
        candidates = [user.name?.formatted];
        break;
      case 'name.givenname':
        candidates = [user.name?.givenName];
        break;
      case 'name.familyname':
        candidates = [user.name?.familyName];
        break;
      case 'active':
        candidates = [user.active];
        break;
      case 'emails.value':
      case 'emails':
        candidates = (user.emails ?? []).map((e) => e.value);
        break;
      case 'phonenumbers.value':
      case 'phonenumbers':
        candidates = (user.phoneNumbers ?? []).map((p) => p.value);
        break;
      default:
        candidates = [];
        break;
    }
    if (!matchScalarValues(candidates, clause)) {
      return false;
    }
  }
  return true;
}

export function matchesScimGroupFilter(
  group: ScimGroupResource,
  clauses: readonly ScimFilterClause[],
): boolean {
  for (const clause of clauses) {
    let candidates: (string | boolean | undefined)[] = [];
    switch (clause.attribute) {
      case 'id':
        candidates = [group.id];
        break;
      case 'externalid':
        candidates = [group.externalId];
        break;
      case 'displayname':
        candidates = [group.displayName];
        break;
      default:
        candidates = [];
        break;
    }
    if (!matchScalarValues(candidates, clause)) {
      return false;
    }
  }
  return true;
}
