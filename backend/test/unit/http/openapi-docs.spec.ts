import { describe, it, expect, jest } from '@jest/globals';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import {
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  HTTP_STATUS_CODE,
} from '@packages/kernel/index.js';
import {
  ApiDoc,
  ApiGroup,
  BREAKING_CHANGE_RULES,
  OPENAPI_VERSION,
  Public,
  RequirePermissions,
  RequireRoles,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  buildOpenApiDocumentFromControllers,
  convertOpenApiToPostmanCollection,
  detectOpenApiBreakingChanges,
  generateSchemaExample,
  intQueryParam,
  normalizeDocsPath,
  optionalQueryParam,
  renderScalarApiReferenceHtml,
  uuidParamSchema,
  zodSchemaToOpenApiSchema,
} from '@packages/http/index.js';
import { AuthGuard, type TokenService } from '@packages/security/index.js';
import { OpenApiCommand } from '@apps/cli/commands/architecture/openapi.command.js';
import { ArchitectureLinterService } from '@apps/cli/services/architecture-linter.service.js';
import { ManifestService } from '@apps/cli/services/manifest.service.js';

const createCourseBodySchema = z.object({
  title: z.string().min(3).max(120),
  slug: z.string().min(3),
  price: z.number().min(0),
});

const listCourseQuerySchema = z.object({
  page: optionalQueryParam(intQueryParam({ min: 1 })).default(1),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 100 })).default(20),
  status: z.enum(['draft', 'published']).optional(),
});

const courseResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  price: z.number(),
  createdAt: z.string(),
});

@ApiGroup('Courses Management', 'Quản lý danh mục khóa học mẫu')
@Controller('courses')
class SampleCoursesController {
  @Public()
  @Get()
  @ApiDoc({
    summary: 'Lấy danh sách khóa học có phân trang',
    description: 'Truy vấn danh sách khóa học công khai hỗ trợ lọc theo trạng thái.',
    response: courseResponseSchema,
    pagination: 'offset',
  })
  public list(@ValidatedQuery(listCourseQuerySchema) _query: unknown) {
    return [];
  }

  @RequireRoles('ADMIN', 'INSTRUCTOR')
  @RequirePermissions('courses:create')
  @Post()
  @ApiDoc({
    summary: 'Tạo khóa học mới',
    response: courseResponseSchema,
    requestExample: {
      title: 'NestJS High Performance Architecture',
      slug: 'nestjs-high-performance-architecture',
      price: 499000,
    },
    errorCodes: [HTTP_ERROR_CODE.CONFLICT],
  })
  public create(@ValidatedBody(createCourseBodySchema) _body: unknown) {
    return {};
  }

  @RequirePermissions('courses:delete')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDoc({
    summary: 'Xóa khóa học theo ID',
    status: HTTP_STATUS_CODE.NO_CONTENT,
  })
  public remove(@ValidatedParams(uuidParamSchema, 'id') _id: string) {
    return undefined;
  }
}

describe('Unit: Scalar UI, OpenAPI 3.1 & Breaking Change Detector (Task 2.3)', () => {
  describe('1. Scalar UI & OpenAPI 3.1 Document Setup', () => {
    it('should render Scalar API Reference HTML with dark mode, Ctrl+K hotkey and spec URLs', () => {
      expect(normalizeDocsPath('///docs///')).toBe('/docs');
      const html = renderScalarApiReferenceHtml({
        title: 'Core API Portal',
        openApiJsonUrl: '/docs/openapi.json',
        postmanJsonUrl: '/docs/postman.json',
      });

      expect(html).toContain('<!doctype html>');
      expect(html).toContain('Core API Portal');
      expect(html).toContain('data-url="/docs/openapi.json"');
      expect(html).toContain('@scalar/api-reference');
      expect(html).toContain('/docs/postman.json');
    });

    it('should build valid OpenAPI 3.1.0 document and Postman v2.1 collection from controllers', () => {
      const doc = buildOpenApiDocumentFromControllers([SampleCoursesController], {
        title: 'Core Test API',
        version: '1.2.0',
        apiPrefix: 'api/v1',
      });

      expect(doc.openapi).toBe(OPENAPI_VERSION);
      expect(doc.info.title).toBe('Core Test API');
      expect(doc.tags).toEqual([
        {
          name: 'Courses Management',
          description: 'Quản lý danh mục khóa học mẫu',
        },
      ]);
      expect(Object.keys(doc.paths)).toEqual(['/api/v1/courses', '/api/v1/courses/{id}']);

      const postman = convertOpenApiToPostmanCollection(doc);
      expect(postman.info.name).toBe('Core Test API');
      expect(postman.item.length).toBe(1);
      expect(postman.item[0]?.name).toBe('Courses Management');
      expect(postman.item[0]?.item.length).toBe(3);
    });
  });

  describe('2. Request & Response Schema Extraction (Zero-Duplicate-DTO)', () => {
    it('should automatically extract query, path and body schemas from @Validated* decorators and wrap responses in standard envelopes', () => {
      const doc = buildOpenApiDocumentFromControllers([SampleCoursesController]);
      const listOp = doc.paths['/api/v1/courses']?.get;
      const createOp = doc.paths['/api/v1/courses']?.post;
      const deleteOp = doc.paths['/api/v1/courses/{id}']?.delete;

      expect(listOp).toBeDefined();
      expect(listOp?.parameters?.map((p) => p.name)).toEqual(['page', 'limit', 'status']);
      expect(
        listOp?.responses['200']?.content?.['application/json']?.schema.properties,
      ).toHaveProperty('meta');

      expect(createOp).toBeDefined();
      const bodySchema = createOp?.requestBody?.content['application/json']?.schema;
      expect(bodySchema?.required).toEqual(['title', 'slug', 'price']);
      expect(createOp?.responses['201']).toBeDefined();
      expect(createOp?.responses['400']).toBeDefined();
      expect(createOp?.responses['409']).toBeDefined();

      expect(deleteOp).toBeDefined();
      expect(deleteOp?.parameters?.[0]).toMatchObject({
        name: 'id',
        in: 'path',
        required: true,
      });
      expect(deleteOp?.responses['204']).toBeDefined();
    });
  });

  describe('3. API Permissions & Access Control Documentation + AuthGuard Enforcement', () => {
    it('should document @Public, Bearer JWT, @RequireRoles and @RequirePermissions in OpenAPI operations', () => {
      const doc = buildOpenApiDocumentFromControllers([SampleCoursesController]);
      const listOp = doc.paths['/api/v1/courses']?.get;
      const createOp = doc.paths['/api/v1/courses']?.post;

      expect(listOp?.['x-public']).toBe(true);
      expect(listOp?.security).toEqual([]);

      expect(createOp?.['x-public']).toBe(false);
      expect(createOp?.security).toEqual([{ bearerAuth: [] }]);
      expect(createOp?.['x-required-roles']).toEqual(['ADMIN', 'INSTRUCTOR']);
      expect(createOp?.['x-required-permissions']).toEqual(['courses:create']);
      expect(createOp?.description).toContain('courses:create');
      expect(createOp?.responses['401']).toBeDefined();
      expect(createOp?.responses['403']).toBeDefined();
    });

    it('should enforce @RequireRoles and @RequirePermissions in AuthGuard', async () => {
      const reflector = new Reflector();
      const mockTokenService = {
        verify: jest.fn(async () => ({ sub: 'u1' })),
        validateUser: jest.fn(async () => ({
          id: 'u1',
          roles: ['STUDENT'],
          permissions: ['courses:read'],
        })),
      } as unknown as TokenService;

      const guard = new AuthGuard(reflector, mockTokenService);
      const createHandler = SampleCoursesController.prototype.create;

      const mockContext = {
        getHandler: () => createHandler,
        getClass: () => SampleCoursesController,
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: 'Bearer valid_jwt_token' },
          }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(mockContext)).rejects.toBeInstanceOf(ForbiddenAppException);
    });
  });

  describe('4. Example Data Synthesis (Explicit & Automatic)', () => {
    it('should synthesize realistic examples for UUID, email, timestamp, slug, enum and numbers', () => {
      const schema = zodSchemaToOpenApiSchema(courseResponseSchema);
      const example = generateSchemaExample(schema) as Record<string, unknown>;

      expect(example['id']).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(example['slug']).toBe('core-resource-item');
      expect(example['createdAt']).toBe('2026-10-14T10:00:00.000Z');
      expect(typeof example['price']).toBe('number');
    });
  });

  describe('5 & 6. OpenAPI Breaking Change Detection (detectOpenApiBreakingChanges)', () => {
    it('should pass when adding non-breaking endpoints or optional fields', () => {
      const baseline = buildOpenApiDocumentFromControllers([SampleCoursesController]);
      const current = structuredClone(baseline);

      // Thêm một optional query parameter mới -> Non-breaking
      const getOp = current.paths['/api/v1/courses']?.get;
      if (getOp && getOp.parameters) {
        (getOp as unknown as { parameters: unknown[] }).parameters = [
          ...getOp.parameters,
          {
            name: 'search',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
        ];
      }

      const report = detectOpenApiBreakingChanges(baseline, current);
      expect(report.passed).toBe(true);
      expect(report.breakingChanges).toHaveLength(0);
    });

    it('should detect all 7 categories of breaking API changes accurately', () => {
      const baseline = buildOpenApiDocumentFromControllers([SampleCoursesController]);
      const broken = structuredClone(baseline);

      // 1. Xóa endpoint DELETE /api/v1/courses/{id}
      delete broken.paths['/api/v1/courses/{id}'];

      // 2. Chuyển GET /api/v1/courses từ Public sang Authenticated + Thêm required query param
      const getOp = broken.paths['/api/v1/courses']?.get as unknown as Record<string, unknown>;
      getOp['x-public'] = false;
      getOp['security'] = [{ bearerAuth: [] }];
      getOp['parameters'] = [
        ...(baseline.paths['/api/v1/courses']?.get?.parameters ?? []),
        {
          name: 'tenantId',
          in: 'query',
          required: true,
          schema: { type: 'string' },
        },
      ];

      // 3. Thêm trường bắt buộc mới vào POST body & Xóa trường trong Response data
      const postOp = broken.paths['/api/v1/courses']?.post;
      const bodySchema = postOp?.requestBody?.content['application/json']?.schema as {
        required: string[];
        properties: Record<string, unknown>;
      };
      bodySchema.required.push('categoryId');
      delete bodySchema.properties['slug'];

      const respEnvelope = postOp?.responses['201']?.content?.['application/json']?.schema;
      const respDataProps = (
        respEnvelope?.properties?.['data'] as { properties?: Record<string, unknown> }
      )?.properties;
      if (respDataProps) {
        delete respDataProps['price'];
      }

      const report = detectOpenApiBreakingChanges(baseline, broken);
      expect(report.passed).toBe(false);

      const triggeredRules = report.breakingChanges.map((i) => i.rule);
      expect(triggeredRules).toEqual(
        expect.arrayContaining([
          BREAKING_CHANGE_RULES.ENDPOINT_REMOVED,
          BREAKING_CHANGE_RULES.SECURITY_TIGHTENED,
          BREAKING_CHANGE_RULES.REQUIRED_PARAM_ADDED,
          BREAKING_CHANGE_RULES.REQUIRED_BODY_FIELD_ADDED,
          BREAKING_CHANGE_RULES.BODY_FIELD_REMOVED_OR_TYPE_CHANGED,
          BREAKING_CHANGE_RULES.RESPONSE_FIELD_REMOVED_OR_TYPE_CHANGED,
        ]),
      );
    });

    it('should export baseline OpenAPI & Postman files and pass CLI breaking change & architecture checks', async () => {
      const manifestService = new ManifestService();
      const command = new OpenApiCommand(manifestService);
      await command.exportOpenApi([]);

      const openApiPath = resolve(process.cwd(), 'openapi/openapi.v1.json');
      const postmanPath = resolve(process.cwd(), 'openapi/postman.v1.json');
      expect(existsSync(openApiPath)).toBe(true);
      expect(existsSync(postmanPath)).toBe(true);

      await expect(command.checkBreakingChanges([])).resolves.toBeUndefined();

      const linter = new ArchitectureLinterService(manifestService);
      const report = await linter.check();
      expect(report.passed).toBe(true);
      expect(report.violations).toEqual([]);
    });
  });
});
