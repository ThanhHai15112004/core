import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { I18nTranslationEntity } from '../entities/i18n-translation.entity.js';

@Injectable()
export class I18nTranslationRepository extends BaseTypeOrmRepository<I18nTranslationEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(I18nTranslationEntity, dataSource, transactionManager);
  }

  public async findByLocaleAndKey(
    locale: string,
    translationKey: string,
  ): Promise<I18nTranslationEntity | null> {
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: {
          locale: locale.trim().toLowerCase(),
          translationKey: translationKey.trim(),
        },
      }),
    );
  }

  public async findFiltered(params?: {
    locale?: string | undefined;
    namespace?: string | undefined;
    status?: number | undefined;
    q?: string | undefined;
  }): Promise<I18nTranslationEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('tr')
        .orderBy('tr.namespace', 'ASC')
        .addOrderBy('tr.translationKey', 'ASC')
        .addOrderBy('tr.locale', 'ASC');

      if (params?.locale?.trim()) {
        qb.andWhere('LOWER(tr.locale) = :locale', {
          locale: params.locale.trim().toLowerCase(),
        });
      }
      if (params?.namespace?.trim()) {
        qb.andWhere('LOWER(tr.namespace) = :namespace', {
          namespace: params.namespace.trim().toLowerCase(),
        });
      }
      if (params?.status !== undefined) {
        qb.andWhere('tr.status = :status', { status: params.status });
      }
      if (params?.q?.trim()) {
        const kw = `%${params.q.trim().toLowerCase()}%`;
        qb.andWhere('(LOWER(tr.translationKey) LIKE :kw OR LOWER(tr.translationValue) LIKE :kw)', {
          kw,
        });
      }
      return qb.getMany();
    });
  }
}
