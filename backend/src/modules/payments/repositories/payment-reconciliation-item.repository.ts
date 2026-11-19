import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type {
  PaymentReconciliationDiscrepancyCode,
  PaymentReconciliationResolutionCode,
} from '../enum/payments.enum.js';
import { PaymentReconciliationItemEntity } from '../entities/payment-reconciliation-item.entity.js';

export interface ListReconciliationItemsFilter {
  readonly discrepancyStatus?: PaymentReconciliationDiscrepancyCode | undefined;
  readonly resolutionStatus?: PaymentReconciliationResolutionCode | undefined;
}

@Injectable()
export class PaymentReconciliationItemRepository extends BaseTypeOrmRepository<PaymentReconciliationItemEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PaymentReconciliationItemEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdAndReconciliationId(
    itemId: number,
    reconciliationId: number,
  ): Promise<PaymentReconciliationItemEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        id: Number(itemId),
        reconciliationId: Number(reconciliationId),
      },
    });
  }

  public async listByReconciliationId(
    reconciliationId: number,
    filter?: ListReconciliationItemsFilter,
  ): Promise<PaymentReconciliationItemEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    const qb = this.repository
      .createQueryBuilder('item')
      .where('item.reconciliationId = :reconciliationId', {
        reconciliationId: Number(reconciliationId),
      });
    if (filter?.discrepancyStatus !== undefined) {
      qb.andWhere('item.discrepancyStatus = :discrepancyStatus', {
        discrepancyStatus: filter.discrepancyStatus,
      });
    }
    if (filter?.resolutionStatus !== undefined) {
      qb.andWhere('item.resolutionStatus = :resolutionStatus', {
        resolutionStatus: filter.resolutionStatus,
      });
    }
    qb.orderBy('item.discrepancyStatus', 'DESC').addOrderBy('item.id', 'ASC');
    return qb.getMany();
  }
}
