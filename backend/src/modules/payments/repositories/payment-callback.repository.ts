import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { PAYMENT_CALLBACK_STATUS, type PaymentCallbackStatusCode } from '../enum/payments.enum.js';
import { PaymentCallbackEntity } from '../entities/payment-callback.entity.js';

export interface ListPaymentCallbacksFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly providerCode?: string | undefined;
  readonly paymentTransactionId?: number | undefined;
  readonly verificationStatus?: PaymentCallbackStatusCode | undefined;
  readonly search?: string | undefined;
}

@Injectable()
export class PaymentCallbackRepository extends BaseTypeOrmRepository<PaymentCallbackEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PaymentCallbackEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdSafe(id: number): Promise<PaymentCallbackEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id: Number(id) } });
  }

  public async findVerifiedDuplicate(params: {
    readonly providerCode: string;
    readonly providerEventId?: string | null | undefined;
    readonly payloadSha256: string;
  }): Promise<PaymentCallbackEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    const providerCode = params.providerCode.trim().toLowerCase();
    if (params.providerEventId?.trim()) {
      const byEventId = await this.repository.findOne({
        where: {
          providerCode,
          providerEventId: params.providerEventId.trim(),
          verificationStatus: PAYMENT_CALLBACK_STATUS.VERIFIED,
        },
      });
      if (byEventId) return byEventId;
    }
    return this.repository.findOne({
      where: {
        providerCode,
        payloadSha256: params.payloadSha256,
        verificationStatus: PAYMENT_CALLBACK_STATUS.VERIFIED,
      },
    });
  }

  public async listByTransactionId(paymentTransactionId: number): Promise<PaymentCallbackEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { paymentTransactionId: Number(paymentTransactionId) },
      order: { id: 'DESC' },
    });
  }

  public async listPaginated(
    filter: ListPaymentCallbacksFilter,
  ): Promise<PaginatedResult<PaymentCallbackEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('cb');
    if (filter.providerCode?.trim()) {
      qb.andWhere('cb.providerCode = :providerCode', {
        providerCode: filter.providerCode.trim().toLowerCase(),
      });
    }
    if (filter.paymentTransactionId !== undefined) {
      qb.andWhere('cb.paymentTransactionId = :paymentTransactionId', {
        paymentTransactionId: Number(filter.paymentTransactionId),
      });
    }
    if (filter.verificationStatus !== undefined) {
      qb.andWhere('cb.verificationStatus = :verificationStatus', {
        verificationStatus: filter.verificationStatus,
      });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'cb.callbackUid',
        'cb.paymentCode',
        'cb.providerEventId',
        'cb.providerTransactionId',
        'cb.rejectionReason',
      ]);
    }
    qb.orderBy('cb.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
