import { describe, it, expect, jest } from '@jest/globals';
import { HttpException, HttpStatus, type ArgumentMetadata, type ArgumentsHost } from '@nestjs/common';
import { z } from 'zod';
import {
  BadRequestAppException,
  COMMON_ERROR_CODE,
  ConflictAppException,
  DomainException,
  ERROR_CATEGORY,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  HTTP_STATUS_CODE,
  InternalServerAppException,
  NotFoundAppException,
  PayloadTooLargeAppException,
  ServiceUnavailableAppException,
  TooManyRequestsAppException,
  UnauthorizedAppException,
  UnprocessableEntityAppException,
  UnsupportedMediaTypeAppException,
  VALIDATION_ERROR_CODE,
  VALIDATION_ISSUE_CODE,
  VALIDATION_SOURCE,
  ValidationAppException,
  classifyError,
  isSystemError,
  isUserError,
} from '@packages/kernel/index.js';
import {
  GlobalExceptionFilter,
  UNKNOWN_FIELD_POLICIES,
  ZodValidationPipe,
  booleanQueryParam,
  createIdParamSchema,
  csvQueryParam,
  findDisallowedFields,
  intQueryParam,
  numericQueryParam,
  optionalQueryParam,
  positiveIntParamSchema,
  printableIdParamSchema,
  slugParamSchema,
  strictObjectSchema,
  stripDisallowedFields,
  uuidParamSchema,
  validateBody,
  validateParams,
  validateQuery,
  whitelistedObjectSchema,
} from '@packages/http/index.js';
import type { CoreI18nService } from '@packages/i18n/index.js';

describe('Unit: Validation & Error Handling (Task 2.2)', () => {
  describe('1. Kiểm tra dữ liệu Request Body (validateBody)', () => {
    const createUserSchema = z.object({
      email: z.string().email(),
      name: z.string().min(2).max(100),
      age: z.number().int().min(18).optional(),
      profile: z
        .object({
          bio: z.string().max(200),
        })
        .optional(),
    });

    it('should validate valid request body and return typed payload', () => {
      const payload = {
        email: 'user@example.com',
        name: 'Nguyen Van A',
        age: 25,
        profile: { bio: 'Backend Engineer' },
      };

      const parsed = validateBody(createUserSchema, payload);
      expect(parsed).toEqual(payload);
    });

    it('should throw ValidationAppException with source="body" when fields are invalid or missing', () => {
      try {
        validateBody(createUserSchema, {
          email: 'not-an-email',
          name: 'A',
          age: 12,
        });
        throw new Error('Expected ValidationAppException');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationAppException);
        const valErr = err as ValidationAppException;
        expect(valErr.statusCode).toBe(HTTP_STATUS_CODE.BAD_REQUEST);
        expect(valErr.code).toBe(HTTP_ERROR_CODE.VALIDATION_FAILED);
        expect(valErr.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: 'email', source: VALIDATION_SOURCE.BODY }),
            expect.objectContaining({ field: 'name', source: VALIDATION_SOURCE.BODY }),
            expect.objectContaining({ field: 'age', source: VALIDATION_SOURCE.BODY }),
          ]),
        );
      }
    });

    it('should reject non-object request body when schema expects an object', () => {
      expect(() => validateBody(createUserSchema, 'invalid-string-body')).toThrow(
        ValidationAppException,
      );
      try {
        validateBody(createUserSchema, ['array-not-object']);
      } catch (err) {
        const valErr = err as ValidationAppException;
        expect(valErr.code).toBe(HTTP_ERROR_CODE.INVALID_REQUEST_BODY);
        expect(valErr.details).toEqual([
          expect.objectContaining({
            code: VALIDATION_ISSUE_CODE.INVALID_TYPE,
            source: VALIDATION_SOURCE.BODY,
          }),
        ]);
      }
    });
  });

  describe('2. Kiểm tra Query Parameters (validateQuery)', () => {
    const filterQuerySchema = z.object({
      page: optionalQueryParam(intQueryParam({ min: 1 })).default(1),
      minScore: optionalQueryParam(numericQueryParam({ min: 0, max: 100 })),
      active: optionalQueryParam(booleanQueryParam()),
      tags: optionalQueryParam(csvQueryParam(z.string().min(1))),
    });

    it('should parse and coerce query parameters accurately', () => {
      const parsed = validateQuery(filterQuerySchema, {
        page: '3',
        minScore: '85.5',
        active: 'true',
        tags: 'nodejs,fastify,zod',
      });

      expect(parsed).toEqual({
        page: 3,
        minScore: 85.5,
        active: true,
        tags: ['nodejs', 'fastify', 'zod'],
      });
    });

    it('should treat empty query strings as undefined and apply defaults', () => {
      const parsed = validateQuery(filterQuerySchema, {
        page: '',
        minScore: '   ',
        active: '',
      });

      expect(parsed).toEqual({
        page: 1,
        minScore: undefined,
        active: undefined,
        tags: undefined,
      });
    });

    it('should throw ValidationAppException with source="query" on invalid query params', () => {
      try {
        validateQuery(filterQuerySchema, {
          page: '0',
          minScore: '150',
          active: 'not-a-bool',
        });
        throw new Error('Expected ValidationAppException');
      } catch (err) {
        const valErr = err as ValidationAppException;
        expect(valErr.statusCode).toBe(HTTP_STATUS_CODE.BAD_REQUEST);
        expect(valErr.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: 'page', source: VALIDATION_SOURCE.QUERY }),
            expect.objectContaining({ field: 'minScore', source: VALIDATION_SOURCE.QUERY }),
            expect.objectContaining({ field: 'active', source: VALIDATION_SOURCE.QUERY }),
          ]),
        );
      }
    });
  });

  describe('3. Kiểm tra Path Parameters (validateParams & Param Schemas)', () => {
    it('should validate UUID, positive integer, slug and printable ID path params', () => {
      const validUuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(validateParams(uuidParamSchema, validUuid)).toBe(validUuid);
      expect(validateParams(positiveIntParamSchema, '42')).toBe(42);
      expect(validateParams(slugParamSchema, 'khoa-hoc-nestjs-2026')).toBe('khoa-hoc-nestjs-2026');
      expect(validateParams(printableIdParamSchema, 'job_123:abc')).toBe('job_123:abc');

      const routeSchema = createIdParamSchema('courseId', uuidParamSchema);
      expect(validateParams(routeSchema, { courseId: validUuid })).toEqual({
        courseId: validUuid,
      });
    });

    it('should throw ValidationAppException with source="params" on invalid path parameters', () => {
      expect(() => validateParams(uuidParamSchema, 'invalid-uuid')).toThrow(ValidationAppException);
      expect(() => validateParams(positiveIntParamSchema, '0')).toThrow(ValidationAppException);
      expect(() => validateParams(positiveIntParamSchema, '-5')).toThrow(ValidationAppException);
      expect(() => validateParams(positiveIntParamSchema, '12abc')).toThrow(ValidationAppException);
      expect(() => validateParams(slugParamSchema, 'Invalid_Slug!')).toThrow(ValidationAppException);
      expect(() => validateParams(printableIdParamSchema, 'bad\u0000id')).toThrow(
        ValidationAppException,
      );

      try {
        const routeSchema = createIdParamSchema('id', uuidParamSchema);
        validateParams(routeSchema, { id: 'bad-id' });
      } catch (err) {
        const valErr = err as ValidationAppException;
        expect(valErr.details).toEqual([
          expect.objectContaining({
            field: 'id',
            source: VALIDATION_SOURCE.PARAMS,
          }),
        ]);
      }
    });
  });

  describe('4. Loại bỏ hoặc Chặn field không được phép gửi lên (Strip & Reject Disallowed Fields)', () => {
    const updateProfileSchema = z.object({
      displayName: z.string().min(1),
      settings: z
        .object({
          theme: z.enum(['light', 'dark']),
        })
        .optional(),
    });

    it('should automatically strip disallowed fields at root and nested levels by default (Mass Assignment protection)', () => {
      const maliciousPayload = {
        displayName: 'Thanh Hai',
        isAdmin: true,
        role: 'SUPER_ADMIN',
        balance: 9999999,
        settings: {
          theme: 'dark',
          internalDebugFlag: true,
        },
      };

      const sanitized = validateBody(updateProfileSchema, maliciousPayload);
      expect(sanitized).toEqual({
        displayName: 'Thanh Hai',
        settings: {
          theme: 'dark',
        },
      });
      expect((sanitized as Record<string, unknown>)['isAdmin']).toBeUndefined();
      expect((sanitized as Record<string, unknown>)['role']).toBeUndefined();
      expect(
        (sanitized.settings as Record<string, unknown> | undefined)?.['internalDebugFlag'],
      ).toBeUndefined();
    });

    it('should reject and report every disallowed field when unknownFields="reject" or strictObjectSchema is used', () => {
      const payloadWithForbiddenFields = {
        displayName: 'Thanh Hai',
        isAdmin: true,
        settings: {
          theme: 'light',
          secretToken: 'xyz',
        },
      };

      try {
        validateBody(updateProfileSchema, payloadWithForbiddenFields, {
          unknownFields: UNKNOWN_FIELD_POLICIES.REJECT,
        });
        throw new Error('Expected ValidationAppException for unrecognized fields');
      } catch (err) {
        const valErr = err as ValidationAppException;
        expect(valErr.statusCode).toBe(HTTP_STATUS_CODE.BAD_REQUEST);
        expect(valErr.code).toBe(HTTP_ERROR_CODE.UNRECOGNIZED_FIELDS);
        expect(valErr.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'isAdmin',
              code: VALIDATION_ISSUE_CODE.UNRECOGNIZED_KEYS,
              source: VALIDATION_SOURCE.BODY,
            }),
            expect.objectContaining({
              field: 'settings.secretToken',
              code: VALIDATION_ISSUE_CODE.UNRECOGNIZED_KEYS,
              source: VALIDATION_SOURCE.BODY,
            }),
          ]),
        );
      }

      const strictSchema = strictObjectSchema({ title: z.string() });
      expect(() => strictSchema.parse({ title: 'OK', hack: 1 })).toThrow();

      const strippedSchema = whitelistedObjectSchema({ title: z.string() });
      expect(strippedSchema.parse({ title: 'OK', extra: 123 })).toEqual({ title: 'OK' });
    });

    it('should support direct helper stripDisallowedFields and findDisallowedFields', () => {
      const raw = { a: 1, b: 2, isAdmin: true, passwordHash: 'xxx' };
      expect(stripDisallowedFields(raw, ['a', 'b'])).toEqual({ a: 1, b: 2 });
      expect(findDisallowedFields(raw, ['a', 'b'])).toEqual(['isAdmin', 'passwordHash']);
    });
  });

  describe('5. NestJS ZodValidationPipe Integration', () => {
    it('should infer source from ArgumentMetadata (body, query, param) and support scalar param key', () => {
      const bodyPipe = new ZodValidationPipe(z.object({ name: z.string() }));
      const bodyMeta: ArgumentMetadata = { type: 'body', metatype: Object };
      expect(bodyPipe.transform({ name: 'Test', extraField: 'removed' }, bodyMeta)).toEqual({
        name: 'Test',
      });

      const paramPipe = new ZodValidationPipe(positiveIntParamSchema);
      const paramMeta: ArgumentMetadata = { type: 'param', metatype: Number, data: 'userId' };
      expect(paramPipe.transform('15', paramMeta)).toBe(15);

      try {
        paramPipe.transform('invalid-id', paramMeta);
        throw new Error('Expected ValidationAppException');
      } catch (err) {
        const valErr = err as ValidationAppException;
        expect(valErr.details).toEqual([
          expect.objectContaining({
            field: 'userId',
            source: VALIDATION_SOURCE.PARAMS,
          }),
        ]);
      }
    });
  });

  describe('6 & 7. Danh sách mã lỗi dùng chung, Phân biệt lỗi người dùng / hệ thống & GlobalExceptionFilter', () => {
    it('should expose complete shared error code catalog', () => {
      expect(COMMON_ERROR_CODE).toBe(HTTP_ERROR_CODE);
      expect(VALIDATION_ERROR_CODE).toMatchObject({
        VALIDATION_FAILED: 'VALIDATION_FAILED',
        INVALID_REQUEST_BODY: 'INVALID_REQUEST_BODY',
        INVALID_QUERY_PARAMS: 'INVALID_QUERY_PARAMS',
        INVALID_PATH_PARAMS: 'INVALID_PATH_PARAMS',
        UNRECOGNIZED_FIELDS: 'UNRECOGNIZED_FIELDS',
        INVALID_JSON_PAYLOAD: 'INVALID_JSON_PAYLOAD',
      });
    });

    it('should accurately distinguish User/Client Errors (4xx) vs System Errors (5xx)', () => {
      // User / Client & Domain errors -> isUserError = true, isSystemError = false, isOperational = true
      const userExceptions = [
        new BadRequestAppException(),
        new ValidationAppException(),
        new DomainException('Rule violated'),
        new UnauthorizedAppException(),
        new ForbiddenAppException(),
        new NotFoundAppException(),
        new ConflictAppException(),
        new PayloadTooLargeAppException(),
        new UnsupportedMediaTypeAppException(),
        new UnprocessableEntityAppException(),
        new TooManyRequestsAppException(),
        new HttpException('Forbidden', HttpStatus.FORBIDDEN),
      ];

      for (const ex of userExceptions) {
        expect(isUserError(ex)).toBe(true);
        expect(isSystemError(ex)).toBe(false);
        const info = classifyError(ex);
        expect(info.isOperational).toBe(true);
        expect([ERROR_CATEGORY.CLIENT, ERROR_CATEGORY.DOMAIN]).toContain(info.category);
      }

      expect(new DomainException('Rule').category).toBe(ERROR_CATEGORY.DOMAIN);

      // System errors -> isSystemError = true, isUserError = false, isOperational = false
      const systemExceptions = [
        new InternalServerAppException(),
        new ServiceUnavailableAppException(),
        new HttpException('DB down', HttpStatus.INTERNAL_SERVER_ERROR),
        new Error('TypeError: Cannot read properties of undefined'),
      ];

      for (const ex of systemExceptions) {
        expect(isSystemError(ex)).toBe(true);
        expect(isUserError(ex)).toBe(false);
        const info = classifyError(ex);
        expect(info.isOperational).toBe(false);
        expect(info.category).toBe(ERROR_CATEGORY.SYSTEM);
      }
    });

    it('should handle Fastify parser errors (invalid JSON, 413, 415) as user errors without leaking internal stack logs', () => {
      const mockI18n = {
        t: jest.fn((key: string) => `vi:${key}`),
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

      // 1. Fastify Invalid JSON Body error
      filter.catch(
        {
          code: 'FST_ERR_CTP_INVALID_JSON_BODY',
          statusCode: 400,
          message: 'Unexpected token } in JSON at position 12',
        },
        host,
      );
      expect(capturedStatus).toBe(HTTP_STATUS_CODE.BAD_REQUEST);
      expect(capturedPayload).toMatchObject({
        success: false,
        statusCode: HTTP_STATUS_CODE.BAD_REQUEST,
        error: {
          code: HTTP_ERROR_CODE.INVALID_JSON_PAYLOAD,
          message: 'vi:INVALID_JSON_PAYLOAD',
        },
      });

      // 2. Fastify Body Too Large (413)
      filter.catch({ code: 'FST_ERR_CTP_BODY_TOO_LARGE', statusCode: 413 }, host);
      expect(capturedStatus).toBe(HTTP_STATUS_CODE.PAYLOAD_TOO_LARGE);
      expect(capturedPayload).toMatchObject({
        statusCode: HTTP_STATUS_CODE.PAYLOAD_TOO_LARGE,
        error: {
          code: HTTP_ERROR_CODE.PAYLOAD_TOO_LARGE,
          message: 'vi:PAYLOAD_TOO_LARGE',
        },
      });

      // 3. Fastify Unsupported Media Type (415)
      filter.catch({ code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE', statusCode: 415 }, host);
      expect(capturedStatus).toBe(HTTP_STATUS_CODE.UNSUPPORTED_MEDIA_TYPE);
      expect(capturedPayload).toMatchObject({
        statusCode: HTTP_STATUS_CODE.UNSUPPORTED_MEDIA_TYPE,
        error: {
          code: HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
          message: 'vi:UNSUPPORTED_MEDIA_TYPE',
        },
      });

      // 4. Raw 500 HttpException -> mask internal error message
      filter.catch(
        new HttpException('SELECT * FROM secret_table failed', HttpStatus.INTERNAL_SERVER_ERROR),
        host,
      );
      expect(capturedStatus).toBe(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR);
      expect(capturedPayload).toMatchObject({
        statusCode: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR,
        error: {
          code: HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR,
          message: 'vi:INTERNAL_SERVER_ERROR',
        },
      });
    });
  });
});
