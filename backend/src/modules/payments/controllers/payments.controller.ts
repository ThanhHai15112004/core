import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiDoc,
  ApiGroup,
  intIdParamSchema,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
} from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import {
  CreatePaymentProviderRequestSchema,
  CreatePaymentRequestSchema,
  GetReconciliationDetailQuerySchema,
  ListPaymentCallbacksQuerySchema,
  ListPaymentProvidersQuerySchema,
  ListPaymentReconciliationsQuerySchema,
  ListPaymentRefundsQuerySchema,
  ListPaymentTransactionsQuerySchema,
  RefundPaymentRequestSchema,
  ResolveReconciliationItemRequestSchema,
  RunPaymentReconciliationRequestSchema,
  SimulatePaymentCallbackRequestSchema,
  UpdatePaymentProviderRequestSchema,
  reconciliationItemParamsSchema,
  type CreatePaymentProviderRequest,
  type CreatePaymentRequest,
  type GetReconciliationDetailQuery,
  type ListPaymentCallbacksQuery,
  type ListPaymentProvidersQuery,
  type ListPaymentReconciliationsQuery,
  type ListPaymentRefundsQuery,
  type ListPaymentTransactionsQuery,
  type RefundPaymentRequest,
  type ResolveReconciliationItemRequest,
  type RunPaymentReconciliationRequest,
  type SimulatePaymentCallbackRequest,
  type UpdatePaymentProviderRequest,
} from '../requests/payments.requests.js';
import { PAYMENTS_ROUTES } from '../routes/payments.routes.js';
import { PaymentsService } from '../services/payments.service.js';
import type {
  CreatePaymentResult,
  PaymentCallbackView,
  PaymentDriverMetadata,
  PaymentProviderView,
  PaymentReconciliationItemView,
  PaymentReconciliationView,
  PaymentRefundView,
  PaymentTransactionView,
  ReceivePaymentCallbackResult,
  RefundPaymentResult,
} from '../types/payments.types.js';

function readHeaderIdempotencyKey(req?: FastifyRequest): string | undefined {
  const raw = req?.headers?.['idempotency-key'] ?? req?.headers?.['x-idempotency-key'];
  const val = Array.isArray(raw) ? raw[0] : raw;
  return typeof val === 'string' && val.trim() ? val.trim() : undefined;
}

@ApiGroup(
  'Payments — Port & Reconciliation',
  'Cổng thanh toán dùng chung độc lập nhà cung cấp: quản trị Provider (Sandbox, VNPay, MoMo, Stripe), tạo thanh toán với Idempotency Key, hoàn tiền toàn phần/một phần, lịch sử callback và đối soát 2 chiều.',
)
@Controller(PAYMENTS_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get(PAYMENTS_ROUTES.DRIVERS)
  @RequirePermissions('payments.read')
  @ApiDoc({ summary: 'Danh sách Driver cổng thanh toán được hệ thống hỗ trợ' })
  public listDrivers(): PaymentDriverMetadata[] {
    return this.paymentsService.listDrivers();
  }

  @Get(PAYMENTS_ROUTES.PROVIDERS)
  @RequirePermissions('payments.read')
  @ApiDoc({ summary: 'Danh sách cấu hình cổng thanh toán (phân trang & lọc)' })
  public async listProviders(
    @ValidatedQuery(ListPaymentProvidersQuerySchema) query: ListPaymentProvidersQuery,
  ): Promise<PaginatedResult<PaymentProviderView>> {
    return this.paymentsService.listProvidersPaginated(query);
  }

  @Get(PAYMENTS_ROUTES.PROVIDER_BY_ID)
  @RequirePermissions('payments.read')
  @ApiDoc({ summary: 'Chi tiết một cổng thanh toán' })
  public async getProviderById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<PaymentProviderView> {
    return this.paymentsService.getProviderById(params.id);
  }

  @Post(PAYMENTS_ROUTES.PROVIDERS)
  @RequirePermissions('payments.manage')
  @ApiDoc({ summary: 'Tạo cấu hình cổng thanh toán mới' })
  public async createProvider(
    @ValidatedBody(CreatePaymentProviderRequestSchema) body: CreatePaymentProviderRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaymentProviderView> {
    return this.paymentsService.createProvider(body, actor);
  }

  @Patch(PAYMENTS_ROUTES.PROVIDER_BY_ID)
  @RequirePermissions('payments.manage')
  @ApiDoc({ summary: 'Cập nhật cấu hình cổng thanh toán' })
  public async updateProvider(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(UpdatePaymentProviderRequestSchema) body: UpdatePaymentProviderRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaymentProviderView> {
    return this.paymentsService.updateProvider(params.id, body, actor);
  }

  @Delete(PAYMENTS_ROUTES.PROVIDER_BY_ID)
  @RequirePermissions('payments.manage')
  @ApiDoc({ summary: 'Xóa mềm cấu hình cổng thanh toán' })
  public async deleteProvider(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.paymentsService.deleteProvider(params.id, actor);
  }

  @Post(PAYMENTS_ROUTES.TRANSACTIONS)
  @RequirePermissions('payments.create')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Khởi tạo yêu cầu thanh toán dùng chung (hỗ trợ Idempotency-Key chống trùng)',
  })
  public async createPayment(
    @ValidatedBody(CreatePaymentRequestSchema) body: CreatePaymentRequest,
    @CurrentUser() actor?: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<CreatePaymentResult> {
    return this.paymentsService.createPayment(body, actor, readHeaderIdempotencyKey(req));
  }

  @Get(PAYMENTS_ROUTES.TRANSACTIONS)
  @RequirePermissions('payments.read')
  @ApiDoc({ summary: 'Danh sách giao dịch thanh toán (phân trang & lọc)' })
  public async listTransactions(
    @ValidatedQuery(ListPaymentTransactionsQuerySchema) query: ListPaymentTransactionsQuery,
  ): Promise<PaginatedResult<PaymentTransactionView>> {
    return this.paymentsService.listTransactions(query);
  }

  @Get(PAYMENTS_ROUTES.TRANSACTION_BY_ID)
  @RequirePermissions('payments.read')
  @ApiDoc({ summary: 'Chi tiết giao dịch thanh toán kèm lịch sử hoàn tiền và callback' })
  public async getTransactionById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<PaymentTransactionView> {
    return this.paymentsService.getTransactionById(params.id);
  }

  @Post(PAYMENTS_ROUTES.TRANSACTION_REFUNDS)
  @RequirePermissions('payments.refund')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Tạo yêu cầu hoàn tiền toàn phần hoặc một phần (Idempotency-Key)',
  })
  public async refundPayment(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(RefundPaymentRequestSchema) body: RefundPaymentRequest,
    @CurrentUser() actor?: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<RefundPaymentResult> {
    return this.paymentsService.refundPayment(
      params.id,
      body,
      actor,
      readHeaderIdempotencyKey(req),
    );
  }

  @Post(PAYMENTS_ROUTES.TRANSACTION_SIMULATE_CALLBACK)
  @RequirePermissions('payments.manage')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Giả lập callback có ký HMAC cho giao dịch Sandbox để kiểm thử xác minh & trạng thái',
  })
  public async simulateSandboxCallback(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(SimulatePaymentCallbackRequestSchema) body: SimulatePaymentCallbackRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ReceivePaymentCallbackResult> {
    return this.paymentsService.simulateSandboxCallback(params.id, body, actor);
  }

  @Get(PAYMENTS_ROUTES.REFUNDS)
  @RequirePermissions('payments.read')
  @ApiDoc({ summary: 'Danh sách lịch sử hoàn tiền (phân trang & lọc)' })
  public async listRefunds(
    @ValidatedQuery(ListPaymentRefundsQuerySchema) query: ListPaymentRefundsQuery,
  ): Promise<PaginatedResult<PaymentRefundView>> {
    return this.paymentsService.listRefunds(query);
  }

  @Get(PAYMENTS_ROUTES.CALLBACKS)
  @RequirePermissions('payments.read')
  @ApiDoc({ summary: 'Danh sách lịch sử Callback thanh toán đã che dữ liệu nhạy cảm' })
  public async listCallbacks(
    @ValidatedQuery(ListPaymentCallbacksQuerySchema) query: ListPaymentCallbacksQuery,
  ): Promise<PaginatedResult<PaymentCallbackView>> {
    return this.paymentsService.listCallbacks(query);
  }

  @Get('callback-logs/:id')
  @RequirePermissions('payments.read')
  @ApiDoc({ summary: 'Chi tiết một bản ghi Callback thanh toán' })
  public async getCallbackById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<PaymentCallbackView> {
    return this.paymentsService.getCallbackById(params.id);
  }

  @Post(PAYMENTS_ROUTES.RECONCILIATION_RUN)
  @RequirePermissions('payments.reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Chạy phiên đối soát thanh toán 2 chiều (Live Query hoặc Statement JSON/CSV)',
  })
  public async runReconciliation(
    @ValidatedBody(RunPaymentReconciliationRequestSchema) body: RunPaymentReconciliationRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaymentReconciliationView> {
    return this.paymentsService.runReconciliation(body, actor);
  }

  @Get(PAYMENTS_ROUTES.RECONCILIATIONS)
  @RequirePermissions('payments.read')
  @ApiDoc({ summary: 'Danh sách các phiên đối soát thanh toán' })
  public async listReconciliations(
    @ValidatedQuery(ListPaymentReconciliationsQuerySchema) query: ListPaymentReconciliationsQuery,
  ): Promise<PaginatedResult<PaymentReconciliationView>> {
    return this.paymentsService.listReconciliations(query);
  }

  @Get(PAYMENTS_ROUTES.RECONCILIATION_BY_ID)
  @RequirePermissions('payments.read')
  @ApiDoc({ summary: 'Chi tiết phiên đối soát kèm từng dòng so sánh Nội bộ vs Provider' })
  public async getReconciliationDetail(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedQuery(GetReconciliationDetailQuerySchema) query: GetReconciliationDetailQuery,
  ): Promise<PaymentReconciliationView> {
    return this.paymentsService.getReconciliationDetail(params.id, query);
  }

  @Post(PAYMENTS_ROUTES.RECONCILIATION_RESOLVE_ITEM)
  @RequirePermissions('payments.reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Xử lý sai lệch đối soát (SYNC_FROM_PROVIDER, MARK_RESOLVED hoặc IGNORE)',
  })
  public async resolveReconciliationItem(
    @ValidatedParams(reconciliationItemParamsSchema) params: { id: number; itemId: number },
    @ValidatedBody(ResolveReconciliationItemRequestSchema) body: ResolveReconciliationItemRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaymentReconciliationItemView> {
    return this.paymentsService.resolveReconciliationItem(params.id, params.itemId, body, actor);
  }
}
