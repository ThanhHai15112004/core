import type {
  RegisteredSearchableEntity,
  SearchActorScopeContext,
  SearchDocumentInput,
  SearchDocumentRecord,
} from '../contracts/search.contract.js';

export const DEFAULT_SEARCH_STALE_THRESHOLD_MS = 300_000;

/**
 * Chuẩn hóa chuỗi tìm kiếm: chuyển về chữ thường, loại bỏ dấu tiếng Việt (NFD + đ/Đ) và gom khoảng trắng.
 */
export function normalizeSearchText(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') {
    return '';
  }

  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tách từ khóa tìm kiếm thành danh sách các token đã chuẩn hóa.
 */
export function tokenizeSearchKeyword(keyword: string | null | undefined): string[] {
  const normalized = normalizeSearchText(keyword);
  if (!normalized) {
    return [];
  }

  return Array.from(
    new Set(
      normalized
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length > 0),
    ),
  );
}

/**
 * Chuẩn hóa `SearchDocumentInput` thành `SearchDocumentRecord` lưu trong Search Index.
 */
export function buildSearchDocumentRecord(
  input: SearchDocumentInput,
  entityDef?: RegisteredSearchableEntity,
): SearchDocumentRecord {
  const entityCode = input.entityCode.trim();
  const id = input.id;
  const moduleName = (input.module ?? entityDef?.module ?? 'core').trim().toLowerCase();
  const entityType = (input.entityType ?? entityDef?.entityType ?? entityCode).trim().toLowerCase();
  const title = String(input.title ?? '').trim();
  const subtitle =
    input.subtitle !== undefined && input.subtitle !== null && String(input.subtitle).trim() !== ''
      ? String(input.subtitle).trim()
      : null;

  const keywords = Array.isArray(input.keywords)
    ? input.keywords.map((kw) => String(kw).trim()).filter((kw) => kw.length > 0)
    : [];

  const searchableTextParts = [title, subtitle ?? '', ...keywords, input.searchableText ?? '']
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const nowIso = new Date().toISOString();
  const sourceUpdatedAt =
    input.sourceUpdatedAt instanceof Date
      ? input.sourceUpdatedAt.toISOString()
      : typeof input.sourceUpdatedAt === 'string' && input.sourceUpdatedAt.trim().length > 0
        ? new Date(input.sourceUpdatedAt).toISOString()
        : nowIso;

  const indexedAt =
    input.indexedAt instanceof Date
      ? input.indexedAt.toISOString()
      : typeof input.indexedAt === 'string' && input.indexedAt.trim().length > 0
        ? new Date(input.indexedAt).toISOString()
        : nowIso;

  return {
    documentKey: `${entityCode}:${String(id)}`,
    id,
    entityCode,
    module: moduleName,
    entityType,
    title,
    subtitle,
    keywords,
    searchableText: searchableTextParts.join(' | '),
    ownerId:
      typeof input.ownerId === 'number' && Number.isFinite(input.ownerId) ? input.ownerId : null,
    organizationUnitId:
      typeof input.organizationUnitId === 'number' && Number.isFinite(input.organizationUnitId)
        ? input.organizationUnitId
        : null,
    status: input.status !== undefined && input.status !== null ? input.status : null,
    metadata: input.metadata ? { ...input.metadata } : {},
    sourceUpdatedAt,
    indexedAt,
  };
}

/**
 * 8.5.2 — Chấm điểm độ khớp (`score`) và trích xuất các trường khớp (`matchedHighlights`) cho Database Search.
 */
export function computeDocumentMatchScore(
  doc: SearchDocumentRecord,
  keyword: string,
): {
  readonly matched: boolean;
  readonly score: number;
  readonly matchedHighlights: readonly string[];
} {
  const normalizedKeyword = normalizeSearchText(keyword);
  const tokens = tokenizeSearchKeyword(keyword);
  if (!normalizedKeyword || tokens.length === 0) {
    return {
      matched: true,
      score: 1,
      matchedHighlights: [doc.title],
    };
  }

  const normalizedTitle = normalizeSearchText(doc.title);
  const normalizedSubtitle = normalizeSearchText(doc.subtitle);
  const normalizedKeywords = doc.keywords.map((kw) => normalizeSearchText(kw));
  const normalizedBody = normalizeSearchText(doc.searchableText);

  let score = 0;
  const highlights = new Set<string>();

  if (normalizedTitle === normalizedKeyword) {
    score += 100;
    highlights.add(doc.title);
  } else if (normalizedTitle.includes(normalizedKeyword)) {
    score += 60;
    highlights.add(doc.title);
  }

  if (normalizedSubtitle && normalizedSubtitle.includes(normalizedKeyword)) {
    score += 40;
    if (doc.subtitle) {
      highlights.add(doc.subtitle);
    }
  }

  for (let idx = 0; idx < normalizedKeywords.length; idx += 1) {
    const kw = normalizedKeywords[idx];
    const rawKw = doc.keywords[idx];
    if (!kw || !rawKw) continue;
    if (kw === normalizedKeyword) {
      score += 50;
      highlights.add(rawKw);
    } else if (kw.includes(normalizedKeyword)) {
      score += 30;
      highlights.add(rawKw);
    }
  }

  let matchedTokenCount = 0;
  for (const token of tokens) {
    let tokenMatched = false;
    if (normalizedTitle.includes(token)) {
      score += 20;
      highlights.add(doc.title);
      tokenMatched = true;
    }
    if (normalizedSubtitle.includes(token)) {
      score += 12;
      if (doc.subtitle) {
        highlights.add(doc.subtitle);
      }
      tokenMatched = true;
    }
    for (let idx = 0; idx < normalizedKeywords.length; idx += 1) {
      const kw = normalizedKeywords[idx];
      const rawKw = doc.keywords[idx];
      if (kw && rawKw && kw.includes(token)) {
        score += 15;
        highlights.add(rawKw);
        tokenMatched = true;
      }
    }
    if (!tokenMatched && normalizedBody.includes(token)) {
      score += 8;
      highlights.add(doc.title);
      tokenMatched = true;
    }
    if (tokenMatched) {
      matchedTokenCount += 1;
    }
  }

  const matched = matchedTokenCount === tokens.length && score > 0;
  return {
    matched,
    score: matched ? score : 0,
    matchedHighlights: Array.from(highlights),
  };
}

/**
 * 8.5.6 — Kiểm tra quyền (`requiredPermission`) và phạm vi dữ liệu (`DataScope`: ALL, ORG_UNIT, SUBORDINATES, SELF)
 * trên từng bản ghi tìm kiếm, đảm bảo không trả dữ liệu trái quyền.
 */
export function canActorAccessSearchDocument(
  doc: SearchDocumentRecord,
  entityDef?: RegisteredSearchableEntity,
  scope?: SearchActorScopeContext,
): boolean {
  if (!scope || scope.bypassPermissionCheck === true) {
    return true;
  }

  const normalizedRoles = new Set((scope.roles ?? []).map((role) => role.trim().toLowerCase()));
  const isSuperAdmin =
    normalizedRoles.has('super_admin') ||
    normalizedRoles.has('superadmin') ||
    normalizedRoles.has('system_admin');

  if (!isSuperAdmin && entityDef?.requiredPermission) {
    const requiredPerm = entityDef.requiredPermission.trim().toLowerCase();
    const grantedPerms = new Set(
      (scope.permissions ?? []).map((perm) => perm.trim().toLowerCase()),
    );
    if (!grantedPerms.has('*') && !grantedPerms.has(requiredPerm)) {
      return false;
    }
  }

  const dataScopes =
    scope.dataScopes && scope.dataScopes.length > 0 ? scope.dataScopes : (['ALL'] as const);
  if (isSuperAdmin || dataScopes.includes('ALL')) {
    return true;
  }

  const actorId =
    typeof scope.actorId === 'number' && Number.isFinite(scope.actorId) ? scope.actorId : null;
  const allowedOrgIds = new Set<number>();
  if (typeof scope.organizationUnitId === 'number' && Number.isFinite(scope.organizationUnitId)) {
    allowedOrgIds.add(scope.organizationUnitId);
  }
  for (const orgId of scope.allowedOrganizationUnitIds ?? []) {
    if (typeof orgId === 'number' && Number.isFinite(orgId)) {
      allowedOrgIds.add(orgId);
    }
  }

  const subordinateUserIds = new Set<number>(
    (scope.subordinateUserIds ?? []).filter(
      (userId): userId is number => typeof userId === 'number' && Number.isFinite(userId),
    ),
  );

  for (const dataScope of dataScopes) {
    if (dataScope === 'SELF') {
      if (actorId !== null && (doc.ownerId === actorId || Number(doc.id) === actorId)) {
        return true;
      }
    } else if (dataScope === 'ORG_UNIT') {
      if (doc.organizationUnitId !== null && allowedOrgIds.has(doc.organizationUnitId)) {
        return true;
      }
      if (actorId !== null && doc.ownerId === actorId) {
        return true;
      }
    } else if (dataScope === 'SUBORDINATES') {
      if (doc.organizationUnitId !== null && allowedOrgIds.has(doc.organizationUnitId)) {
        return true;
      }
      if (
        (doc.ownerId !== null && subordinateUserIds.has(doc.ownerId)) ||
        subordinateUserIds.has(Number(doc.id))
      ) {
        return true;
      }
      if (actorId !== null && (doc.ownerId === actorId || Number(doc.id) === actorId)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 8.5.7 — Tính toán độ trễ cập nhật Index (`lagMs`) giữa thời điểm dữ liệu gốc thay đổi (`sourceUpdatedAt`)
 * và thời điểm được đánh chỉ mục (`indexedAt`), phát hiện kết quả tìm kiếm bị cũ (`isStale`).
 */
export function calculateDocumentIndexLag(
  sourceUpdatedAt: string | Date,
  indexedAt: string | Date,
  staleThresholdMs: number = DEFAULT_SEARCH_STALE_THRESHOLD_MS,
): {
  readonly lagMs: number;
  readonly staleThresholdMs: number;
  readonly isStale: boolean;
} {
  const sourceTime = new Date(sourceUpdatedAt).getTime();
  const indexedTime = new Date(indexedAt).getTime();
  const effectiveThreshold =
    Number.isFinite(staleThresholdMs) && staleThresholdMs >= 0
      ? Math.trunc(staleThresholdMs)
      : DEFAULT_SEARCH_STALE_THRESHOLD_MS;

  if (!Number.isFinite(sourceTime) || !Number.isFinite(indexedTime)) {
    return {
      lagMs: 0,
      staleThresholdMs: effectiveThreshold,
      isStale: false,
    };
  }

  const lagMs = Math.max(0, sourceTime - indexedTime);
  return {
    lagMs,
    staleThresholdMs: effectiveThreshold,
    isStale: lagMs > effectiveThreshold,
  };
}
