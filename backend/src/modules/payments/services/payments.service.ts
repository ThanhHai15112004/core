import { Injectable } from '@nestjs/common';
import { Traced } from '@packages/tracing/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { IPaymentsPublicService } from '../contracts/index.js';
import type {
  CreatePaymentProviderRequest,
  GetReconciliationDetailQuery,
  ListPaymentCallbacksQuery,
  ListPaymentProvidersQuery,
  ListPaymentReconciliationsQuery,
  ListPaymentRefundsQuery,
  ListPaymentTransactionsQuery,
  ResolveReconciliationItemRequest,
  UpdatePaymentProviderRequest,
} from '../requests/payments.requests.js';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  ListPaymentTransactionsInput,
  PaymentCallbackView,
  PaymentDriverMetadata,
  PaymentProviderView,
  PaymentReconciliationItemView,
  PaymentReconciliationView,
  PaymentRefundView,
  PaymentTransactionView,
  ReceivePaymentCallbackInput,
  ReceivePaymentCallbackResult,
  RefundPaymentInput,
  RefundPaymentResult,
  RunReconciliationInput,
  SimulatePaymentCallbackInput,
} from '../types/payments.types.js';
import { PaymentAdapterRegistryService } from './payment-adapter-registry.service.js';
import { PaymentCallbacksService } from './payment-callbacks.service.js';
import { PaymentProvidersService } from './payment-providers.service.js';
import { PaymentReconciliationService } from './payment-reconciliation.service.js';
import { PaymentRefundsService } from './payment-refunds.service.js';
import { PaymentTransactionsService } from './payment-transactions.service.js';

@Injectable()
export class PaymentsService implements IPaymentsPublicService {
  constructor(
    private readonly adapterRegistry: PaymentAdapterRegistryService,
    private readonly providersService: PaymentProvidersService,
    private readonly transactionsService: PaymentTransactionsService,
    private readonly callbacksService: PaymentCallbacksService,
    private readonly refundsService: PaymentRefundsService,
    private readonly reconciliationService: PaymentReconciliationService,
  ) {}

  public listDrivers(): PaymentDriverMetadata[] {
    return this.adapterRegistry.listDrivers();
  }

  public async listProviders(): Promise<PaymentProviderView[]> {
    return this.providersService.listAllProviders();
  }

  public async listProvidersPaginated(
    query: ListPaymentProvidersQuery,
  ): Promise<PaginatedResult<PaymentProviderView>> {
    return this.providersService.listProvidersPaginated(query);
  }

  public async getProviderById(id: number): Promise<PaymentProviderView> {
    return this.providersService.getProviderById(id);
  }

  public async createProvider(
    input: CreatePaymentProviderRequest,
    actor?: UserIdentity,
  ): Promise<PaymentProviderView> {
    return this.providersService.createProvider(input, actor);
  }

  public async updateProvider(
    id: number,
    input: UpdatePaymentProviderRequest,
    actor?: UserIdentity,
  ): Promise<PaymentProviderView> {
    return this.providersService.updateProvider(id, input, actor);
  }

  public async deleteProvider(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.providersService.deleteProvider(id, actor);
  }

  @Traced('usecase.payments.create')
  public async createPayment(
    input: CreatePaymentInput,
    actor?: UserIdentity,
    headerIdempotencyKey?: string,
  ): Promise<CreatePaymentResult> {
    return this.transactionsService.createPayment(input, { actor, headerIdempotencyKey });
  }

  public async listTransactions(
    query: ListPaymentTransactionsInput | ListPaymentTransactionsQuery = {},
  ): Promise<PaginatedResult<PaymentTransactionView>> {
    return this.transactionsService.listTransactions(query);
  }

  public async getTransactionById(id: number): Promise<PaymentTransactionView> {
    return this.transactionsService.getTransactionDetail(id);
  }

  public async getTransactionByCode(paymentCode: string): Promise<PaymentTransactionView> {
    return this.transactionsService.getTransactionByCode(paymentCode);
  }

  @Traced('usecase.payments.refund')
  public async refundPayment(
    transactionId: number,
    input: RefundPaymentInput,
    actor?: UserIdentity,
    headerIdempotencyKey?: string,
  ): Promise<RefundPaymentResult> {
    return this.refundsService.refundPayment(transactionId, input, { actor, headerIdempotencyKey });
  }

  public async listRefunds(
    query: ListPaymentRefundsQuery,
  ): Promise<PaginatedResult<PaymentRefundView>> {
    return this.refundsService.listRefunds(query);
  }

  public async receiveCallback(
    input: ReceivePaymentCallbackInput,
  ): Promise<ReceivePaymentCallbackResult> {
    return this.callbacksService.receiveCallback(input);
  }

  public async simulateSandboxCallback(
    transactionId: number,
    input: SimulatePaymentCallbackInput,
    actor?: UserIdentity,
  ): Promise<ReceivePaymentCallbackResult> {
    return this.callbacksService.simulateSandboxCallback(transactionId, input, actor);
  }

  public async listCallbacks(
    query: ListPaymentCallbacksQuery,
  ): Promise<PaginatedResult<PaymentCallbackView>> {
    return this.callbacksService.listCallbacks(query);
  }

  public async getCallbackById(id: number): Promise<PaymentCallbackView> {
    return this.callbacksService.getCallbackById(id);
  }

  public async runReconciliation(
    input: RunReconciliationInput,
    actor?: UserIdentity,
  ): Promise<PaymentReconciliationView> {
    return this.reconciliationService.runReconciliation(input, actor);
  }

  public async listReconciliations(
    query: ListPaymentReconciliationsQuery,
  ): Promise<PaginatedResult<PaymentReconciliationView>> {
    return this.reconciliationService.listReconciliations(query);
  }

  public async getReconciliationDetail(
    id: number,
    query?: GetReconciliationDetailQuery,
  ): Promise<PaymentReconciliationView> {
    return this.reconciliationService.getReconciliationDetail(id, query);
  }

  public async resolveReconciliationItem(
    reconciliationId: number,
    itemId: number,
    input: ResolveReconciliationItemRequest,
    actor?: UserIdentity,
  ): Promise<PaymentReconciliationItemView> {
    return this.reconciliationService.resolveReconciliationItem(
      reconciliationId,
      itemId,
      input,
      actor,
    );
  }
}
