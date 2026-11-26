import { Controller, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ApiDoc,
  ApiGroup,
  Public,
  type RawBodyRequest,
  ValidatedParams,
  resolveClientIp,
} from '@packages/http/index.js';
import { providerCodeParamSchema } from '../requests/inbound-webhooks.requests.js';
import { INBOUND_WEBHOOKS_ROUTES } from '../routes/inbound-webhooks.routes.js';
import { InboundWebhooksService } from '../services/inbound-webhooks.service.js';
import type { ReceiveInboundWebhookResult } from '../types/inbound-webhooks.types.js';

@ApiGroup(
  'Inbound Webhooks — Receiver',
  'Endpoint công khai tiếp nhận Webhook từ hệ thống ngoài theo từng provider: xác minh chữ ký/token, kiểm tra timestamp chống replay, chống xử lý trùng theo Idempotency, lưu payload đã redact và đẩy Queue.',
)
@Controller(INBOUND_WEBHOOKS_ROUTES.PREFIX)
export class InboundWebhooksReceiveController {
  constructor(private readonly inboundWebhooksService: InboundWebhooksService) {}

  @Public()
  @Post(INBOUND_WEBHOOKS_ROUTES.RECEIVE_BY_PROVIDER)
  @ApiDoc({
    summary: 'Nhận Webhook từ hệ thống ngoài theo mã Provider',
    description:
      'Xác minh chữ ký HMAC/Token trên rawBody, kiểm tra timestamp trong tolerance window, chống trùng lặp theo Idempotency key, lưu payload đã che dữ liệu nhạy cảm và đẩy job vào Queue. Trả 202 Accepted cho sự kiện mới hoặc 200 OK cho sự kiện trùng hợp lệ.',
  })
  public async receiveByProvider(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
    @Req() req: FastifyRequest & RawBodyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReceiveInboundWebhookResult> {
    const rawBody =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : typeof req.body === 'string'
          ? req.body
          : req.body !== undefined && req.body !== null
            ? JSON.stringify(req.body)
            : '';

    const sourceIp = resolveClientIp(req) ?? undefined;

    const result = await this.inboundWebhooksService.receiveWebhook({
      providerCode: params.providerCode,
      rawBody,
      parsedBody: req.body,
      headers: req.headers as Record<string, unknown>,
      sourceIp,
    });

    reply?.status?.(result.duplicate ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result;
  }
}
