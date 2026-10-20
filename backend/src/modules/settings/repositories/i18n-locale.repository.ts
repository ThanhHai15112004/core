import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { I18nLocaleEntity } from '../entities/i18n-locale.entity.js';

@Injectable()
export class I18nLocaleRepository extends BaseTypeOrmRepository<I18nLocaleEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(I18nLocaleEntity, dataSource, transactionManager);
  }

  public async findByCode(code: string): Promise<I18nLocaleEntity | null> {
    const normalized = code.trim().toLowerCase();
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: { code: normalized },
      }),
    );
  }

  public async findAllOrdered(status?: number): Promise<I18nLocaleEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('l')
        .orderBy('l.sortOrder', 'ASC')
        .addOrderBy('l.id', 'ASC');
      if (status !== undefined) {
        qb.andWhere('l.status = :status', { status });
      }
      return qb.getMany();
    });
  }
}
