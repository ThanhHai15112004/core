import { describe, it, expect, jest } from '@jest/globals';
import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { z } from 'zod';
import {
  BadRequestAppException,
  ConflictAppException,
  DomainException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  HTTP_STATUS_CODE,
  InternalServerAppException,
  NotFoundAppException,
  PAGINATION_DEFAULTS,
  ServiceUnavailableAppException,
  TooManyRequestsAppException,
  UnauthorizedAppException,
  UnprocessableEntityAppException,
  ValidationAppException,
} from '@packages/kernel/index.js';
import {
  API_VERSIONS,
  DEFAULT_API_PREFIX,
  GlobalExceptionFilter,
  TransformResponseInterceptor,
  booleanQueryParam,
  buildPaginationMeta,
  buildVersionedPath,
  calculateOffset,
  createCursorPaginatedResult,
  createCursorPaginationQuerySchema,
  createListQuerySchema,
  createPaginatedResult,
  createPaginationQuerySchema,
  createSortQuerySchema,
  csvQueryParam,
  dateRangeQuerySchema,
  decodeCursor,
  encodeCursor,
  ensureDeterministicSort,
  escapeLikePattern,
  getFetchLimitForCountMode,
  normalizeApiPrefix,
  okResponse,
  optionalQueryParam,
  parseAdvancedSearchQuery,
  parseFilterConditions,
  parseOrThrow,
  parseSortExpression,
  sanitizeSearchText,
  toFullTextBooleanQuery,
  toLikePattern,
  tokenizeSearchQuery,
} from '@packages/http/index.js';
import type { CoreI18nService } from '@packages/i18n/index.js';
import { of, lastValueFrom } from 'rxjs';

describe('Unit: Common API Standards (Task 2.1)', () => {
  describe('1. API Versioning & Path Helpers', () => {
    it('should expose V1 version and default prefix', () => {
      expect(API_VERSIONS.V1).toBe('v1');
      expect(DEFAULT_API_PREFIX).toBe('api/v1');
    });

    it('should normalize API prefix by stripping leading/trailing slashes', () => {
      expect(normalizeApiPrefix('/api/v1/')).toBe('api/v1');
      expect(normalizeApiPrefix('///api/v1///')).toBe('api/v1');
      expect(normalizeApiPrefix('   ')).toBe(DEFAULT_API_PREFIX);
    });

    it('should build versioned API paths cleanly', () => {
      expect(buildVersionedPath('users')).toBe('/api/v1/users');
      expect(buildVersionedPath('/users/profile/', '/api/v1/')).toBe('/api/v1/users/profile');
      expect(buildVersionedPath('')).toBe('/api/v1');
    });
  });

  describe('2. Success Response Envelope & Interceptor', () => {
    /** Tạo ExecutionContext giả lập chứa mã trạng thái HTTP mong muốn */
    const createMockContext = (statusCode: number = HTTP_STATUS_CODE.OK) =>
      ({
        switchToHttp: () => ({
          getResponse: () => ({ statusCode }),
        }),
      }) as unknown as Parameters<TransformResponseInterceptor<unknown>['intercept']>[0];

    it('should wrap plain data into ApiSuccessResponse', async () => {
      const interceptor = new TransformResponseInterceptor<{ id: string }>();
      const result = await lastValueFrom(
        interceptor.intercept(createMockContext(HTTP_STATUS_CODE.OK), {
          handle: () => of({ id: 'u1' }),
        }),
      );

      expect(result).toBeDefined();
      expect(result?.success).toBe(true);
      expect(result?.statusCode).toBe(HTTP_STATUS_CODE.OK);
      expect(result?.data).toEqual({ id: 'u1' });
      expect(typeof result?.timestamp).toBe('string');
    });

    it('should unwrap { data, meta } from okResponse / createPaginatedResult', async () => {
      const interceptor = new TransformResponseInterceptor<unknown>();
      const paginated = createPaginatedResult(['a', 'b'], 10, 1, 2);
      const result = await lastValueFrom(
        interceptor.intercept(createMockContext(HTTP_STATUS_CODE.OK), {
          handle: () => of(paginated),
        }),
      );

      expect(result?.data).toEqual(['a', 'b']);
      expect(result?.meta).toEqual({
        page: 1,
        limit: 2,
        total: 10,
        totalPages: 5,
        hasNextPage: true,
        hasPrevPage: false,
      });
    });

    it('should return undefined on 204 NO_CONTENT and avoid double-wrapping', async () => {
      const interceptor = new TransformResponseInterceptor<unknown>();
      const noContent = await lastValueFrom(
        interceptor.intercept(createMockContext(HTTP_STATUS_CODE.NO_CONTENT), {
          handle: () => of(null),
        }),
      );
      expect(noContent).toBeUndefined();

      const alreadyWrapped = {
        success: true as const,
        statusCode: HTTP_STATUS_CODE.CREATED,
        data: { created: true },
        timestamp: '2026-10-14T00:00:00.000Z',
      };
      const passthrough = await lastValueFrom(
        interceptor.intercept(createMockContext(HTTP_STATUS_CODE.CREATED), {
          handle: () => of(alreadyWrapped),
        }),
      );
      expect(passthrough).toBe(alreadyWrapped);
      expect(okResponse({ ok: 1 }, { custom: true })).toEqual({
        data: { ok: 1 },
        meta: { custom: true },
      });
    });
  });

  describe('3 & 4. Standardized HTTP Status Codes, Exceptions & GlobalExceptionFilter', () => {
    it('should construct all standard HTTP exception classes with accurate status and error codes', () => {
      expect(new BadRequestAppException()).toMatchObject({
        statusCode: HTTP_STATUS_CODE.BAD_REQUEST,
        code: HTTP_ERROR_CODE.BAD_REQUEST,
      });
      expect(new ValidationAppException([{ field: 'email', message: 'Invalid' }])).toMatchObject({
        statusCode: HTTP_STATUS_CODE.BAD_REQUEST,
        code: HTTP_ERROR_CODE.VALIDATION_FAILED,
        details: [{ field: 'email', message: 'Invalid' }],
      });
      expect(new DomainException('Invalid state')).toMatchObject({
        statusCode: HTTP_STATUS_CODE.BAD_REQUEST,
        code: HTTP_ERROR_CODE.DOMAIN_ERROR,
      });
      expect(new UnauthorizedAppException()).toMatchObject({
        statusCode: HTTP_STATUS_CODE.UNAUTHORIZED,
        code: HTTP_ERROR_CODE.UNAUTHORIZED,
      });
      expect(new ForbiddenAppException()).toMatchObject({
        statusCode: HTTP_STATUS_CODE.FORBIDDEN,
        code: HTTP_ERROR_CODE.FORBIDDEN,
      });
      expect(new NotFoundAppException()).toMatchObject({
        statusCode: HTTP_STATUS_CODE.NOT_FOUND,
        code: HTTP_ERROR_CODE.NOT_FOUND,
      });
      expect(new ConflictAppException()).toMatchObject({
        statusCode: HTTP_STATUS_CODE.CONFLICT,
        code: HTTP_ERROR_CODE.CONFLICT,
      });
      expect(new UnprocessableEntityAppException()).toMatchObject({
        statusCode: HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY,
        code: HTTP_ERROR_CODE.UNPROCESSABLE_ENTITY,
      });
      expect(new TooManyRequestsAppException()).toMatchObject({
        statusCode: HTTP_STATUS_CODE.TOO_MANY_REQUESTS,
        code: HTTP_ERROR_CODE.TOO_MANY_REQUESTS,
      });
      expect(new InternalServerAppException()).toMatchObject({
        statusCode: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR,
        code: HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR,
      });
      expect(new ServiceUnavailableAppException()).toMatchObject({
        statusCode: HTTP_STATUS_CODE.SERVICE_UNAVAILABLE,
        code: HTTP_ERROR_CODE.SERVICE_UNAVAILABLE,
      });
    });

    it('should normalize AppException, ZodError, HttpException, and unknown Error in GlobalExceptionFilter', () => {
      const mockI18n = {
        t: jest.fn((key: string) => `translated:${key}`),
      } as unknown as CoreI18nService;

      const filter = new GlobalExceptionFilter(mockI18n);
      let capturedStatus = 0;
      let capturedPayload: unknown = null;

      const host = {
        switchToHttp: () => ({
          getResponse: () => ({
            status: (code: number) => {
              capturedStatus = code;
              return {
                send: (payload: unknown) => {
                  capturedPayload = payload;
                },
              };
            },
          }),
        }),
      } as unknown as ArgumentsHost;

      // 1. ZodError
      const schema = z.object({ age: z.number().min(18) });
      const zodRes = schema.safeParse({ age: 10 });
      if (!zodRes.success) {
        filter.catch(zodRes.error, host);
      }
      expect(capturedStatus).toBe(HTTP_STATUS_CODE.BAD_REQUEST);
      expect(capturedPayload).toMatchObject({
        success: false,
        statusCode: HTTP_STATUS_CODE.BAD_REQUEST,
        error: {
          code: HTTP_ERROR_CODE.VALIDATION_FAILED,
          message: 'translated:VALIDATION_FAILED',
          details: [expect.objectContaining({ field: 'age' })],
        },
      });

      // 2. ConflictAppException
      filter.catch(new ConflictAppException(), host);
      expect(capturedStatus).toBe(HTTP_STATUS_CODE.CONFLICT);
      expect(capturedPayload).toMatchObject({
        success: false,
        statusCode: HTTP_STATUS_CODE.CONFLICT,
        error: {
          code: HTTP_ERROR_CODE.CONFLICT,
          message: 'translated:CONFLICT',
        },
      });

      // 3. NestJS HttpException with validation array
      filter.catch(
        new HttpException({ message: ['field must not be empty'] }, HttpStatus.BAD_REQUEST),
        host,
      );
      expect(capturedStatus).toBe(HTTP_STATUS_CODE.BAD_REQUEST);
      expect(capturedPayload).toMatchObject({
        error: {
          code: HTTP_ERROR_CODE.VALIDATION_FAILED,
          details: ['field must not be empty'],
        },
      });

      // 4. Unexpected runtime error -> mask internal message
      filter.catch(new Error('Database credentials leaked'), host);
      expect(capturedStatus).toBe(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR);
      expect(capturedPayload).toMatchObject({
        error: {
          code: HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR,
          message: 'translated:INTERNAL_SERVER_ERROR',
        },
      });
    });
  });

  describe('5. Offset Pagination, High-Load Lookahead & Cursor Pagination', () => {
    it('should calculate offset and build pagination meta accurately', () => {
      expect(calculateOffset(1, 20)).toBe(0);
      expect(calculateOffset(3, 25)).toBe(50);

      const meta = buildPaginationMeta(45, 2, 20);
      expect(meta).toEqual({
        page: 2,
        limit: 20,
        total: 45,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: true,
      });

      const emptyMeta = buildPaginationMeta(0, 1, 20);
      expect(emptyMeta.totalPages).toBe(0);
      expect(emptyMeta.hasNextPage).toBe(false);
      expect(emptyMeta.hasPrevPage).toBe(false);
    });

    it('should support high-load countMode="none" lookahead (limit + 1) without COUNT(*)', () => {
      expect(getFetchLimitForCountMode(20, 'exact')).toBe(20);
      expect(getFetchLimitForCountMode(20, 'none')).toBe(21);

      // Fetched 3 rows when limit = 2 -> slices to 2 and sets hasNextPage = true
      const result = createPaginatedResult(['item1', 'item2', 'item3'], null, 2, 2);
      expect(result.data).toEqual(['item1', 'item2']);
      expect(result.meta).toEqual({
        page: 2,
        limit: 2,
        total: null,
        totalPages: null,
        hasNextPage: true,
        hasPrevPage: true,
      });
    });

    it('should block deep offset scan exceeding MAX_OFFSET', () => {
      const schema = createPaginationQuerySchema({ maxOffset: 1000 });
      const valid = parseOrThrow(schema, { page: '10', limit: '50' });
      expect(valid).toEqual({
        page: 10,
        limit: 50,
        offset: 450,
        countMode: 'exact',
      });

      expect(() => parseOrThrow(schema, { page: '100', limit: '50' })).toThrow(
        ValidationAppException,
      );
    });

    it('should encode/decode cursor and build CursorPaginatedResult for large datasets', () => {
      const token = encodeCursor({
        sortValue: '2026-10-14T00:00:00.000Z',
        tieBreakerId: 'row-99',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      const decoded = decodeCursor<string>(token);
      expect(decoded).toEqual({
        sortValue: '2026-10-14T00:00:00.000Z',
        tieBreakerId: 'row-99',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      expect(() => decodeCursor('not-valid-base64-json!!!')).toThrow(ValidationAppException);

      const cursorQuery = parseOrThrow(createCursorPaginationQuerySchema(), {
        cursor: token,
        limit: '2',
        direction: 'next',
      });
      expect(cursorQuery.limit).toBe(2);
      expect(cursorQuery.direction).toBe('next');

      // Lookahead 3 items with limit 2
      const rows = [
        { id: '1', createdAt: 100 },
        { id: '2', createdAt: 200 },
        { id: '3', createdAt: 300 },
      ];
      const cursorPage = createCursorPaginatedResult(rows, 2, {
        hasPrevPage: true,
        extractCursor: (item) => ({ sortValue: item.createdAt, tieBreakerId: item.id }),
      });

      expect(cursorPage.data).toHaveLength(2);
      expect(cursorPage.meta.hasNextPage).toBe(true);
      expect(cursorPage.meta.hasPrevPage).toBe(true);
      expect(cursorPage.meta.nextCursor).toBeTruthy();
      expect(decodeCursor(cursorPage.meta.nextCursor!)).toEqual({
        sortValue: 200,
        tieBreakerId: '2',
      });
    });
  });

  describe('6. Sorting & Filtering (Multi-column, Deterministic Tie-Breaker & Operator Whitelist)', () => {
    const allowedSort = ['id', 'createdAt', 'priority', 'title'] as const;

    it('should parse multi-column sort expressions and enforce whitelist', () => {
      const sortParams = parseSortExpression('-priority,createdAt:asc', allowedSort, 'createdAt');
      expect(sortParams.sortBy).toBe('priority');
      expect(sortParams.sortOrder).toBe('desc');
      expect(sortParams.sortCriteria).toEqual([
        { field: 'priority', order: 'desc' },
        { field: 'createdAt', order: 'asc' },
      ]);

      const withTieBreaker = ensureDeterministicSort(sortParams.sortCriteria, 'id', 'desc');
      expect(withTieBreaker).toEqual([
        { field: 'priority', order: 'desc' },
        { field: 'createdAt', order: 'asc' },
        { field: 'id', order: 'desc' },
      ]);

      expect(() => parseSortExpression('hackedColumn:desc', allowedSort, 'createdAt')).toThrow(
        ValidationAppException,
      );

      const sortSchema = createSortQuerySchema({
        allowedFields: allowedSort,
        defaultSortBy: 'createdAt',
      });
      const parsedFromQuery = parseOrThrow(sortSchema, {
        sortBy: 'title',
        sortOrder: 'ASC',
      });
      expect(parsedFromQuery).toEqual({
        sortBy: 'title',
        sortOrder: 'asc',
        sortCriteria: [{ field: 'title', order: 'asc' }],
      });
    });

    it('should parse filter primitives and operator whitelist conditions', () => {
      const filterPrimitiveSchema = z.object({
        active: optionalQueryParam(booleanQueryParam()),
        tags: optionalQueryParam(csvQueryParam()),
      });

      const parsed = parseOrThrow(filterPrimitiveSchema, {
        active: '1',
        tags: 'ts, nestjs , fastify',
      });
      expect(parsed).toEqual({
        active: true,
        tags: ['ts', 'nestjs', 'fastify'],
      });

      const rangeValid = parseOrThrow(dateRangeQuerySchema, {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
      });
      expect(rangeValid.from).toBeDefined();

      expect(() =>
        parseOrThrow(dateRangeQuerySchema, {
          from: '2026-05-01T00:00:00.000Z',
          to: '2026-01-01T00:00:00.000Z',
        }),
      ).toThrow(ValidationAppException);

      const conditions = parseFilterConditions(
        {
          status__in: 'active,pending',
          'filter[views][gte]': '100',
          'filter[createdAt][between]': '2026-01-01,2026-12-31',
        },
        {
          status: ['eq', 'in'],
          views: ['gte', 'lte'],
          createdAt: ['between'],
        },
      );

      expect(conditions).toEqual([
        { field: 'status', operator: 'in', value: ['active', 'pending'] },
        { field: 'views', operator: 'gte', value: '100' },
        { field: 'createdAt', operator: 'between', value: ['2026-01-01', '2026-12-31'] },
      ]);

      // Reject disallowed operator on field
      expect(() => parseFilterConditions({ status__gt: '10' }, { status: ['eq', 'in'] })).toThrow(
        ValidationAppException,
      );
    });
  });

  describe('7. Basic Search, Advanced Search & Full-Text Search Optimization', () => {
    it('should sanitize basic search, escape LIKE wildcards, and build FTS boolean queries', () => {
      expect(sanitizeSearchText('   hello   world   ')).toBe('hello world');
      expect(sanitizeSearchText('   ')).toBeUndefined();
      expect(() => sanitizeSearchText('bad\u0000char')).toThrow(ValidationAppException);

      expect(escapeLikePattern('100% _admin\\test')).toBe('100\\% \\_admin\\\\test');
      expect(toLikePattern('100%', 'contains')).toBe('%100\\%%');
      expect(toLikePattern('prefix_1', 'startsWith')).toBe('prefix\\_1%');
      expect(toLikePattern('suffix', 'endsWith')).toBe('%suffix');

      expect(tokenizeSearchQuery('nestjs, fastify! nestjs 2026')).toEqual([
        'nestjs',
        'fastify',
        '2026',
      ]);
      expect(toFullTextBooleanQuery('core framework')).toBe('+core* +framework*');
    });

    it('should parse advanced search syntax with phrases, exclusions, and field operators', () => {
      const parsed = parseAdvancedSearchQuery(
        '"nguyen van a" -deleted status:active,pending score:>=80 backend typescript',
        {
          allowedFields: ['status', 'score'],
        },
      );

      expect(parsed.exactPhrases).toEqual(['nguyen van a']);
      expect(parsed.excludedTerms).toEqual(['deleted']);
      expect(parsed.tokens).toEqual(['backend', 'typescript']);
      expect(parsed.fieldConditions).toEqual([
        { field: 'status', operator: 'in', value: ['active', 'pending'] },
        { field: 'score', operator: 'gte', value: '80' },
      ]);

      expect(() =>
        parseAdvancedSearchQuery('secretField:123', { allowedFields: ['status'] }),
      ).toThrow(ValidationAppException);
    });

    it('should combine all features in createListQuerySchema', () => {
      const listSchema = createListQuerySchema({
        allowedSortFields: ['id', 'createdAt', 'name'],
        defaultSortBy: 'createdAt',
        tieBreakerField: 'id',
        allowedFilterFields: {
          status: ['eq', 'in'],
          age: ['gte', 'lte'],
        },
        filterSchema: z.object({
          verified: optionalQueryParam(booleanQueryParam()),
        }),
      });

      const result = parseOrThrow(listSchema, {
        page: '2',
        limit: String(PAGINATION_DEFAULTS.LIMIT),
        countMode: 'none',
        sort: '-name',
        search: '"john doe" -banned status:active',
        age__gte: '21',
        verified: 'true',
      });

      expect(result.page).toBe(2);
      expect(result.offset).toBe(PAGINATION_DEFAULTS.LIMIT);
      expect(result.countMode).toBe('none');
      expect(result.sortBy).toBe('name');
      expect(result.sortCriteria).toEqual([
        { field: 'name', order: 'desc' },
        { field: 'id', order: 'desc' },
      ]);
      expect(result.advancedSearch?.exactPhrases).toEqual(['john doe']);
      expect(result.advancedSearch?.excludedTerms).toEqual(['banned']);
      expect(result.filterConditions).toEqual([{ field: 'age', operator: 'gte', value: '21' }]);
      expect(result.filters).toEqual({ verified: true });
    });
  });
});
