import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CoreConfigService } from '@packages/config/index.js';
import {
  DEFAULT_API_DOCS_PATH,
  type OpenApiDocument,
  type PostmanCollection,
  buildOpenApiDocumentFromControllers,
  collectControllersFromRootModule,
  convertOpenApiToPostmanCollection,
  normalizeApiPrefix,
  normalizeDocsPath,
  renderScalarApiReferenceHtml,
} from '@packages/http/index.js';
import { ApiModule } from '../api.module.js';

export interface SetupApiDocsOptions {
  readonly docsPath?: string;
  readonly title?: string;
  readonly version?: string;
  readonly description?: string;
}

/**
 * Xây dựng tài liệu OpenAPI 3.1.0 và Postman Collection v2.1.0 cho toàn bộ các Controller thuộc `ApiModule`.
 */
export function generateCoreApiDocs(options?: {
  title?: string;
  version?: string;
  description?: string;
  apiPrefix?: string;
}): {
  openApiDocument: OpenApiDocument;
  postmanCollection: PostmanCollection;
} {
  const controllers = collectControllersFromRootModule(ApiModule);
  const openApiDocument = buildOpenApiDocumentFromControllers(controllers, {
    title: options?.title ?? 'Core Framework HTTP API',
    version: options?.version ?? '1.0.0',
    ...(options?.description ? { description: options.description } : {}),
    ...(options?.apiPrefix ? { apiPrefix: options.apiPrefix } : {}),
  });
  const postmanCollection = convertOpenApiToPostmanCollection(openApiDocument);
  return { openApiDocument, postmanCollection };
}

/**
 * Bước khởi tạo tài liệu API tương tác **Scalar UI** & **OpenAPI 3.1** trên Fastify instance:
 * - `GET /docs`: Giao diện Scalar API Reference 3 cột hiện đại.
 * - `GET /docs/openapi.json`: Đặc tả chuẩn OpenAPI 3.1.0.
 * - `GET /docs/postman.json`: Postman Collection v2.1.0.
 */
export function setupApiDocs(
  app: NestFastifyApplication,
  options: SetupApiDocsOptions = {},
): OpenApiDocument {
  const configService = app.get(CoreConfigService);
  const apiPrefix = normalizeApiPrefix(configService.app.apiPrefix);
  const basePath = normalizeDocsPath(options.docsPath ?? DEFAULT_API_DOCS_PATH);
  const openApiJsonPath = `${basePath}/openapi.json`;
  const postmanJsonPath = `${basePath}/postman.json`;
  const title = options.title ?? `${configService.app.name} — HTTP API Reference`;

  const { openApiDocument, postmanCollection } = generateCoreApiDocs({
    title,
    ...(options.version ? { version: options.version } : {}),
    ...(options.description ? { description: options.description } : {}),
    apiPrefix,
  });

  const html = renderScalarApiReferenceHtml({
    title,
    openApiJsonUrl: openApiJsonPath,
    postmanJsonUrl: postmanJsonPath,
  });

  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;

  fastify.get(basePath, (_req: FastifyRequest, reply: FastifyReply) => {
    void reply.type('text/html; charset=utf-8').send(html);
  });

  fastify.get(openApiJsonPath, (_req: FastifyRequest, reply: FastifyReply) => {
    void reply.type('application/json; charset=utf-8').send(openApiDocument);
  });

  fastify.get(postmanJsonPath, (_req: FastifyRequest, reply: FastifyReply) => {
    void reply.type('application/json; charset=utf-8').send(postmanCollection);
  });

  return openApiDocument;
}
