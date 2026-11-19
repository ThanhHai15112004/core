import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaymentTransactionStatusCode } from '../enum/payments.enum.js';
import { PaymentTransactionEntity } from '../entities/payment-transaction.entity.js';

export interface ListPaymentTransactionsFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly providerCode?: string | undefined;
  readonly status?: PaymentTransactionStatusCode | undefined;
  readonly currency?: string | undefined;
  readonly merchantOrderRef?: string | undefined;
  readonly search?: string | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

@Injectable()
export class PaymentTransactionRepository extends BaseTypeOrmRepository<PaymentTransactionEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PaymentTransactionEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdSafe(id: number): Promise<PaymentTransactionEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id: Number(id) } });
  }

  public async findByIdForUpdate(id: number): Promise<PaymentTransactionEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    const qb = this.repository.createQueryBuilder('tx').where('tx.id = :id', { id: Number(id) });
    if (this.transactionManager?.isInTransaction()) {
      qb.setLock('pessimistic_write');
    }
    return qb.getOne();
  }

  public async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PaymentTransactionEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { idempotencyKey: idempotencyKey.trim() } });
  }

  public async findByPaymentCode(paymentCode: string): Promise<PaymentTransactionEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { paymentCode: paymentCode.trim() } });
  }

  public async findByProviderTransactionId(
    providerCode: string,
    providerTransactionId: string,
  ): Promise<PaymentTransactionEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        providerCode: providerCode.trim().toLowerCase(),
        providerTransactionId: providerTransactionId.trim(),
      },
    });
  }

  public async findLatestByMerchantOrderRef(
    providerCode: string,
    merchantOrderRef: string,
  ): Promise<PaymentTransactionEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        providerCode: providerCode.trim().toLowerCase(),
        merchantOrderRef: merchantOrderRef.trim(),
      },
      order: { id: 'DESC' },
    });
  }

  public async listForReconciliationWindow(params: {
    readonly providerCode: string;
    readonly periodStart: Date;
    readonly periodEnd: Date;
  }): Promise<PaymentTransactionEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository
      .createQueryBuilder('tx')
      .where('tx.providerCode = :providerCode', {
        providerCode: params.providerCode.trim().toLowerCase(),
      })
      .andWhere('tx.createdAt >= :periodStart', { periodStart: params.periodStart })
      .andWhere('tx.createdAt <= :periodEnd', { periodEnd: params.periodEnd })
      .orderBy('tx.id', 'ASC')
      .getMany();
  }

  public async listPaginated(
    filter: ListPaymentTransactionsFilter,
  ): Promise<PaginatedResult<PaymentTransactionEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('tx');
    if (filter.providerCode?.trim()) {
      qb.andWhere('tx.providerCode = :providerCode', {
        providerCode: filter.providerCode.trim().toLowerCase(),
      });
    }
    if (filter.status !== undefined) {
      qb.andWhere('tx.status = :status', { status: filter.status });
    }
    if (filter.currency?.trim()) {
      qb.andWhere('tx.currency = :currency', { currency: filter.currency.trim().toUpperCase() });
    }
    if (filter.merchantOrderRef?.trim()) {
      qb.andWhere('tx.merchantOrderRef = :merchantOrderRef', {
        merchantOrderRef: filter.merchantOrderRef.trim(),
      });
    }
    if (filter.from) {
      qb.andWhere('tx.createdAt >= :from', { from: filter.from });
    }
    if (filter.to) {
      qb.andWhere('tx.createdAt <= :to', { to: filter.to });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'tx.paymentCode',
        'tx.merchantOrderRef',
        'tx.providerTransactionId',
        'tx.idempotencyKey',
        'tx.description',
      ]);
    }
    qb.orderBy('tx.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
