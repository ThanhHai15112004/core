import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { I18nTimezoneEntity } from '../entities/i18n-timezone.entity.js';

@Injectable()
export class I18nTimezoneRepository extends BaseTypeOrmRepository<I18nTimezoneEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(I18nTimezoneEntity, dataSource, transactionManager);
  }

  public async findByCode(code: string): Promise<I18nTimezoneEntity | null> {
    const trimmed = code.trim();
    return this.executeReadOnly(async (repo) =>
      repo
        .createQueryBuilder('tz')
        .where('LOWER(tz.code) = LOWER(:code)', { code: trimmed })
        .getOne(),
    );
  }

  public async findAllOrdered(params?: {
    status?: number | undefined;
    region?: string | undefined;
    q?: string | undefined;
  }): Promise<I18nTimezoneEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('tz')
        .orderBy('tz.sortOrder', 'ASC')
        .addOrderBy('tz.id', 'ASC');
      if (params?.status !== undefined) {
        qb.andWhere('tz.status = :status', { status: params.status });
      }
      if (params?.region?.trim()) {
        qb.andWhere('LOWER(tz.region) = LOWER(:region)', { region: params.region.trim() });
      }
      if (params?.q?.trim()) {
        const kw = `%${params.q.trim().toLowerCase()}%`;
        qb.andWhere(
          '(LOWER(tz.code) LIKE :kw OR LOWER(tz.name) LIKE :kw OR LOWER(tz.utcOffset) LIKE :kw)',
          { kw },
        );
      }
      return qb.getMany();
    });
  }
}
