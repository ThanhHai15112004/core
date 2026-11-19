import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { PAYMENT_REFUND_STATUS, type PaymentRefundStatusCode } from '../enum/payments.enum.js';
import { PaymentRefundEntity } from '../entities/payment-refund.entity.js';

export interface ListPaymentRefundsFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly paymentTransactionId?: number | undefined;
  readonly providerCode?: string | undefined;
  readonly status?: PaymentRefundStatusCode | undefined;
  readonly search?: string | undefined;
}

@Injectable()
export class PaymentRefundRepository extends BaseTypeOrmRepository<PaymentRefundEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PaymentRefundEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdSafe(id: number): Promise<PaymentRefundEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id: Number(id) } });
  }

  public async findByIdempotencyKey(idempotencyKey: string): Promise<PaymentRefundEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { idempotencyKey: idempotencyKey.trim() } });
  }

  public async listByTransactionId(paymentTransactionId: number): Promise<PaymentRefundEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { paymentTransactionId: Number(paymentTransactionId) },
      order: { id: 'DESC' },
    });
  }

  public async getPendingOrProcessingAmount(paymentTransactionId: number): Promise<number> {
    if (!this.dataSource?.isInitialized) return 0;
    const rows = await this.repository.find({
      where: [
        {
          paymentTransactionId: Number(paymentTransactionId),
          status: PAYMENT_REFUND_STATUS.PENDING,
        },
        {
          paymentTransactionId: Number(paymentTransactionId),
          status: PAYMENT_REFUND_STATUS.PROCESSING,
        },
      ],
    });
    return rows.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  }

  public async listPaginated(
    filter: ListPaymentRefundsFilter,
  ): Promise<PaginatedResult<PaymentRefundEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('refund');
    if (filter.paymentTransactionId !== undefined) {
      qb.andWhere('refund.paymentTransactionId = :paymentTransactionId', {
        paymentTransactionId: Number(filter.paymentTransactionId),
      });
    }
    if (filter.providerCode?.trim()) {
      qb.andWhere('refund.providerCode = :providerCode', {
        providerCode: filter.providerCode.trim().toLowerCase(),
      });
    }
    if (filter.status !== undefined) {
      qb.andWhere('refund.status = :status', { status: filter.status });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'refund.refundCode',
        'refund.paymentCode',
        'refund.providerRefundId',
        'refund.idempotencyKey',
      ]);
    }
    qb.orderBy('refund.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
