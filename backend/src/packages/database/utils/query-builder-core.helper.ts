import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import {
  type AdvancedSearchParsed,
  type DateRangeInput,
  type FilterCondition,
  QUERY_COMPLEXITY_DEFAULTS,
  type ResolveDateRangeOptions,
  SEARCH_DEFAULTS,
  type SearchMode,
  SELECT_DEFAULTS,
  SORT_DEFAULTS,
  SORT_ORDERS,
  type SortCriterion,
  type SortOrder,
  ValidationAppException,
  assertQueryComplexity,
  resolveDateRange,
} from '@packages/kernel/index.js';

/**
 * Escape các ký tự đại diện (`%`, `_`, `\`) trong từ khóa trước khi đưa vào mệnh đề SQL `LIKE`.
 */
export function escapeSqlLikePattern(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Chuyển đổi từ khóa sang mẫu `LIKE` an toàn theo chế độ (`contains`, `startsWith`, `endsWith`).
 */
export function buildSafeLikePattern(
  keyword: string,
  mode: SearchMode = SEARCH_DEFAULTS.DEFAULT_MODE,
  casing: 'lower' | 'upper' | 'none' = 'none',
): string {
  const normalized =
    casing === 'lower'
      ? keyword.trim().toLowerCase()
      : casing === 'upper'
        ? keyword.trim().toUpperCase()
        : keyword.trim();
  const escaped = escapeSqlLikePattern(normalized);
  switch (mode) {
    case 'startsWith':
      return `${escaped}%`;
    case 'endsWith':
      return `%${escaped}`;
    case 'contains':
    default:
      return `%${escaped}%`;
  }
}

export interface KeywordSearchBuilderOptions {
  /** Chế độ khớp chuỗi (`'contains'` | `'startsWith'` | `'endsWith'`). Mặc định `'contains'`. */
  readonly mode?: SearchMode | undefined;
  /** Tiền tố tên tham số bind vào QueryBuilder (mặc định `'qk_kw'`). */
  readonly paramPrefix?: string | undefined;
  /** Độ dài tối đa của từ khóa tìm kiếm (mặc định `200`). */
  readonly maxLength?: number | undefined;
  /** Có sử dụng `COALESCE(col, '')` cho các cột có thể NULL hay không (mặc định `true`). */
  readonly coalesceNullable?: boolean | undefined;
  /** Dữ liệu tìm kiếm nâng cao đã phân tích (cụm từ chính xác, từ loại trừ) nếu có. */
  readonly advancedSearch?: AdvancedSearchParsed | undefined;
}

/**
 * Áp dụng tìm kiếm từ khóa an toàn (có escape `%`, `_`, `\`) lên danh sách các cột được cấu hình (Mục 8.1 — Tìm kiếm từ khóa).
 */
export function applyKeywordSearchToQueryBuilder<TEntity extends ObjectLiteral>(
  qb: SelectQueryBuilder<TEntity>,
  rawKeyword: string | undefined | null,
  searchableColumns: readonly string[],
  options?: KeywordSearchBuilderOptions,
): SelectQueryBuilder<TEntity> {
  if (searchableColumns.length === 0) {
    return qb;
  }

  const maxLength = options?.maxLength ?? SEARCH_DEFAULTS.MAX_LENGTH;
  const trimmed = typeof rawKeyword === 'string' ? rawKeyword.trim().replace(/\s+/g, ' ') : '';
  if (trimmed.length === 0) {
    return qb;
  }

  if (trimmed.length > maxLength) {
    throw new ValidationAppException([
      {
        field: 'search',
        code: 'search_too_long',
        message: `Search query must not exceed ${maxLength} characters`,
      },
    ]);
  }

  const prefix = options?.paramPrefix ?? 'qk_kw';
  const mode = options?.mode ?? 'contains';
  const useCoalesce = options?.coalesceNullable ?? true;

  const buildColumnLikes = (paramName: string): string => {
    const clauses = searchableColumns.map((col) => {
      const colExpr = useCoalesce ? `LOWER(COALESCE(${col}, ''))` : `LOWER(${col})`;
      return `${colExpr} LIKE :${paramName} ESCAPE '\\\\'`;
    });
    return `(${clauses.join(' OR ')})`;
  };

  const adv = options?.advancedSearch;
  if (adv && (adv.exactPhrases.length > 0 || adv.excludedTerms.length > 0)) {
    let idx = 0;
    for (const phrase of adv.exactPhrases) {
      const pName = `${prefix}_phrase_${idx++}`;
      qb.andWhere(buildColumnLikes(pName), {
        [pName]: buildSafeLikePattern(phrase.toLowerCase(), 'contains'),
      });
    }
    for (const token of adv.tokens) {
      const pName = `${prefix}_tok_${idx++}`;
      qb.andWhere(buildColumnLikes(pName), {
        [pName]: buildSafeLikePattern(token.toLowerCase(), mode),
      });
    }
    for (const excluded of adv.excludedTerms) {
      const pName = `${prefix}_excl_${idx++}`;
      const notClauses = searchableColumns.map((col) => {
        const colExpr = useCoalesce ? `LOWER(COALESCE(${col}, ''))` : `LOWER(${col})`;
        return `${colExpr} NOT LIKE :${pName} ESCAPE '\\\\'`;
      });
      qb.andWhere(`(${notClauses.join(' AND ')})`, {
        [pName]: buildSafeLikePattern(excluded.toLowerCase(), 'contains'),
      });
    }
    return qb;
  }

  const paramName = `${prefix}_main`;
  const likePattern = buildSafeLikePattern(trimmed.toLowerCase(), mode);
  qb.andWhere(buildColumnLikes(paramName), { [paramName]: likePattern });
  return qb;
}

export interface DateRangeBuilderOptions extends ResolveDateRangeOptions {
  readonly paramPrefix?: string | undefined;
}

/**
 * Áp dụng lọc theo khoảng ngày (`from`, `to`) lên cột thời gian được cấu hình (Mục 8.1 — Lọc theo khoảng ngày).
 * Tự động kiểm tra định dạng ngày và đảm bảo `from <= to`.
 */
export function applyDateRangeToQueryBuilder<TEntity extends ObjectLiteral>(
  qb: SelectQueryBuilder<TEntity>,
  column: string,
  range?: DateRangeInput | null,
  options?: DateRangeBuilderOptions,
): SelectQueryBuilder<TEntity> {
  if (!range || (range.from === undefined && range.to === undefined)) {
    return qb;
  }

  const resolved = resolveDateRange(range.from, range.to, {
    fromFieldName: options?.fromFieldName ?? range.fromFieldName,
    toFieldName: options?.toFieldName ?? range.toFieldName,
    maxSpanDays: options?.maxSpanDays ?? range.maxSpanDays,
  });
  const prefix = options?.paramPrefix ?? range.paramPrefix ?? column.replace(/[^a-zA-Z0-9_]/g, '_');

  if (resolved.from !== undefined) {
    const fromParam = `${prefix}_from`;
    qb.andWhere(`${column} >= :${fromParam}`, { [fromParam]: resolved.from });
  }

  if (resolved.to !== undefined) {
    const toParam = `${prefix}_to`;
    qb.andWhere(`${column} <= :${toParam}`, { [toParam]: resolved.to });
  }

  return qb;
}

/**
 * Áp dụng danh sách điều kiện lọc (`FilterCondition[]`) vào `SelectQueryBuilder`
 * chỉ với các trường nằm trong `allowedColumnMap` (Mục 8.1 — Lọc theo nhiều điều kiện, chỉ dùng field được cho phép).
 */
export function applyFilterConditionsToQueryBuilder<
  TEntity extends ObjectLiteral,
  TField extends string = string,
>(
  qb: SelectQueryBuilder<TEntity>,
  conditions: readonly FilterCondition<TField>[] | undefined | null,
  allowedColumnMap: Readonly<Record<string, string>>,
  options?: { paramPrefix?: string; maxConditions?: number; maxInValues?: number },
): SelectQueryBuilder<TEntity> {
  if (!conditions || conditions.length === 0) {
    return qb;
  }

  assertQueryComplexity(
    { filterConditions: conditions },
    {
      ...(options?.maxConditions !== undefined
        ? { maxFilterConditions: options.maxConditions }
        : {}),
      ...(options?.maxInValues !== undefined ? { maxInValues: options.maxInValues } : {}),
    },
  );

  const prefix = options?.paramPrefix ?? 'qk_flt';

  conditions.forEach((cond, idx) => {
    const column = allowedColumnMap[cond.field];
    if (!column) {
      throw new ValidationAppException([
        {
          field: cond.field,
          code: 'invalid_filter_field',
          message: `Field "${cond.field}" is not allowed for filtering`,
        },
      ]);
    }

    const pName = `${prefix}_${idx}`;
    switch (cond.operator) {
      case 'eq':
        qb.andWhere(`${column} = :${pName}`, { [pName]: cond.value });
        break;
      case 'ne':
        qb.andWhere(`${column} != :${pName}`, { [pName]: cond.value });
        break;
      case 'gt':
        qb.andWhere(`${column} > :${pName}`, { [pName]: cond.value });
        break;
      case 'gte':
        qb.andWhere(`${column} >= :${pName}`, { [pName]: cond.value });
        break;
      case 'lt':
        qb.andWhere(`${column} < :${pName}`, { [pName]: cond.value });
        break;
      case 'lte':
        qb.andWhere(`${column} <= :${pName}`, { [pName]: cond.value });
        break;
      case 'in': {
        const arr = Array.isArray(cond.value) ? cond.value : [cond.value];
        if (arr.length === 0) {
          qb.andWhere('1 = 0');
        } else {
          qb.andWhere(`${column} IN (:...${pName})`, { [pName]: arr });
        }
        break;
      }
      case 'nin': {
        const arr = Array.isArray(cond.value) ? cond.value : [cond.value];
        if (arr.length > 0) {
          qb.andWhere(`${column} NOT IN (:...${pName})`, { [pName]: arr });
        }
        break;
      }
      case 'contains':
        qb.andWhere(`LOWER(COALESCE(${column}, '')) LIKE :${pName} ESCAPE '\\\\'`, {
          [pName]: buildSafeLikePattern(String(cond.value).toLowerCase(), 'contains'),
        });
        break;
      case 'startsWith':
        qb.andWhere(`LOWER(COALESCE(${column}, '')) LIKE :${pName} ESCAPE '\\\\'`, {
          [pName]: buildSafeLikePattern(String(cond.value).toLowerCase(), 'startsWith'),
        });
        break;
      case 'endsWith':
        qb.andWhere(`LOWER(COALESCE(${column}, '')) LIKE :${pName} ESCAPE '\\\\'`, {
          [pName]: buildSafeLikePattern(String(cond.value).toLowerCase(), 'endsWith'),
        });
        break;
      case 'between': {
        const pair = Array.isArray(cond.value) ? cond.value : [];
        if (pair.length !== 2) {
          throw new ValidationAppException([
            {
              field: cond.field,
              code: 'invalid_between_filter',
              message: `Operator "between" on field "${cond.field}" requires exactly 2 values`,
            },
          ]);
        }
        qb.andWhere(`${column} BETWEEN :${pName}_low AND :${pName}_high`, {
          [`${pName}_low`]: pair[0],
          [`${pName}_high`]: pair[1],
        });
        break;
      }
      case 'isNull':
        if (cond.value === true || cond.value === 'true' || cond.value === '1') {
          qb.andWhere(`${column} IS NULL`);
        } else {
          qb.andWhere(`${column} IS NOT NULL`);
        }
        break;
    }
  });

  return qb;
}

export interface SortBuilderInput<TSortField extends string = string> {
  readonly sortBy?: TSortField | string | undefined;
  readonly sortOrder?: SortOrder | 'ASC' | 'DESC' | string | undefined;
  readonly sort?: string | undefined;
  readonly sortCriteria?: readonly SortCriterion<TSortField>[] | undefined;
}

export interface SortBuilderOptions<TSortField extends string = string> {
  readonly defaultSortBy: TSortField;
  readonly defaultSortOrder?: SortOrder | 'ASC' | 'DESC' | undefined;
  readonly tieBreakerField?: TSortField | undefined;
  readonly maxSortFields?: number | undefined;
}

/**
 * Chuẩn hóa và áp dụng sắp xếp tăng/giảm (`ASC` / `DESC`) vào `SelectQueryBuilder` (Mục 8.1 — Sắp xếp tăng hoặc giảm).
 * Kiểm tra nghiêm ngặt tên trường trước khi đưa vào câu lệnh `ORDER BY`, đồng thời tự động gắn `tieBreakerField` (mặc định `'id'`).
 */
export function applySortToQueryBuilder<
  TEntity extends ObjectLiteral,
  TSortField extends string = string,
>(
  qb: SelectQueryBuilder<TEntity>,
  input: SortBuilderInput<TSortField> | undefined | null,
  allowedSortColumnMap: Readonly<Record<TSortField, string>>,
  options: SortBuilderOptions<TSortField>,
): SelectQueryBuilder<TEntity> {
  const allowedKeys = Object.keys(allowedSortColumnMap);
  const maxSortFields = options.maxSortFields ?? SORT_DEFAULTS.MAX_FIELDS;
  const defaultDir: 'ASC' | 'DESC' =
    (options.defaultSortOrder ?? SORT_DEFAULTS.ORDER).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const normalizeDirection = (
    rawDir: string | undefined,
    fallback: 'ASC' | 'DESC',
  ): 'ASC' | 'DESC' => {
    if (!rawDir) return fallback;
    const lower = rawDir.trim().toLowerCase();
    if (!(SORT_ORDERS as readonly string[]).includes(lower)) {
      throw new ValidationAppException([
        {
          field: 'sortOrder',
          code: 'invalid_sort_order',
          message: `Invalid sort order "${rawDir}". Allowed: asc, desc`,
        },
      ]);
    }
    return lower === 'asc' ? 'ASC' : 'DESC';
  };

  const criteria: Array<{ field: TSortField; dir: 'ASC' | 'DESC' }> = [];
  const seenFields = new Set<string>();

  const pushCriterion = (rawField: string, dir: 'ASC' | 'DESC') => {
    const cleanField = rawField.trim();
    if (!(cleanField in allowedSortColumnMap)) {
      throw new ValidationAppException([
        {
          field: 'sortBy',
          code: 'invalid_sort_field',
          message: `Field "${cleanField}" is not sortable. Allowed: ${allowedKeys.join(', ')}`,
        },
      ]);
    }
    if (!seenFields.has(cleanField)) {
      seenFields.add(cleanField);
      criteria.push({ field: cleanField as TSortField, dir });
    }
  };

  if (input?.sortCriteria && input.sortCriteria.length > 0) {
    if (input.sortCriteria.length > maxSortFields) {
      throw new ValidationAppException([
        {
          field: 'sort',
          code: 'too_many_sort_fields',
          message: `Cannot sort by more than ${maxSortFields} fields`,
        },
      ]);
    }
    for (const item of input.sortCriteria) {
      pushCriterion(item.field, normalizeDirection(item.order, defaultDir));
    }
  } else if (input?.sort && input.sort.trim().length > 0) {
    const parts = input.sort
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length > maxSortFields) {
      throw new ValidationAppException([
        {
          field: 'sort',
          code: 'too_many_sort_fields',
          message: `Cannot sort by more than ${maxSortFields} fields`,
        },
      ]);
    }
    for (const part of parts) {
      if (part.startsWith('-')) {
        pushCriterion(part.slice(1), 'DESC');
      } else if (part.startsWith('+')) {
        pushCriterion(part.slice(1), 'ASC');
      } else if (part.includes(':')) {
        const [f, o] = part.split(':');
        pushCriterion(f ?? '', normalizeDirection(o, defaultDir));
      } else {
        pushCriterion(part, defaultDir);
      }
    }
  } else if (input?.sortBy !== undefined && String(input.sortBy).trim().length > 0) {
    pushCriterion(String(input.sortBy), normalizeDirection(input.sortOrder, defaultDir));
  } else {
    pushCriterion(options.defaultSortBy, normalizeDirection(input?.sortOrder, defaultDir));
  }

  const tieBreaker =
    options.tieBreakerField ??
    (('id' in allowedSortColumnMap ? ('id' as TSortField) : undefined) as TSortField | undefined);
  if (tieBreaker && !seenFields.has(tieBreaker) && tieBreaker in allowedSortColumnMap) {
    const primaryDir = criteria[0]?.dir ?? defaultDir;
    criteria.push({ field: tieBreaker, dir: primaryDir });
  }

  criteria.forEach((item, index) => {
    const col = allowedSortColumnMap[item.field]!;
    if (index === 0) {
      qb.orderBy(col, item.dir);
    } else {
      qb.addOrderBy(col, item.dir);
    }
  });

  return qb;
}

/**
 * Áp dụng chọn cột trả về (`SELECT`) vào `SelectQueryBuilder` dựa trên danh sách `fields` đã qua kiểm tra whitelist (Mục 8.1 — Chọn các trường cần trả về).
 */
export function applySelectFieldsToQueryBuilder<TEntity extends ObjectLiteral>(
  qb: SelectQueryBuilder<TEntity>,
  fields: readonly string[] | undefined | null,
  selectableColumnMap: Readonly<Record<string, string>>,
  alwaysIncludeFields: readonly string[] = [SELECT_DEFAULTS.PRIMARY_KEY],
): SelectQueryBuilder<TEntity> {
  if (!fields || fields.length === 0) {
    return qb;
  }

  if (fields.length > QUERY_COMPLEXITY_DEFAULTS.MAX_SELECT_FIELDS) {
    throw new ValidationAppException([
      {
        field: 'fields',
        code: 'too_many_select_fields',
        message: `Cannot select more than ${QUERY_COMPLEXITY_DEFAULTS.MAX_SELECT_FIELDS} fields`,
      },
    ]);
  }

  const selectedColumns = new Set<string>();
  for (const reqField of alwaysIncludeFields) {
    const col = selectableColumnMap[reqField];
    if (col) {
      selectedColumns.add(col);
    }
  }

  const allowedKeys = Object.keys(selectableColumnMap);
  for (const rawField of fields) {
    const clean = rawField.trim();
    if (!clean) continue;
    const col = selectableColumnMap[clean];
    if (!col) {
      throw new ValidationAppException([
        {
          field: 'fields',
          code: 'invalid_select_field',
          message: `Field "${clean}" is not selectable. Allowed: ${allowedKeys.join(', ')}`,
        },
      ]);
    }
    selectedColumns.add(col);
  }

  if (selectedColumns.size > 0) {
    qb.select([...selectedColumns]);
  }
  return qb;
}

/**
 * Giao diện bộ lọc phạm vi dữ liệu trừu tượng (tương thích trực tiếp với `ResolvedDataScopeFilter` của `@packages/security` và `FileScopeConstraint`).
 */
export interface DataScopeQueryFilterInput {
  readonly isUnrestricted?: boolean | undefined;
  readonly unrestricted?: boolean | undefined;
  readonly allowedUserIds?: readonly number[] | undefined;
  readonly allowedOrganizationUnitIds?: readonly number[] | undefined;
  readonly allowedOrgUnitIds?: readonly number[] | undefined;
  readonly selfUserId?: number | null | undefined;
  readonly explicitAllowedIds?: readonly number[] | undefined;
}

export interface DataScopeOrgMembershipSubqueryConfig {
  /** Tên bảng liên kết đơn vị (ví dụ: `'user_organization_units'`). */
  readonly table: string;
  /** Bí danh bảng trong câu subquery (ví dụ: `'uou_s'`). */
  readonly alias?: string | undefined;
  /** Cột khóa ngoại trỏ về bản ghi chính (ví dụ: `'user_id'`). */
  readonly foreignKeyColumn: string;
  /** Biểu thức cột khóa chính của bảng chính (ví dụ: `'u.id'`). */
  readonly entityPrimaryColumn: string;
  /** Cột đơn vị tổ chức trong bảng liên kết (mặc định `'organization_unit_id'`). */
  readonly orgUnitColumn?: string | undefined;
  /** Cột xóa mềm trong bảng liên kết (mặc định `'deleted_at'`, truyền `null` nếu bảng không có xóa mềm). */
  readonly softDeleteColumn?: string | null | undefined;
}

export interface ApplyDataScopeOptions {
  /** Biểu thức cột định danh người sở hữu / người tạo (ví dụ: `'u.id'` hoặc `'f.uploadedByUserId'`). */
  readonly userColumn?: string | undefined;
  /** Biểu thức cột đơn vị tổ chức trực tiếp trên bảng (ví dụ: `'u.primary_organization_unit_id'` hoặc `'f.organizationUnitId'`). */
  readonly orgUnitColumn?: string | undefined;
  /** Cấu hình subquery bảng trung gian đa đơn vị (như `user_organization_units`) nếu có. */
  readonly orgMembershipSubquery?: DataScopeOrgMembershipSubqueryConfig | undefined;
  /** Biểu thức cột khóa chính phục vụ lọc theo `explicitAllowedIds` (ví dụ: `'f.id'`). */
  readonly idColumn?: string | undefined;
  /** Điều kiện SQL bổ sung luôn được phép trong mệnh đề OR (ví dụ: `'f.visibility >= 2'`). */
  readonly alwaysAllowSqlClause?: string | undefined;
  /** Tiền tố tên tham số bind vào QueryBuilder (mặc định `'qk_scope'`). */
  readonly paramPrefix?: string | undefined;
}

/**
 * Áp dụng tập trung Phạm vi dữ liệu (`Data Scope` — `ALL`, `ORG_UNIT`, `SUBORDINATES`, `SELF`) trực tiếp vào `SelectQueryBuilder` ở Backend
 * (Mục 8.1 — Áp dụng quyền và Data Scope vào query, không để frontend tự lọc dữ liệu).
 */
export function applyDataScopeToQueryBuilder<TEntity extends ObjectLiteral>(
  qb: SelectQueryBuilder<TEntity>,
  scopeFilter: DataScopeQueryFilterInput | undefined | null,
  options: ApplyDataScopeOptions,
): SelectQueryBuilder<TEntity> {
  if (!scopeFilter) {
    return qb;
  }

  const isUnrestricted = Boolean(scopeFilter.isUnrestricted ?? scopeFilter.unrestricted);
  if (isUnrestricted) {
    return qb;
  }

  const prefix = options.paramPrefix ?? 'qk_scope';
  const subClauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (options.alwaysAllowSqlClause) {
    subClauses.push(options.alwaysAllowSqlClause);
  }

  const userIds = new Set<number>();
  if (Array.isArray(scopeFilter.allowedUserIds)) {
    for (const id of scopeFilter.allowedUserIds) {
      if (Number.isInteger(Number(id)) && Number(id) > 0) {
        userIds.add(Number(id));
      }
    }
  }
  if (
    scopeFilter.selfUserId !== undefined &&
    scopeFilter.selfUserId !== null &&
    Number.isInteger(Number(scopeFilter.selfUserId)) &&
    Number(scopeFilter.selfUserId) > 0
  ) {
    userIds.add(Number(scopeFilter.selfUserId));
  }

  if (options.userColumn && userIds.size > 0) {
    const userParam = `${prefix}_user_ids`;
    subClauses.push(`${options.userColumn} IN (:...${userParam})`);
    params[userParam] = [...userIds];
  }

  const orgIds = (
    scopeFilter.allowedOrganizationUnitIds ??
    scopeFilter.allowedOrgUnitIds ??
    []
  ).filter((id) => Number.isInteger(Number(id)) && Number(id) > 0);

  if (orgIds.length > 0) {
    const orgParam = `${prefix}_org_ids`;
    let usedOrgParam = false;

    if (options.orgUnitColumn) {
      subClauses.push(`${options.orgUnitColumn} IN (:...${orgParam})`);
      usedOrgParam = true;
    }

    if (options.orgMembershipSubquery) {
      const sub = options.orgMembershipSubquery;
      const subAlias = sub.alias ?? 'uou_s';
      const subOrgCol = sub.orgUnitColumn ?? 'organization_unit_id';
      const softDeleteClause =
        sub.softDeleteColumn === null
          ? ''
          : ` AND ${subAlias}.${sub.softDeleteColumn ?? 'deleted_at'} IS NULL`;
      subClauses.push(
        `EXISTS (SELECT 1 FROM ${sub.table} ${subAlias} WHERE ${subAlias}.${sub.foreignKeyColumn} = ${sub.entityPrimaryColumn} AND ${subAlias}.${subOrgCol} IN (:...${orgParam})${softDeleteClause})`,
      );
      usedOrgParam = true;
    }

    if (usedOrgParam) {
      params[orgParam] = [...orgIds];
    }
  }

  if (
    options.idColumn &&
    Array.isArray(scopeFilter.explicitAllowedIds) &&
    scopeFilter.explicitAllowedIds.length > 0
  ) {
    const explicitParam = `${prefix}_explicit_ids`;
    subClauses.push(`${options.idColumn} IN (:...${explicitParam})`);
    params[explicitParam] = [...scopeFilter.explicitAllowedIds];
  }

  if (subClauses.length === 0) {
    qb.andWhere('1 = 0');
  } else {
    qb.andWhere(`(${subClauses.join(' OR ')})`, params);
  }

  return qb;
}

export interface QueryCoreExecutionInput<
  TSortField extends string = string,
> extends SortBuilderInput<TSortField> {
  readonly search?: string | undefined;
  readonly q?: string | undefined;
  readonly advancedSearch?: AdvancedSearchParsed | undefined;
  readonly filterConditions?: readonly FilterCondition[] | undefined;
  readonly dateRange?: DateRangeInput | undefined;
  readonly fields?: readonly string[] | undefined;
  readonly scopeFilter?: DataScopeQueryFilterInput | undefined;
}

export interface QueryCoreExecutionConfig<TSortField extends string = string> {
  readonly searchableColumns?: readonly string[] | undefined;
  readonly searchOptions?: Omit<KeywordSearchBuilderOptions, 'advancedSearch'> | undefined;
  readonly allowedFilterColumnMap?: Readonly<Record<string, string>> | undefined;
  readonly dateRangeColumn?: string | undefined;
  readonly dateRangeOptions?: DateRangeBuilderOptions | undefined;
  readonly sortableColumnMap?: Readonly<Record<TSortField, string>> | undefined;
  readonly sortOptions?: SortBuilderOptions<TSortField> | undefined;
  readonly selectableColumnMap?: Readonly<Record<string, string>> | undefined;
  readonly alwaysIncludeSelectFields?: readonly string[] | undefined;
  readonly dataScopeOptions?: ApplyDataScopeOptions | undefined;
}

/**
 * Hàm điều phối 1 dòng áp dụng toàn diện Query Core (Mục 8.1) vào TypeORM `SelectQueryBuilder`:
 * 1. Tìm kiếm từ khóa an toàn (`searchableColumns` + escape `%`/`_`).
 * 2. Lọc khoảng ngày (`dateRangeColumn` + kiểm tra `from <= to`).
 * 3. Lọc đa điều kiện theo whitelist (`allowedFilterColumnMap`).
 * 4. Áp dụng Data Scope (`dataScopeOptions`).
 * 5. Chọn các trường cần trả về ở mức SQL (`selectableColumnMap`).
 * 6. Sắp xếp tăng/giảm có kiểm tra field và gắn tie-breaker (`sortableColumnMap`).
 */
export function applyQueryCoreToBuilder<
  TEntity extends ObjectLiteral,
  TSortField extends string = string,
>(
  qb: SelectQueryBuilder<TEntity>,
  input: QueryCoreExecutionInput<TSortField>,
  config: QueryCoreExecutionConfig<TSortField>,
): SelectQueryBuilder<TEntity> {
  const keyword = input.search ?? input.q;
  if (config.searchableColumns && config.searchableColumns.length > 0 && keyword) {
    applyKeywordSearchToQueryBuilder(qb, keyword, config.searchableColumns, {
      ...config.searchOptions,
      ...(input.advancedSearch ? { advancedSearch: input.advancedSearch } : {}),
    });
  }

  if (config.dateRangeColumn && input.dateRange) {
    applyDateRangeToQueryBuilder(
      qb,
      config.dateRangeColumn,
      input.dateRange,
      config.dateRangeOptions,
    );
  }

  if (
    config.allowedFilterColumnMap &&
    input.filterConditions &&
    input.filterConditions.length > 0
  ) {
    applyFilterConditionsToQueryBuilder(qb, input.filterConditions, config.allowedFilterColumnMap);
  }

  if (config.dataScopeOptions && input.scopeFilter) {
    applyDataScopeToQueryBuilder(qb, input.scopeFilter, config.dataScopeOptions);
  }

  if (config.selectableColumnMap && input.fields && input.fields.length > 0) {
    applySelectFieldsToQueryBuilder(
      qb,
      input.fields,
      config.selectableColumnMap,
      config.alwaysIncludeSelectFields,
    );
  }

  if (config.sortableColumnMap && config.sortOptions) {
    applySortToQueryBuilder(qb, input, config.sortableColumnMap, config.sortOptions);
  }

  return qb;
}
