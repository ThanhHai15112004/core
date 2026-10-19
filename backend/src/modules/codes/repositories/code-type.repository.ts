import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { CodeTypeEntity } from '../entities/code-type.entity.js';

@Injectable()
export class CodeTypeRepository extends BaseTypeOrmRepository<CodeTypeEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(CodeTypeEntity, dataSource, transactionManager);
  }

  /** Tìm một nhóm danh mục theo mã `code` (vd: `organizations.unit_type`) */
  public async findByCode(code: string): Promise<CodeTypeEntity | null> {
    const normalized = code.trim().toLowerCase();
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: { code: normalized },
      }),
    );
  }

  /** Liệt kê toàn bộ nhóm danh mục có lọc theo module hoặc từ khóa */
  public async findFiltered(params?: {
    module?: string | undefined;
    search?: string | undefined;
    status?: number | undefined;
  }): Promise<CodeTypeEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('ct')
        .orderBy('ct.module', 'ASC')
        .addOrderBy('ct.code', 'ASC');

      if (params?.module) {
        qb.andWhere('LOWER(ct.module) = :module', { module: params.module.trim().toLowerCase() });
      }
      if (params?.status !== undefined) {
        qb.andWhere('ct.status = :status', { status: params.status });
      }
      if (params?.search) {
        const keyword = `%${params.search.trim().toLowerCase()}%`;
        qb.andWhere('(LOWER(ct.code) LIKE :keyword OR LOWER(ct.name) LIKE :keyword)', { keyword });
      }

      return qb.getMany();
    });
  }
}
