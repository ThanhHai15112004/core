import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ApiDoc,
  ApiGroup,
  Public,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
} from '@packages/http/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import {
  type ImportSamlMetadataRequest,
  ImportSamlMetadataRequestSchema,
  providerCodeParamSchema,
  type SamlAcsRequest,
  SamlAcsRequestSchema,
  type SamlExchangeRequest,
  SamlExchangeRequestSchema,
} from '../requests/federated-identity.requests.js';
import { FEDERATED_IDENTITY_ROUTES } from '../routes/federated-identity.routes.js';
import { SamlSsoService } from '../services/saml-sso.service.js';
import type {
  OAuthCallbackResult,
  SamlMetadataImportResult,
} from '../types/federated-identity.types.js';

function extractRequestMeta(req?: FastifyRequest): {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
} {
  const uaHeader = req?.headers?.['user-agent'];
  return {
    ipAddress: req?.ip ?? null,
    userAgent: typeof uaHeader === 'string' ? uaHeader : null,
  };
}

function resolveDefaultAcsMode(req?: FastifyRequest): 'redirect' | 'json' {
  const contentType = String(req?.headers?.['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return 'redirect';
  }
  return 'json';
}

@ApiGroup(
  'Federated Identity — Enterprise SAML 2.0 SSO',
  'Cung cấp SP Metadata XML, nhập IdP Metadata, tiếp nhận SAMLResponse tại ACS (HTTP-POST), kiểm tra chữ ký XMLDSig/Audience/Time/Anti-Replay và đổi mã phiên an toàn cho SPA.',
)
@Controller(FEDERATED_IDENTITY_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class SamlSsoController {
  constructor(private readonly samlSsoService: SamlSsoService) {}

  @Public()
  @Get(FEDERATED_IDENTITY_ROUTES.SAML_METADATA)
  @ApiDoc({ summary: 'Xuất tài liệu Service Provider (SP) SAML 2.0 Metadata XML' })
  public async getSpMetadata(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const xml = await this.samlSsoService.getSpMetadataXml(params.providerCode);
    reply.header('Content-Type', 'application/samlmetadata+xml; charset=utf-8').send(xml);
  }

  @Post(FEDERATED_IDENTITY_ROUTES.SAML_METADATA_IMPORT)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('federated-identity.manage')
  @ApiDoc({
    summary:
      'Nhập IdP SAML 2.0 Metadata XML hoặc URL (hỗ trợ Certificate Rotation với thời gian chuyển tiếp)',
  })
  public async importIdpMetadata(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
    @ValidatedBody(ImportSamlMetadataRequestSchema) body: ImportSamlMetadataRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<SamlMetadataImportResult> {
    return this.samlSsoService.importIdpMetadata(params.providerCode, body, actor);
  }

  @Public()
  @Post(FEDERATED_IDENTITY_ROUTES.SAML_ACS)
  @ApiDoc({
    summary:
      'Assertion Consumer Service (ACS) tiếp nhận SAMLResponse (HTTP-POST form hoặc JSON API test)',
  })
  public async handleAcs(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
    @ValidatedBody(SamlAcsRequestSchema) body: SamlAcsRequest,
    @Res() reply: FastifyReply,
    @CurrentUser() actor?: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<void> {
    const meta = extractRequestMeta(req);
    const outcome = await this.samlSsoService.handleAcs(params.providerCode, body, {
      responseMode: resolveDefaultAcsMode(req),
      context: {
        actorUserId: actor?.id ?? null,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });

    if (outcome.mode === 'redirect') {
      reply.status(HttpStatus.FOUND).redirect(outcome.redirectUrl);
      return;
    }

    reply.status(HttpStatus.OK).send({
      success: true,
      statusCode: HttpStatus.OK,
      data: outcome.result,
      timestamp: new Date().toISOString(),
    });
  }

  @Public()
  @Post(FEDERATED_IDENTITY_ROUTES.SAML_EXCHANGE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đổi samlCode dùng một lần từ ACS redirect lấy phiên đăng nhập hoặc liên kết',
  })
  public async exchangeSamlCode(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
    @ValidatedBody(SamlExchangeRequestSchema) body: SamlExchangeRequest,
    @CurrentUser() actor?: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<OAuthCallbackResult> {
    const meta = extractRequestMeta(req);
    return this.samlSsoService.exchangeSamlCode(params.providerCode, body, {
      actorUserId: actor?.id ?? null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}
