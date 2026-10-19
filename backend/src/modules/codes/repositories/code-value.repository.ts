import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { CodeValueEntity } from '../entities/code-value.entity.js';

@Injectable()
export class CodeValueRepository extends BaseTypeOrmRepository<CodeValueEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(CodeValueEntity, dataSource, transactionManager);
  }

  /** Tìm danh sách giá trị của một nhóm danh mục `typeCode` */
  public async findByTypeCode(
    typeCode: string,
    includeInactive = false,
  ): Promise<CodeValueEntity[]> {
    const normalized = typeCode.trim().toLowerCase();
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('cv')
        .where('cv.typeCode = :typeCode', { typeCode: normalized })
        .orderBy('cv.sortOrder', 'ASC')
        .addOrderBy('cv.numericCode', 'ASC');

      if (!includeInactive) {
        qb.andWhere('cv.status = 1');
      }
      return qb.getMany();
    });
  }

  /** Tìm danh sách giá trị của nhiều nhóm danh mục */
  public async findByTypeCodes(
    typeCodes: readonly string[],
    includeInactive = false,
  ): Promise<CodeValueEntity[]> {
    if (typeCodes.length === 0) return [];
    const normalized = typeCodes.map((c) => c.trim().toLowerCase());
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('cv')
        .where('cv.typeCode IN (:...typeCodes)', { typeCodes: normalized })
        .orderBy('cv.typeCode', 'ASC')
        .addOrderBy('cv.sortOrder', 'ASC')
        .addOrderBy('cv.numericCode', 'ASC');

      if (!includeInactive) {
        qb.andWhere('cv.status = 1');
      }
      return qb.getMany();
    });
  }

  /** Tìm toàn bộ giá trị danh mục trên hệ thống */
  public async findAllOrdered(includeInactive = true): Promise<CodeValueEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('cv')
        .orderBy('cv.typeCode', 'ASC')
        .addOrderBy('cv.sortOrder', 'ASC')
        .addOrderBy('cv.numericCode', 'ASC');

      if (!includeInactive) {
        qb.andWhere('cv.status = 1');
      }
      return qb.getMany();
    });
  }

  /** Tìm một giá trị theo `(typeCode, numericCode)` */
  public async findByTypeAndNumericCode(
    typeCode: string,
    numericCode: number,
  ): Promise<CodeValueEntity | null> {
    const normalized = typeCode.trim().toLowerCase();
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: { typeCode: normalized, numericCode },
      }),
    );
  }

  /** Tìm một giá trị theo `(typeCode, code)` */
  public async findByTypeAndCode(typeCode: string, code: string): Promise<CodeValueEntity | null> {
    const normalizedType = typeCode.trim().toLowerCase();
    const normalizedCode = code.trim().toUpperCase();
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: { typeCode: normalizedType, code: normalizedCode },
      }),
    );
  }

  /** Tìm danh sách giá trị theo mảng ID */
  public async findByIds(ids: readonly number[]): Promise<CodeValueEntity[]> {
    if (ids.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { id: In([...ids]) },
      }),
    );
  }
}
