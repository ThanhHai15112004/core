import { z } from 'zod';
import {
  type AdvancedSearchParsed,
  COUNT_MODES,
  type CountMode,
  CURSOR_DIRECTIONS,
  type CursorDirection,
  type CursorPaginationParams,
  FILTER_OPERATORS,
  type FilterCondition,
  type FilterOperator,
  type ListQueryResult,
  PAGINATION_DEFAULTS,
  type PaginationParams,
  QUERY_COMPLEXITY_DEFAULTS,
  type ResolvedDateRange,
  SEARCH_DEFAULTS,
  type SearchMode,
  SELECT_DEFAULTS,
  SORT_DEFAULTS,
  SORT_ORDERS,
  type SortCriterion,
  type SortOrder,
  type SortParams,
  VALIDATION_ISSUE_CODE,
  ValidationAppException,
  type ValidationSource,
  assertQueryComplexity,
  resolveDateRange,
} from '@packages/kernel/index.js';
import type { ApiErrorDetail } from '../contracts/api-response.contract.js';

const CONTROL_CHAR_MAX = 31;
const DEL_CHAR_CODE = 127;
const MAX_CURSOR_LENGTH = 2048;
const DEFAULT_MAX_CSV_ITEMS = 50;
const SORT_DESC_PREFIX = '-';
const SORT_ASC_PREFIX = '+';
const SORT_DELIMITER = ':';
const CSV_SEPARATOR = ',';

const ADVANCED_OP_PREFIXES: ReadonlyArray<readonly [string, FilterOperator]> = [
  ['>=', 'gte'],
  ['<=', 'lte'],
  ['!=', 'ne'],
  ['>', 'gt'],
  ['<', 'lt'],
];

/**
 * Kiểm tra chuỗi chỉ chứa các ký tự in được (không chứa ký tự điều khiển ASCII < 32 hoặc 127).
 */
export function isPrintableString(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= CONTROL_CHAR_MAX || code === DEL_CHAR_CODE) {
      return false;
    }
  }
  return true;
}

/**
 * Chuyển đổi danh sách lỗi `ZodIssue` sang mảng `ApiErrorDetail` chuẩn của hệ thống.
 * Hỗ trợ gắn `source` (`body` | `query` | `params`) và tách chi tiết từng trường không được phép (`unrecognized_keys`).
 */
export function formatZodIssues(
  issues: readonly z.ZodIssue[],
  source?: ValidationSource,
): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];

  for (const issue of issues) {
    const basePath = issue.path.map((segment) => String(segment)).join('.');
    const issueRecord = issue as unknown as Record<string, unknown>;
    const unrecognizedKeys = Array.isArray(issueRecord['keys'])
      ? (issueRecord['keys'] as unknown[]).map((k) => String(k))
      : [];

    if (issue.code === VALIDATION_ISSUE_CODE.UNRECOGNIZED_KEYS && unrecognizedKeys.length > 0) {
      for (const key of unrecognizedKeys) {
        const fullField = basePath.length > 0 ? `${basePath}.${key}` : key;
        details.push({
          field: fullField,
          message: `Unrecognized field "${fullField}" is not allowed`,
          code: VALIDATION_ISSUE_CODE.UNRECOGNIZED_KEYS,
          ...(source ? { source } : {}),
        });
      }
      continue;
    }

    details.push({
      ...(basePath.length > 0 ? { field: basePath } : {}),
      message: issue.message,
      code: issue.code,
      ...(source ? { source } : {}),
    });
  }

  return details;
}

/**
 * Xác thực dữ liệu đầu vào theo Zod schema; ném `ValidationAppException` (400) chuẩn hóa nếu thất bại.
 */
export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  input: unknown,
  source?: ValidationSource,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationAppException(formatZodIssues(result.error.issues, source));
  }
  return result.data;
}

/**
 * Bọc một Zod schema cho query parameter tùy chọn: tự động chuyển chuỗi rỗng `""` hoặc `null` thành `undefined`.
 */
export function optionalQueryParam<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) {
      return undefined;
    }
    if (typeof val === 'string' && val.trim() === '') {
      return undefined;
    }
    return val;
  }, schema.optional());
}

/**
 * Schema parse tham số boolean từ query string (`'true' | '1' | true -> true`, `'false' | '0' | false -> false`).
 */
export function booleanQueryParam() {
  return z.preprocess((val) => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') {
      if (val === 1) return true;
      if (val === 0) return false;
    }
    if (typeof val === 'string') {
      const normalized = val.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
    }
    return val;
  }, z.boolean());
}

/**
 * Schema parse danh sách phân cách bằng dấu phẩy (`?statuses=active,pending` -> `['active', 'pending']`).
 */
export function csvQueryParam<T extends z.ZodTypeAny = z.ZodString>(
  itemSchema?: T,
  maxItems: number = DEFAULT_MAX_CSV_ITEMS,
) {
  const elementSchema = (itemSchema ?? z.string().min(1)) as T;
  return z.preprocess((val) => {
    if (Array.isArray(val)) {
      return val.map((item) => (typeof item === 'string' ? item.trim() : item)).filter(Boolean);
    }
    if (typeof val === 'string') {
      return val
        .split(CSV_SEPARATOR)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    }
    return val;
  }, z.array(elementSchema).max(maxItems));
}

export interface DateRangeSchemaOptions {
  readonly fromKey?: string;
  readonly toKey?: string;
  readonly maxSpanDays?: number;
}

/**
 * Tạo Zod schema kiểm tra khoảng thời gian theo tên tham số cấu hình (ví dụ `from`/`to`, `fromDate`/`toDate`, `createdFrom`/`createdTo`)
 * và đảm bảo `from <= to`.
 */
export function createDateRangeQuerySchema(options?: DateRangeSchemaOptions) {
  const fromKey = options?.fromKey ?? 'from';
  const toKey = options?.toKey ?? 'to';

  return z
    .object({
      [fromKey]: optionalQueryParam(
        z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
          message: `Invalid ISO date string for "${fromKey}"`,
        }),
      ),
      [toKey]: optionalQueryParam(
        z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
          message: `Invalid ISO date string for "${toKey}"`,
        }),
      ),
    })
    .superRefine((data, ctx) => {
      const fromVal = data[fromKey];
      const toVal = data[toKey];
      if (fromVal !== undefined && toVal !== undefined) {
        const fromTs = Date.parse(fromVal);
        const toTs = Date.parse(toVal);
        if (fromTs > toTs) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [fromKey],
            message: `"${fromKey}" date must be earlier than or equal to "${toKey}" date`,
          });
        } else if (options?.maxSpanDays !== undefined && options.maxSpanDays > 0) {
          const maxSpanMs = options.maxSpanDays * 86_400_000;
          if (toTs - fromTs > maxSpanMs) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [toKey],
              message: `Date range between "${fromKey}" and "${toKey}" cannot exceed ${options.maxSpanDays} days`,
            });
          }
        }
      }
    })
    .transform((data) => {
      const fromStr = data[fromKey];
      const toStr = data[toKey];
      const resolved = resolveDateRange(fromStr, toStr, {
        fromFieldName: fromKey,
        toFieldName: toKey,
        ...(options?.maxSpanDays !== undefined ? { maxSpanDays: options.maxSpanDays } : {}),
      });
      return {
        ...data,
        ...resolved,
      };
    });
}

/**
 * Schema kiểm tra khoảng thời gian (`from`, `to` định dạng ISO 8601) và đảm bảo `from <= to`.
 */
export const dateRangeQuerySchema = createDateRangeQuerySchema({
  fromKey: 'from',
  toKey: 'to',
}) as z.ZodType<{ from?: string | undefined; to?: string | undefined }>;

/**
 * Tính toán giá trị `offset` từ `page` và `limit` (1-indexed).
 */
export function calculateOffset(
  page: number = PAGINATION_DEFAULTS.PAGE,
  limit: number = PAGINATION_DEFAULTS.LIMIT,
): number {
  const safePage = Math.max(PAGINATION_DEFAULTS.PAGE, Math.trunc(page));
  const safeLimit = Math.max(PAGINATION_DEFAULTS.MIN_LIMIT, Math.trunc(limit));
  return (safePage - 1) * safeLimit;
}

export interface PaginationSchemaOptions {
  readonly defaultPage?: number;
  readonly defaultLimit?: number;
  readonly minLimit?: number;
  readonly maxLimit?: number;
  /** Giới hạn offset tối đa để bảo vệ DB khỏi Deep Offset Scan (mặc định `10.000`). */
  readonly maxOffset?: number;
  readonly defaultCountMode?: CountMode;
}

/**
 * Tạo Zod schema phân trang theo trang (`page`, `limit`, `countMode`), tự động tính `offset` và chặn Deep Offset Scan.
 */
export function createPaginationQuerySchema(options?: PaginationSchemaOptions) {
  const defaultPage = options?.defaultPage ?? PAGINATION_DEFAULTS.PAGE;
  const defaultLimit = options?.defaultLimit ?? PAGINATION_DEFAULTS.LIMIT;
  const minLimit = options?.minLimit ?? PAGINATION_DEFAULTS.MIN_LIMIT;
  const maxLimit = options?.maxLimit ?? PAGINATION_DEFAULTS.MAX_LIMIT;
  const maxOffset = options?.maxOffset ?? PAGINATION_DEFAULTS.MAX_OFFSET;
  const defaultCountMode = options?.defaultCountMode ?? 'exact';

  return z
    .object({
      page: optionalQueryParam(z.coerce.number().int().min(PAGINATION_DEFAULTS.PAGE)).transform(
        (v) => v ?? defaultPage,
      ),
      limit: optionalQueryParam(z.coerce.number().int().min(minLimit).max(maxLimit)).transform(
        (v) => v ?? defaultLimit,
      ),
      countMode: optionalQueryParam(z.enum(COUNT_MODES)).transform((v) => v ?? defaultCountMode),
    })
    .superRefine((val, ctx) => {
      const offset = calculateOffset(val.page, val.limit);
      if (offset > maxOffset) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['page'],
          message: `Offset (${offset}) exceeds maximum allowed offset (${maxOffset}). Use cursor pagination for deep datasets.`,
        });
      }
    })
    .transform((val): PaginationParams => ({
      page: val.page,
      limit: val.limit,
      offset: calculateOffset(val.page, val.limit),
      countMode: val.countMode,
    }));
}

export interface CursorPaginationSchemaOptions {
  readonly defaultLimit?: number;
  readonly minLimit?: number;
  readonly maxLimit?: number;
}

/**
 * Tạo Zod schema phân trang theo con trỏ (`cursor`, `limit`, `direction`) cho các bảng dữ liệu lớn.
 */
export function createCursorPaginationQuerySchema(options?: CursorPaginationSchemaOptions) {
  const defaultLimit = options?.defaultLimit ?? PAGINATION_DEFAULTS.LIMIT;
  const minLimit = options?.minLimit ?? PAGINATION_DEFAULTS.MIN_LIMIT;
  const maxLimit = options?.maxLimit ?? PAGINATION_DEFAULTS.MAX_LIMIT;

  return z
    .object({
      cursor: optionalQueryParam(
        z.string().min(1).max(MAX_CURSOR_LENGTH).refine(isPrintableString, {
          message: 'Invalid characters in cursor',
        }),
      ),
      limit: optionalQueryParam(z.coerce.number().int().min(minLimit).max(maxLimit)).transform(
        (v) => v ?? defaultLimit,
      ),
      direction: optionalQueryParam(z.enum(CURSOR_DIRECTIONS)).transform(
        (v): CursorDirection => v ?? 'next',
      ),
    })
    .transform((val): CursorPaginationParams => ({
      cursor: val.cursor ?? null,
      limit: val.limit,
      direction: val.direction,
    }));
}

/**
 * Phân tích biểu thức sắp xếp đơn hoặc đa cột (ví dụ: `"-createdAt,id"` hoặc `"priority:asc,createdAt:desc"`),
 * đối chiếu nghiêm ngặt với danh sách cột cho phép (`allowedFields`).
 */
export function parseSortExpression<const TFields extends readonly [string, ...string[]]>(
  rawSort: string | undefined,
  allowedFields: TFields,
  defaultSortBy: TFields[number],
  defaultSortOrder: SortOrder = SORT_DEFAULTS.ORDER,
  maxFields: number = SORT_DEFAULTS.MAX_FIELDS,
): SortParams<TFields[number]> {
  const allowedSet = new Set<string>(allowedFields);

  if (!rawSort || rawSort.trim().length === 0) {
    const criterion: SortCriterion<TFields[number]> = {
      field: defaultSortBy,
      order: defaultSortOrder,
    };
    return {
      sortBy: defaultSortBy,
      sortOrder: defaultSortOrder,
      sortCriteria: [criterion],
    };
  }

  const parts = rawSort
    .split(CSV_SEPARATOR)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length > maxFields) {
    throw new ValidationAppException([
      {
        field: 'sort',
        code: 'too_many_sort_fields',
        message: `Cannot sort by more than ${maxFields} fields`,
      },
    ]);
  }

  const criteria: SortCriterion<TFields[number]>[] = [];
  const seenFields = new Set<string>();

  for (const part of parts) {
    let fieldName = part;
    let order: SortOrder = defaultSortOrder;

    if (part.startsWith(SORT_DESC_PREFIX)) {
      fieldName = part.slice(1).trim();
      order = 'desc';
    } else if (part.startsWith(SORT_ASC_PREFIX)) {
      fieldName = part.slice(1).trim();
      order = 'asc';
    } else if (part.includes(SORT_DELIMITER)) {
      const [rawField, rawOrder] = part.split(SORT_DELIMITER);
      fieldName = (rawField ?? '').trim();
      const normalizedOrder = (rawOrder ?? '').trim().toLowerCase();
      if (!(SORT_ORDERS as readonly string[]).includes(normalizedOrder)) {
        throw new ValidationAppException([
          {
            field: 'sortOrder',
            code: 'invalid_sort_order',
            message: `Invalid sort order "${rawOrder}". Allowed: ${SORT_ORDERS.join(', ')}`,
          },
        ]);
      }
      order = normalizedOrder as SortOrder;
    }

    if (!allowedSet.has(fieldName)) {
      throw new ValidationAppException([
        {
          field: 'sortBy',
          code: 'invalid_sort_field',
          message: `Field "${fieldName}" is not sortable. Allowed: ${allowedFields.join(', ')}`,
        },
      ]);
    }

    if (!seenFields.has(fieldName)) {
      seenFields.add(fieldName);
      criteria.push({
        field: fieldName as TFields[number],
        order,
      });
    }
  }

  const primary = criteria[0] ?? { field: defaultSortBy, order: defaultSortOrder };
  return {
    sortBy: primary.field,
    sortOrder: primary.order,
    sortCriteria: criteria.length > 0 ? criteria : [primary],
  };
}

/**
 * Đảm bảo danh sách tiêu chí sắp xếp luôn có cột phân định duy nhất (`tieBreakerField`, mặc định `'id'`)
 * ở cuối để tránh trùng lặp hoặc sót bản ghi khi phân trang trên các cột có giá trị trùng nhau (như `createdAt`).
 */
export function ensureDeterministicSort<TSortField extends string>(
  criteria: readonly SortCriterion<TSortField>[],
  tieBreakerField: TSortField,
  tieBreakerOrder: SortOrder = SORT_DEFAULTS.ORDER,
): readonly SortCriterion<TSortField>[] {
  const alreadyHasTieBreaker = criteria.some((c) => c.field === tieBreakerField);
  if (alreadyHasTieBreaker) {
    return criteria;
  }
  return [...criteria, { field: tieBreakerField, order: tieBreakerOrder }];
}

export interface SortSchemaOptions<TFields extends readonly [string, ...string[]]> {
  readonly allowedFields: TFields;
  readonly defaultSortBy: TFields[number];
  readonly defaultSortOrder?: SortOrder;
  readonly maxFields?: number;
}

/**
 * Tạo Zod schema xử lý sắp xếp, hỗ trợ đồng thời `?sortBy=createdAt&sortOrder=desc` và `?sort=-createdAt,id`.
 */
export function createSortQuerySchema<const TFields extends readonly [string, ...string[]]>(
  options: SortSchemaOptions<TFields>,
) {
  const defaultOrder = options.defaultSortOrder ?? SORT_DEFAULTS.ORDER;
  const maxFields = options.maxFields ?? SORT_DEFAULTS.MAX_FIELDS;

  return z
    .object({
      sortBy: optionalQueryParam(z.enum(options.allowedFields)),
      sortOrder: optionalQueryParam(
        z.preprocess(
          (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
          z.enum(SORT_ORDERS),
        ),
      ),
      sort: optionalQueryParam(z.string().max(200).refine(isPrintableString)),
    })
    .transform((val): SortParams<TFields[number]> => {
      if (val.sort !== undefined) {
        return parseSortExpression(
          val.sort,
          options.allowedFields,
          options.defaultSortBy,
          defaultOrder,
          maxFields,
        );
      }
      const sortBy = val.sortBy ?? options.defaultSortBy;
      const sortOrder = val.sortOrder ?? defaultOrder;
      return {
        sortBy,
        sortOrder,
        sortCriteria: [{ field: sortBy, order: sortOrder }],
      };
    });
}

/**
 * Làm sạch chuỗi tìm kiếm cơ bản: cắt khoảng trắng đầu/cuối, gộp khoảng trắng thừa,
 * kiểm tra ký tự điều khiển và giới hạn độ dài.
 */
export function sanitizeSearchText(
  raw: string | undefined | null,
  maxLength: number = SEARCH_DEFAULTS.MAX_LENGTH,
): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = raw.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) {
    return undefined;
  }
  if (!isPrintableString(normalized)) {
    throw new ValidationAppException([
      {
        field: 'search',
        code: 'invalid_search_chars',
        message: 'Search query contains invalid control characters',
      },
    ]);
  }
  if (normalized.length > maxLength) {
    throw new ValidationAppException([
      {
        field: 'search',
        code: 'search_too_long',
        message: `Search query must not exceed ${maxLength} characters`,
      },
    ]);
  }
  return normalized;
}

/**
 * Escape các ký tự đại diện (`%`, `_`, `\`) trong từ khóa trước khi đưa vào mệnh đề SQL `LIKE` / `ILIKE`.
 */
export function escapeLikePattern(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Chuyển đổi từ khóa sang mẫu `LIKE` / `ILIKE` an toàn theo chế độ (`contains`, `startsWith`, `endsWith`).
 * Đối với bảng dữ liệu lớn, ưu tiên dùng `'startsWith'` (tận dụng B-Tree index) hoặc Full-Text Search.
 */
export function toLikePattern(
  keyword: string,
  mode: SearchMode = SEARCH_DEFAULTS.DEFAULT_MODE,
): string {
  const escaped = escapeLikePattern(keyword.trim());
  switch (mode) {
    case 'startsWith':
      return `${escaped}%`;
    case 'endsWith':
      return `%${escaped}`;
    case 'fulltext':
      return toFullTextBooleanQuery(keyword);
    case 'contains':
    default:
      return `%${escaped}%`;
  }
}

/**
 * Tách chuỗi tìm kiếm thành mảng các từ khóa độc lập (loại bỏ ký tự đặc biệt nguy hiểm, giới hạn số lượng token).
 */
export function tokenizeSearchQuery(
  keyword: string,
  maxTokens: number = SEARCH_DEFAULTS.MAX_TOKENS,
): string[] {
  const cleaned = keyword
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  return Array.from(new Set(cleaned)).slice(0, maxTokens);
}

/**
 * Tạo chuỗi truy vấn Full-Text Search ở chế độ Boolean (`+term1* +term2*`)
 * phục vụ tìm kiếm tốc độ cao trên bảng dữ liệu lớn (MySQL `MATCH ... AGAINST (... IN BOOLEAN MODE)`).
 */
export function toFullTextBooleanQuery(
  keyword: string,
  maxTokens: number = SEARCH_DEFAULTS.MAX_TOKENS,
): string {
  const tokens = tokenizeSearchQuery(keyword, maxTokens);
  return tokens.map((token) => `+${token}*`).join(' ');
}

export interface AdvancedSearchOptions<TField extends string = string> {
  readonly allowedFields?: readonly TField[];
  readonly maxLength?: number;
  readonly maxTokens?: number;
  readonly maxFilters?: number;
}

/**
 * Phân tích cú pháp tìm kiếm nâng cao (Advanced Search Query Parser):
 * Hỗ trợ:
 * - Cụm từ chính xác trong ngoặc kép: `"nguyen van a"`
 * - Từ khóa loại trừ: `-deleted`
 * - Lọc theo trường và toán tử: `status:active`, `views:>=100`, `role:admin,staff`
 * - Từ khóa tự do: `core framework`
 */
export function parseAdvancedSearchQuery<const TField extends string = string>(
  rawQuery: string,
  options?: AdvancedSearchOptions<TField>,
): AdvancedSearchParsed<TField> {
  const maxLength = options?.maxLength ?? SEARCH_DEFAULTS.MAX_LENGTH;
  const maxTokens = options?.maxTokens ?? SEARCH_DEFAULTS.MAX_TOKENS;
  const maxFilters = options?.maxFilters ?? SEARCH_DEFAULTS.MAX_ADVANCED_FILTERS;
  const allowedFieldSet = options?.allowedFields ? new Set<string>(options.allowedFields) : null;

  const sanitized = sanitizeSearchText(rawQuery, maxLength) ?? '';
  if (sanitized.length === 0) {
    return {
      raw: '',
      tokens: [],
      exactPhrases: [],
      excludedTerms: [],
      fieldConditions: [],
    };
  }

  const exactPhrases: string[] = [];
  const withoutQuotes = sanitized.replace(/"([^"]+)"/g, (_, phrase: string) => {
    const cleanPhrase = phrase.trim();
    if (cleanPhrase.length > 0) {
      exactPhrases.push(cleanPhrase);
    }
    return ' ';
  });

  const tokens: string[] = [];
  const excludedTerms: string[] = [];
  const fieldConditions: FilterCondition<TField, string | readonly string[]>[] = [];

  const parts = withoutQuotes
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  for (const part of parts) {
    if (part.startsWith(SORT_DESC_PREFIX) && part.length > 1 && !part.includes(SORT_DELIMITER)) {
      excludedTerms.push(part.slice(1));
      continue;
    }

    const colonIndex = part.indexOf(SORT_DELIMITER);
    if (colonIndex > 0 && colonIndex < part.length - 1) {
      const rawField = part.slice(0, colonIndex).trim();
      const rawVal = part.slice(colonIndex + 1).trim();

      if (allowedFieldSet && !allowedFieldSet.has(rawField)) {
        throw new ValidationAppException([
          {
            field: 'search',
            code: 'invalid_search_field',
            message: `Field "${rawField}" is not allowed in advanced search`,
          },
        ]);
      }

      if (fieldConditions.length >= maxFilters) {
        throw new ValidationAppException([
          {
            field: 'search',
            code: 'too_many_search_filters',
            message: `Advanced search cannot exceed ${maxFilters} field filters`,
          },
        ]);
      }

      let operator: FilterOperator = 'eq';
      let cleanVal = rawVal;

      for (const [prefix, op] of ADVANCED_OP_PREFIXES) {
        if (rawVal.startsWith(prefix) && rawVal.length > prefix.length) {
          operator = op;
          cleanVal = rawVal.slice(prefix.length);
          break;
        }
      }

      if (operator === 'eq' && cleanVal.includes(CSV_SEPARATOR)) {
        const listValues = cleanVal
          .split(CSV_SEPARATOR)
          .map((v) => v.trim())
          .filter(Boolean);
        fieldConditions.push({
          field: rawField as TField,
          operator: 'in',
          value: listValues,
        });
      } else {
        fieldConditions.push({
          field: rawField as TField,
          operator,
          value: cleanVal,
        });
      }
      continue;
    }

    if (tokens.length < maxTokens) {
      tokens.push(part);
    }
  }

  return {
    raw: sanitized,
    tokens,
    exactPhrases,
    excludedTerms,
    fieldConditions,
  };
}

/** Cấu hình whitelist các toán tử lọc cho phép trên từng trường dữ liệu. */
export type AllowedFilterFieldsConfig<TField extends string = string> = Readonly<
  Record<TField, readonly FilterOperator[]>
>;

/**
 * Phân tích các tham số lọc nâng cao từ query object (hỗ trợ dạng `field=val`, `field__op=val`,
 * hoặc `filter[field][op]=val`), kiểm tra chặt chẽ theo whitelist `allowedFilters` để bảo vệ hiệu năng DB.
 */
export function parseFilterConditions<const TField extends string>(
  query: Record<string, unknown>,
  allowedFilters: AllowedFilterFieldsConfig<TField>,
  maxConditions: number = SEARCH_DEFAULTS.MAX_ADVANCED_FILTERS,
): FilterCondition<TField>[] {
  const conditions: FilterCondition<TField>[] = [];
  const allowedFields = Object.keys(allowedFilters) as TField[];
  const allowedFieldSet = new Set<string>(allowedFields);

  /** Xác thực toán tử và chuẩn hóa giá trị trước khi đưa vào danh sách điều kiện lọc */
  const pushCondition = (field: TField, operator: FilterOperator, rawValue: unknown) => {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return;
    }
    const allowedOps = allowedFilters[field] ?? [];
    if (!allowedOps.includes(operator)) {
      throw new ValidationAppException([
        {
          field,
          code: 'unsupported_filter_operator',
          message: `Operator "${operator}" is not allowed on field "${field}". Allowed: ${allowedOps.join(', ')}`,
        },
      ]);
    }
    if (conditions.length >= maxConditions) {
      throw new ValidationAppException([
        {
          field,
          code: 'too_many_filters',
          message: `Cannot apply more than ${maxConditions} filter conditions`,
        },
      ]);
    }

    let normalizedValue: unknown = rawValue;
    if (operator === 'in' || operator === 'nin' || operator === 'between') {
      const listVal =
        typeof rawValue === 'string'
          ? rawValue
              .split(CSV_SEPARATOR)
              .map((v) => v.trim())
              .filter(Boolean)
          : Array.isArray(rawValue)
            ? rawValue.map((v) => String(v).trim()).filter(Boolean)
            : [String(rawValue).trim()].filter(Boolean);

      if (operator === 'between' && listVal.length !== 2) {
        throw new ValidationAppException([
          {
            field,
            code: 'invalid_between_filter',
            message: `Operator "between" on field "${field}" requires exactly 2 comma-separated values`,
          },
        ]);
      }

      if (
        (operator === 'in' || operator === 'nin') &&
        listVal.length > QUERY_COMPLEXITY_DEFAULTS.MAX_IN_VALUES
      ) {
        throw new ValidationAppException([
          {
            field,
            code: 'too_many_in_values',
            message: `Operator "${operator}" on field "${field}" cannot exceed ${QUERY_COMPLEXITY_DEFAULTS.MAX_IN_VALUES} values`,
          },
        ]);
      }

      normalizedValue = listVal;
    } else if (operator === 'isNull') {
      normalizedValue = rawValue === 'true' || rawValue === '1' || rawValue === true;
    }

    conditions.push({
      field,
      operator,
      value: normalizedValue,
    });
  };

  for (const [key, val] of Object.entries(query)) {
    if (val === undefined || val === null || val === '') continue;

    // 1. Dạng `field__operator=value` (ví dụ: `createdAt__gte=2026-01-01`)
    if (key.includes('__')) {
      const [rawField, rawOp] = key.split('__');
      if (rawField && allowedFieldSet.has(rawField)) {
        if (!(FILTER_OPERATORS as readonly string[]).includes(rawOp ?? '')) {
          throw new ValidationAppException([
            {
              field: rawField,
              code: 'invalid_filter_operator',
              message: `Unknown filter operator "${rawOp}"`,
            },
          ]);
        }
        pushCondition(rawField as TField, rawOp as FilterOperator, val);
      }
      continue;
    }

    // 2. Dạng `filter[field][op]=value` hoặc `filter[field]=value`
    const bracketMatch = /^filter\[([a-zA-Z0-9_.-]+)\](?:\[([a-zA-Z0-9_]+)\])?$/.exec(key);
    if (bracketMatch) {
      const rawField = bracketMatch[1]!;
      const rawOp = bracketMatch[2] ?? 'eq';
      if (!allowedFieldSet.has(rawField)) {
        throw new ValidationAppException([
          {
            field: rawField,
            code: 'invalid_filter_field',
            message: `Field "${rawField}" is not allowed for filtering`,
          },
        ]);
      }
      if (!(FILTER_OPERATORS as readonly string[]).includes(rawOp)) {
        throw new ValidationAppException([
          {
            field: rawField,
            code: 'invalid_filter_operator',
            message: `Unknown filter operator "${rawOp}"`,
          },
        ]);
      }
      pushCondition(rawField as TField, rawOp as FilterOperator, val);
    }
  }

  return conditions;
}

export interface SelectFieldsOptions<TField extends string = string> {
  readonly allowedFields?: readonly TField[] | undefined;
  readonly alwaysIncludeFields?: readonly TField[] | undefined;
  readonly maxFields?: number | undefined;
}

/**
 * Phân tích và xác thực danh sách trường cần trả về (`?fields=id,username,email` hoặc mảng chuỗi),
 * đối chiếu nghiêm ngặt với `allowedFields` (nếu có) và giới hạn `maxFields` (Mục 8.1 — Chọn các trường cần trả về).
 */
export function parseSelectFields<const TField extends string = string>(
  rawFields: string | readonly string[] | undefined | null,
  optionsOrAllowed?: SelectFieldsOptions<TField> | readonly TField[],
): readonly TField[] | undefined {
  if (rawFields === undefined || rawFields === null || rawFields === '') {
    return undefined;
  }

  const options: SelectFieldsOptions<TField> | undefined = Array.isArray(optionsOrAllowed)
    ? { allowedFields: optionsOrAllowed as readonly TField[] }
    : (optionsOrAllowed as SelectFieldsOptions<TField> | undefined);

  const parts = (Array.isArray(rawFields) ? rawFields : String(rawFields).split(CSV_SEPARATOR))
    .map((f) => String(f).trim())
    .filter((f) => f.length > 0);

  if (parts.length === 0) {
    return undefined;
  }

  const maxFields = options?.maxFields ?? SELECT_DEFAULTS.MAX_FIELDS;
  if (parts.length > maxFields) {
    throw new ValidationAppException([
      {
        field: 'fields',
        code: 'too_many_select_fields',
        message: `Cannot select more than ${maxFields} fields`,
      },
    ]);
  }

  const allowedSet =
    options?.allowedFields && options.allowedFields.length > 0
      ? new Set<string>(options.allowedFields)
      : null;

  const selectedSet = new Set<TField>();
  if (options?.alwaysIncludeFields) {
    for (const reqField of options.alwaysIncludeFields) {
      selectedSet.add(reqField);
    }
  }

  for (const part of parts) {
    if (!isPrintableString(part) || !/^[a-zA-Z0-9_.-]+$/.test(part)) {
      throw new ValidationAppException([
        {
          field: 'fields',
          code: 'invalid_select_field',
          message: `Invalid field name "${part}" in fields selection`,
        },
      ]);
    }
    if (allowedSet && !allowedSet.has(part)) {
      throw new ValidationAppException([
        {
          field: 'fields',
          code: 'invalid_select_field',
          message: `Field "${part}" is not selectable. Allowed: ${options?.allowedFields?.join(', ')}`,
        },
      ]);
    }
    selectedSet.add(part as TField);
  }

  return [...selectedSet];
}

/**
 * Tạo Zod schema phân tích tham số chọn trường (`?fields=id,name` hoặc `?select=id,name`).
 */
export function createSelectFieldsQuerySchema<const TField extends string = string>(
  options?: SelectFieldsOptions<TField>,
) {
  return z
    .object({
      fields: optionalQueryParam(z.union([z.string(), z.array(z.string())])),
      select: optionalQueryParam(z.union([z.string(), z.array(z.string())])),
    })
    .transform((val): readonly TField[] | undefined => {
      const raw = val.fields ?? val.select;
      return parseSelectFields(raw, options);
    });
}

export interface CreateListQuerySchemaOptions<
  TSortFields extends readonly [string, ...string[]],
  TFilterSchema extends z.ZodTypeAny = z.ZodObject<Record<string, never>>,
  TFilterField extends string = string,
  TSelectField extends string = string,
> {
  readonly allowedSortFields: TSortFields;
  readonly defaultSortBy: TSortFields[number];
  readonly defaultSortOrder?: SortOrder;
  readonly maxSortFields?: number;
  readonly tieBreakerField?: TSortFields[number];
  readonly defaultLimit?: number;
  readonly maxLimit?: number;
  readonly maxOffset?: number;
  readonly defaultCountMode?: CountMode;
  readonly maxSearchLength?: number;
  readonly allowedFilterFields?: AllowedFilterFieldsConfig<TFilterField>;
  readonly allowedSelectFields?: readonly TSelectField[];
  readonly alwaysIncludeSelectFields?: readonly TSelectField[];
  readonly dateRange?: DateRangeSchemaOptions;
  readonly filterSchema?: TFilterSchema;
}

/**
 * Tạo bộ parser hợp nhất cho mọi API danh sách (Hỗ trợ đồng thời:
 * Offset Pagination, Cursor Pagination, Multi-column Sort có Tie-breaker,
 * Tìm kiếm cơ bản & nâng cao, Khoảng ngày, Chọn trường trả về và Bộ lọc động có Whitelist).
 */
export function createListQuerySchema<
  const TSortFields extends readonly [string, ...string[]],
  TFilterSchema extends z.ZodTypeAny = z.ZodObject<Record<string, never>>,
  const TFilterField extends string = string,
  const TSelectField extends string = string,
>(options: CreateListQuerySchemaOptions<TSortFields, TFilterSchema, TFilterField, TSelectField>) {
  const paginationSchema = createPaginationQuerySchema({
    ...(options.defaultLimit !== undefined ? { defaultLimit: options.defaultLimit } : {}),
    ...(options.maxLimit !== undefined ? { maxLimit: options.maxLimit } : {}),
    ...(options.maxOffset !== undefined ? { maxOffset: options.maxOffset } : {}),
    ...(options.defaultCountMode !== undefined
      ? { defaultCountMode: options.defaultCountMode }
      : {}),
  });

  const cursorSchema = createCursorPaginationQuerySchema({
    ...(options.defaultLimit !== undefined ? { defaultLimit: options.defaultLimit } : {}),
    ...(options.maxLimit !== undefined ? { maxLimit: options.maxLimit } : {}),
  });

  const sortSchema = createSortQuerySchema({
    allowedFields: options.allowedSortFields,
    defaultSortBy: options.defaultSortBy,
    ...(options.defaultSortOrder !== undefined
      ? { defaultSortOrder: options.defaultSortOrder }
      : {}),
    ...(options.maxSortFields !== undefined ? { maxFields: options.maxSortFields } : {}),
  });

  const selectSchema = createSelectFieldsQuerySchema<TSelectField>({
    ...(options.allowedSelectFields !== undefined
      ? { allowedFields: options.allowedSelectFields }
      : {}),
    ...(options.alwaysIncludeSelectFields !== undefined
      ? { alwaysIncludeFields: options.alwaysIncludeSelectFields }
      : {}),
  });

  const maxSearchLen = options.maxSearchLength ?? SEARCH_DEFAULTS.MAX_LENGTH;
  const searchRawSchema = z.object({
    search: optionalQueryParam(z.string()),
    q: optionalQueryParam(z.string()),
  });

  const allowedSearchFilterFields = options.allowedFilterFields
    ? (Object.keys(options.allowedFilterFields) as TFilterField[])
    : undefined;

  const fromKey = options.dateRange?.fromKey ?? 'from';
  const toKey = options.dateRange?.toKey ?? 'to';

  return z
    .any()
    .transform(
      (
        rawInput: unknown,
      ): ListQueryResult<
        TSortFields[number],
        z.infer<TFilterSchema>,
        TFilterField,
        TSelectField
      > => {
        const inputObj =
          typeof rawInput === 'object' && rawInput !== null
            ? (rawInput as Record<string, unknown>)
            : {};

        const pagination = parseOrThrow(paginationSchema, inputObj);
        const cursorPagination = parseOrThrow(cursorSchema, inputObj);
        const sort = parseOrThrow(sortSchema, inputObj);
        const searchInput = parseOrThrow(searchRawSchema, inputObj);
        const fields = parseOrThrow(selectSchema, inputObj);

        const rawSearchText = searchInput.search ?? searchInput.q;
        const search = sanitizeSearchText(rawSearchText, maxSearchLen);
        const advancedSearch =
          search !== undefined
            ? parseAdvancedSearchQuery<TFilterField>(search, {
                ...(allowedSearchFilterFields !== undefined
                  ? { allowedFields: allowedSearchFilterFields }
                  : {}),
                maxLength: maxSearchLen,
              })
            : undefined;

        const filterConditions = options.allowedFilterFields
          ? parseFilterConditions(inputObj, options.allowedFilterFields)
          : [];

        const rawFrom = inputObj[fromKey] as string | Date | number | null | undefined;
        const rawTo = inputObj[toKey] as string | Date | number | null | undefined;
        const resolvedRange: ResolvedDateRange = resolveDateRange(rawFrom, rawTo, {
          fromFieldName: fromKey,
          toFieldName: toKey,
          ...(options.dateRange?.maxSpanDays !== undefined
            ? { maxSpanDays: options.dateRange.maxSpanDays }
            : {}),
        });
        const dateRange =
          resolvedRange.from !== undefined || resolvedRange.to !== undefined
            ? resolvedRange
            : undefined;

        const customFilters = (
          options.filterSchema ? parseOrThrow(options.filterSchema, inputObj) : {}
        ) as z.infer<TFilterSchema>;

        const finalSortCriteria =
          options.tieBreakerField !== undefined
            ? ensureDeterministicSort(sort.sortCriteria, options.tieBreakerField, sort.sortOrder)
            : sort.sortCriteria;

        assertQueryComplexity(
          {
            limit: pagination.limit,
            offset: pagination.offset,
            sortCriteriaCount: sort.sortCriteria.length,
            filterConditions,
            search,
            searchTokensCount: advancedSearch?.tokens.length,
            selectFieldsCount: fields?.length,
          },
          {
            ...(options.maxLimit !== undefined ? { maxLimit: options.maxLimit } : {}),
            ...(options.maxOffset !== undefined ? { maxOffset: options.maxOffset } : {}),
            ...(options.maxSortFields !== undefined
              ? { maxSortFields: options.maxSortFields }
              : {}),
            maxSearchLength: maxSearchLen,
          },
        );

        return {
          page: pagination.page,
          limit: pagination.limit,
          offset: pagination.offset,
          cursor: cursorPagination.cursor,
          direction: cursorPagination.direction,
          countMode: pagination.countMode ?? 'exact',
          sortBy: sort.sortBy,
          sortOrder: sort.sortOrder,
          sortCriteria: finalSortCriteria,
          search,
          advancedSearch,
          filterConditions,
          ...(dateRange ? { dateRange } : {}),
          ...(fields ? { fields } : {}),
          filters: customFilters,
        };
      },
    );
}
