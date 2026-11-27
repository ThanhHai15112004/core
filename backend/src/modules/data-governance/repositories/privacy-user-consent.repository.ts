import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { CONSENT_STATUS, type ConsentStatus } from '../enum/data-governance.enum.js';
import { PrivacyUserConsentEntity } from '../entities/privacy-user-consent.entity.js';

@Injectable()
export class PrivacyUserConsentRepository extends BaseTypeOrmRepository<PrivacyUserConsentEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PrivacyUserConsentEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<PrivacyUserConsentEntity>): PrivacyUserConsentEntity {
    return this.repository.create(data);
  }

  public async findByUserId(userId: number): Promise<PrivacyUserConsentEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { userId },
      order: { id: 'DESC' },
    });
  }

  public async findLatestGrantedByUserAndPurpose(
    userId: number,
    purposeCode: string,
  ): Promise<PrivacyUserConsentEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        userId,
        purposeCode: purposeCode.trim().toLowerCase(),
        consentStatus: CONSENT_STATUS.GRANTED,
      },
      order: { id: 'DESC' },
    });
  }

  public async findExpiredGrantedConsents(now: Date): Promise<PrivacyUserConsentEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository
      .createQueryBuilder('c')
      .where('c.consentStatus = :status', { status: CONSENT_STATUS.GRANTED })
      .andWhere('c.expiresAt IS NOT NULL')
      .andWhere('c.expiresAt <= :now', { now })
      .getMany();
  }

  public async findWithdrawnBeforeCutoff(cutoff: Date): Promise<PrivacyUserConsentEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository
      .createQueryBuilder('c')
      .where('c.consentStatus IN (:...statuses)', {
        statuses: [CONSENT_STATUS.WITHDRAWN, CONSENT_STATUS.EXPIRED],
      })
      .andWhere('c.updatedAt <= :cutoff', { cutoff })
      .getMany();
  }

  public async softRemoveEntity(
    entity: PrivacyUserConsentEntity,
  ): Promise<PrivacyUserConsentEntity> {
    return this.repository.softRemove(entity);
  }

  public async paginateFiltered(filter: {
    readonly userId?: number | undefined;
    readonly purposeCode?: string | undefined;
    readonly consentStatus?: ConsentStatus | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<PrivacyUserConsentEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 50);
    }
    const qb = this.repository.createQueryBuilder('c');
    if (filter.userId !== undefined) {
      qb.andWhere('c.userId = :userId', { userId: filter.userId });
    }
    if (filter.purposeCode?.trim()) {
      qb.andWhere('LOWER(c.purposeCode) = :purpose', {
        purpose: filter.purposeCode.trim().toLowerCase(),
      });
    }
    if (filter.consentStatus) {
      qb.andWhere('c.consentStatus = :status', { status: filter.consentStatus });
    }
    qb.orderBy('c.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 50,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
