import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type {
  PaymentReconciliationRunStatusCode,
  PaymentReconciliationSource,
} from '../enum/payments.enum.js';
import { PaymentReconciliationEntity } from '../entities/payment-reconciliation.entity.js';

export interface ListPaymentReconciliationsFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly providerCode?: string | undefined;
  readonly sourceMode?: PaymentReconciliationSource | undefined;
  readonly status?: PaymentReconciliationRunStatusCode | undefined;
}

@Injectable()
export class PaymentReconciliationRepository extends BaseTypeOrmRepository<PaymentReconciliationEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PaymentReconciliationEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdSafe(id: number): Promise<PaymentReconciliationEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id: Number(id) } });
  }

  public async listPaginated(
    filter: ListPaymentReconciliationsFilter,
  ): Promise<PaginatedResult<PaymentReconciliationEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('recon');
    if (filter.providerCode?.trim()) {
      qb.andWhere('recon.providerCode = :providerCode', {
        providerCode: filter.providerCode.trim().toLowerCase(),
      });
    }
    if (filter.sourceMode) {
      qb.andWhere('recon.sourceMode = :sourceMode', { sourceMode: filter.sourceMode });
    }
    if (filter.status !== undefined) {
      qb.andWhere('recon.status = :status', { status: filter.status });
    }
    qb.orderBy('recon.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
