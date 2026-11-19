import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  PAYMENT_PROVIDER_STATUS,
  type PaymentDriverCode,
  type PaymentProviderStatusCode,
} from '../enum/payments.enum.js';
import { PaymentProviderEntity } from '../entities/payment-provider.entity.js';

export interface ListPaymentProvidersFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly driverCode?: PaymentDriverCode | undefined;
  readonly status?: PaymentProviderStatusCode | undefined;
  readonly isEnabled?: boolean | undefined;
  readonly search?: string | undefined;
}

@Injectable()
export class PaymentProviderRepository extends BaseTypeOrmRepository<PaymentProviderEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PaymentProviderEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdSafe(id: number): Promise<PaymentProviderEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id: Number(id) } });
  }

  public async findByCode(
    providerCode: string,
    withDeleted = false,
  ): Promise<PaymentProviderEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { providerCode: providerCode.trim().toLowerCase() },
      withDeleted,
    });
  }

  public async findDefaultActiveProvider(): Promise<PaymentProviderEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        isDefault: true,
        isEnabled: true,
        status: PAYMENT_PROVIDER_STATUS.ACTIVE,
      },
      order: { id: 'ASC' },
    });
  }

  public async clearDefaultFlagExcept(excludeId: number): Promise<void> {
    if (!this.dataSource?.isInitialized) return;
    await this.repository
      .createQueryBuilder()
      .update(PaymentProviderEntity)
      .set({ isDefault: false })
      .where('id != :excludeId AND is_default = :isDefault', {
        excludeId: Number(excludeId),
        isDefault: true,
      })
      .execute();
  }

  public async listAll(): Promise<PaymentProviderEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { id: 'ASC' } });
  }

  public async listPaginated(
    filter: ListPaymentProvidersFilter,
  ): Promise<PaginatedResult<PaymentProviderEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('provider');
    if (filter.driverCode) {
      qb.andWhere('provider.driverCode = :driverCode', { driverCode: filter.driverCode });
    }
    if (filter.status !== undefined) {
      qb.andWhere('provider.status = :status', { status: filter.status });
    }
    if (filter.isEnabled !== undefined) {
      qb.andWhere('provider.isEnabled = :isEnabled', { isEnabled: filter.isEnabled });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'provider.providerCode',
        'provider.displayName',
        'provider.driverCode',
      ]);
    }
    qb.orderBy('provider.isDefault', 'DESC').addOrderBy('provider.id', 'ASC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }

  public async updateTelemetry(
    providerId: number,
    payload: {
      readonly lastSuccessAt?: Date | undefined;
      readonly lastErrorAt?: Date | undefined;
      readonly lastErrorCode?: string | null | undefined;
    },
  ): Promise<void> {
    if (!this.dataSource?.isInitialized) return;
    const updateData: Partial<PaymentProviderEntity> = {};
    if (payload.lastSuccessAt !== undefined) updateData.lastSuccessAt = payload.lastSuccessAt;
    if (payload.lastErrorAt !== undefined) updateData.lastErrorAt = payload.lastErrorAt;
    if (payload.lastErrorCode !== undefined) updateData.lastErrorCode = payload.lastErrorCode;
    if (Object.keys(updateData).length === 0) return;
    await this.repository.update({ id: Number(providerId) }, updateData);
  }
}
