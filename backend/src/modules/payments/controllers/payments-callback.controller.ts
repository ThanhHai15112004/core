import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ApiDoc,
  ApiGroup,
  Public,
  type RawBodyRequest,
  ValidatedParams,
  resolveClientIp,
} from '@packages/http/index.js';
import { paymentProviderCodeParamSchema } from '../requests/payments.requests.js';
import { PAYMENTS_ROUTES } from '../routes/payments.routes.js';
import { PaymentsService } from '../services/payments.service.js';
import type { ReceivePaymentCallbackResult } from '../types/payments.types.js';

@ApiGroup(
  'Payments — Callbacks',
  'Endpoint công khai tiếp nhận Callback/IPN từ các cổng thanh toán (Sandbox, VNPay, MoMo, Stripe): xác minh chữ ký, đối chiếu số tiền, tiền tệ, mã giao dịch, chống replay và cập nhật trạng thái giao dịch an toàn.',
)
@Controller(PAYMENTS_ROUTES.PREFIX)
export class PaymentsCallbackController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Post(PAYMENTS_ROUTES.CALLBACK_RECEIVE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Nhận Payment Callback / Webhook (POST) theo mã Provider',
    description:
      'Xác minh chữ ký theo adapter của provider (rawBody cho Stripe/Sandbox, JSON cho MoMo, form/query cho VNPay), đối chiếu số tiền/tiền tệ/mã giao dịch, chống trùng lặp và lưu lịch sử đối soát.',
  })
  public async receivePostCallback(
    @ValidatedParams(paymentProviderCodeParamSchema) params: { providerCode: string },
    @Req() req: FastifyRequest & RawBodyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReceivePaymentCallbackResult> {
    return this.dispatchCallback(params.providerCode, 'POST', req, reply);
  }

  @Public()
  @Get(PAYMENTS_ROUTES.CALLBACK_RECEIVE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Nhận Payment Callback / IPN (GET Query — VNPay Return/IPN) theo mã Provider',
    description:
      'Tiếp nhận callback qua query string (thường dùng cho VNPay IPN/Return URL), xác minh chữ ký HMAC-SHA512, kiểm tra số tiền và cập nhật trạng thái giao dịch.',
  })
  public async receiveGetCallback(
    @ValidatedParams(paymentProviderCodeParamSchema) params: { providerCode: string },
    @Req() req: FastifyRequest & RawBodyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReceivePaymentCallbackResult> {
    return this.dispatchCallback(params.providerCode, 'GET', req, reply);
  }

  private async dispatchCallback(
    providerCode: string,
    httpMethod: 'POST' | 'GET',
    req: FastifyRequest & RawBodyRequest,
    reply: FastifyReply,
  ): Promise<ReceivePaymentCallbackResult> {
    const rawBody =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : typeof req.body === 'string'
          ? req.body
          : req.body !== undefined && req.body !== null
            ? JSON.stringify(req.body)
            : '';

    const sourceIp = resolveClientIp(req) ?? undefined;

    const result = await this.paymentsService.receiveCallback({
      providerCode,
      httpMethod,
      rawBody,
      parsedBody: req.body,
      query: (req.query as Record<string, unknown>) ?? {},
      headers: req.headers as Record<string, unknown>,
      sourceIp,
    });

    reply?.status?.(HttpStatus.OK);
    return result;
  }
}
