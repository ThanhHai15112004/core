import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiDoc, ApiGroup, Public } from '@packages/http/index.js';
import { SCIM_CONTENT_TYPE } from '../enum/identity-provisioning.enum.js';
import { ScimClientAuthGuard } from '../guards/scim-client-auth.guard.js';
import { ScimExceptionFilter, ScimProtocolException } from '../helpers/scim-error.helper.js';
import {
  buildScimResourceTypes,
  buildScimSchemas,
  buildScimServiceProviderConfig,
} from '../helpers/scim-mapper.helper.js';
import { normalizeCallerIp } from '../helpers/scim-security.helper.js';
import {
  ScimListQuerySchema,
  ScimPatchBodySchema,
} from '../requests/identity-provisioning.requests.js';
import { SCIM_PROTOCOL_ROUTES } from '../routes/identity-provisioning.routes.js';
import { ScimGroupsService } from '../services/scim-groups.service.js';
import { ScimUsersService } from '../services/scim-users.service.js';
import type {
  ScimAuthenticatedRequest,
  ScimRequestMeta,
} from '../types/identity-provisioning.types.js';

function headerValue(raw?: string | string[]): string | null {
  if (!raw) return null;
  const val = Array.isArray(raw) ? raw[0] : raw;
  return val?.trim() || null;
}

function resolveScimBaseUrl(req: ScimAuthenticatedRequest): string {
  const rawUrl = req.url ?? '/api/v1/scim/v2';
  const pathOnly = rawUrl.split('?')[0] ?? '/api/v1/scim/v2';
  const idx = pathOnly.indexOf('/scim/v2');
  const prefix = idx >= 0 ? pathOnly.slice(0, idx + '/scim/v2'.length) : '/api/v1/scim/v2';
  const proto = headerValue(req.headers['x-forwarded-proto']) ?? req.protocol ?? 'http';
  const host = headerValue(req.headers['x-forwarded-host']) ?? headerValue(req.headers['host']);
  return host ? `${proto}://${host}${prefix}` : prefix;
}

function buildMeta(req: ScimAuthenticatedRequest): ScimRequestMeta {
  return {
    ipAddress: normalizeCallerIp(req.ip ?? null),
    requestId: headerValue(req.headers['x-request-id']),
    correlationId: headerValue(req.headers['x-correlation-id']),
    httpMethod: req.method ?? 'GET',
    httpPath: req.url ?? '/scim/v2',
    baseUrl: resolveScimBaseUrl(req),
  };
}

function requireAuthenticatedClient(req: ScimAuthenticatedRequest) {
  if (!req.scimClient) {
    throw new ScimProtocolException(401, 'Missing authenticated SCIM client');
  }
  return req.scimClient;
}

@ApiGroup(
  'Identity Provisioning — SCIM 2.0 Protocol',
  'Endpoint chuẩn RFC 7643/7644 (`application/scim+json`) cho hệ thống quản lý danh tính doanh nghiệp (Okta, Microsoft Entra ID, Keycloak) đồng bộ Users, Groups, ETag và deprovision.',
)
@Controller(SCIM_PROTOCOL_ROUTES.PREFIX)
@Public()
@UseGuards(ScimClientAuthGuard)
@UseFilters(ScimExceptionFilter)
export class ScimProtocolController {
  constructor(
    private readonly scimUsersService: ScimUsersService,
    private readonly scimGroupsService: ScimGroupsService,
  ) {}

  @Get(SCIM_PROTOCOL_ROUTES.SERVICE_PROVIDER_CONFIG)
  @ApiDoc({ summary: 'SCIM 2.0 ServiceProviderConfig' })
  public getServiceProviderConfig(
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): void {
    void reply
      .status(HttpStatus.OK)
      .header('Content-Type', SCIM_CONTENT_TYPE)
      .send(buildScimServiceProviderConfig(resolveScimBaseUrl(req)));
  }

  @Get(SCIM_PROTOCOL_ROUTES.RESOURCE_TYPES)
  @ApiDoc({ summary: 'SCIM 2.0 ResourceTypes' })
  public getResourceTypes(
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): void {
    void reply
      .status(HttpStatus.OK)
      .header('Content-Type', SCIM_CONTENT_TYPE)
      .send(buildScimResourceTypes(resolveScimBaseUrl(req)));
  }

  @Get(SCIM_PROTOCOL_ROUTES.SCHEMAS)
  @ApiDoc({ summary: 'SCIM 2.0 Schemas' })
  public getSchemas(
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): void {
    void reply
      .status(HttpStatus.OK)
      .header('Content-Type', SCIM_CONTENT_TYPE)
      .send(buildScimSchemas(resolveScimBaseUrl(req)));
  }

  @Get(SCIM_PROTOCOL_ROUTES.USERS)
  @ApiDoc({ summary: 'Tìm kiếm & liệt kê người dùng qua SCIM 2.0 Users' })
  public async listUsers(
    @Query() rawQuery: Record<string, unknown>,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    const query = ScimListQuerySchema.parse(rawQuery);
    const result = await this.scimUsersService.listUsers(client, query, buildMeta(req));
    void reply.status(HttpStatus.OK).header('Content-Type', SCIM_CONTENT_TYPE).send(result);
  }

  @Post(SCIM_PROTOCOL_ROUTES.USERS)
  @ApiDoc({ summary: 'Tạo người dùng mới qua SCIM 2.0 (Idempotent theo External ID)' })
  public async createUser(
    @Body() body: unknown,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    const outcome = await this.scimUsersService.createUser(client, body, buildMeta(req));
    const status = outcome.created ? HttpStatus.CREATED : HttpStatus.OK;
    const builder = reply
      .status(status)
      .header('Content-Type', SCIM_CONTENT_TYPE)
      .header('ETag', outcome.resource.meta.version);
    if (outcome.created && outcome.resource.meta.location) {
      builder.header('Location', outcome.resource.meta.location);
    }
    void builder.send(outcome.resource);
  }

  @Get(SCIM_PROTOCOL_ROUTES.USER_BY_ID)
  @ApiDoc({ summary: 'Lấy chi tiết người dùng SCIM 2.0 theo ID' })
  public async getUser(
    @Param('id') id: string,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    const resource = await this.scimUsersService.getUser(client, id, buildMeta(req));
    void reply
      .status(HttpStatus.OK)
      .header('Content-Type', SCIM_CONTENT_TYPE)
      .header('ETag', resource.meta.version)
      .send(resource);
  }

  @Put(SCIM_PROTOCOL_ROUTES.USER_BY_ID)
  @ApiDoc({ summary: 'Cập nhật toàn bộ người dùng SCIM 2.0 (hỗ trợ ETag / If-Match)' })
  public async replaceUser(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    const outcome = await this.scimUsersService.replaceUser(
      client,
      id,
      body,
      req.headers['if-match'],
      buildMeta(req),
    );
    void reply
      .status(HttpStatus.OK)
      .header('Content-Type', SCIM_CONTENT_TYPE)
      .header('ETag', outcome.resource.meta.version)
      .send(outcome.resource);
  }

  @Patch(SCIM_PROTOCOL_ROUTES.USER_BY_ID)
  @ApiDoc({ summary: 'Cập nhật từng phần / khóa / mở khóa người dùng qua SCIM 2.0 PATCH' })
  public async patchUser(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    const parsedBody = ScimPatchBodySchema.parse(body);
    const outcome = await this.scimUsersService.patchUser(
      client,
      id,
      parsedBody,
      req.headers['if-match'],
      buildMeta(req),
    );
    void reply
      .status(HttpStatus.OK)
      .header('Content-Type', SCIM_CONTENT_TYPE)
      .header('ETag', outcome.resource.meta.version)
      .send(outcome.resource);
  }

  @Delete(SCIM_PROTOCOL_ROUTES.USER_BY_ID)
  @ApiDoc({ summary: 'Ngừng cung cấp người dùng qua SCIM 2.0 (khóa tài khoản & thu hồi toàn bộ phiên)' })
  public async deleteUser(
    @Param('id') id: string,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    await this.scimUsersService.deleteUser(client, id, req.headers['if-match'], buildMeta(req));
    void reply.status(HttpStatus.NO_CONTENT).send();
  }

  @Get(SCIM_PROTOCOL_ROUTES.GROUPS)
  @ApiDoc({ summary: 'Tìm kiếm & liệt kê nhóm SCIM 2.0' })
  public async listGroups(
    @Query() rawQuery: Record<string, unknown>,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    const query = ScimListQuerySchema.parse(rawQuery);
    const result = await this.scimGroupsService.listGroups(client, query, buildMeta(req));
    void reply.status(HttpStatus.OK).header('Content-Type', SCIM_CONTENT_TYPE).send(result);
  }

  @Post(SCIM_PROTOCOL_ROUTES.GROUPS)
  @ApiDoc({ summary: 'Tạo nhóm SCIM 2.0 và đồng bộ thành viên/vai trò theo allowlist' })
  public async createGroup(
    @Body() body: unknown,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    const outcome = await this.scimGroupsService.createGroup(client, body, buildMeta(req));
    const status = outcome.created ? HttpStatus.CREATED : HttpStatus.OK;
    const builder = reply
      .status(status)
      .header('Content-Type', SCIM_CONTENT_TYPE)
      .header('ETag', outcome.resource.meta.version);
    if (outcome.created && outcome.resource.meta.location) {
      builder.header('Location', outcome.resource.meta.location);
    }
    void builder.send(outcome.resource);
  }

  @Get(SCIM_PROTOCOL_ROUTES.GROUP_BY_ID)
  @ApiDoc({ summary: 'Lấy chi tiết nhóm SCIM 2.0 theo ID' })
  public async getGroup(
    @Param('id') id: string,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    const resource = await this.scimGroupsService.getGroup(client, id, buildMeta(req));
    void reply
      .status(HttpStatus.OK)
      .header('Content-Type', SCIM_CONTENT_TYPE)
      .header('ETag', resource.meta.version)
      .send(resource);
  }

  @Put(SCIM_PROTOCOL_ROUTES.GROUP_BY_ID)
  @ApiDoc({ summary: 'Cập nhật toàn bộ nhóm & danh sách thành viên SCIM 2.0' })
  public async replaceGroup(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    const outcome = await this.scimGroupsService.replaceGroup(
      client,
      id,
      body,
      req.headers['if-match'],
      buildMeta(req),
    );
    void reply
      .status(HttpStatus.OK)
      .header('Content-Type', SCIM_CONTENT_TYPE)
      .header('ETag', outcome.resource.meta.version)
      .send(outcome.resource);
  }

  @Patch(SCIM_PROTOCOL_ROUTES.GROUP_BY_ID)
  @ApiDoc({ summary: 'Cập nhật thành viên nhóm SCIM 2.0 (PATCH add/replace/remove)' })
  public async patchGroup(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    const parsedBody = ScimPatchBodySchema.parse(body);
    const outcome = await this.scimGroupsService.patchGroup(
      client,
      id,
      parsedBody,
      req.headers['if-match'],
      buildMeta(req),
    );
    void reply
      .status(HttpStatus.OK)
      .header('Content-Type', SCIM_CONTENT_TYPE)
      .header('ETag', outcome.resource.meta.version)
      .send(outcome.resource);
  }

  @Delete(SCIM_PROTOCOL_ROUTES.GROUP_BY_ID)
  @ApiDoc({ summary: 'Xóa nhóm SCIM 2.0 và gỡ vai trò tương ứng của thành viên' })
  public async deleteGroup(
    @Param('id') id: string,
    @Req() req: ScimAuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const client = requireAuthenticatedClient(req);
    await this.scimGroupsService.deleteGroup(client, id, req.headers['if-match'], buildMeta(req));
    void reply.status(HttpStatus.NO_CONTENT).send();
  }
}
