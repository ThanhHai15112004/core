import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { FileFolderEntity } from '../entities/file-folder.entity.js';

@Injectable()
export class FileFoldersRepository extends BaseTypeOrmRepository<FileFolderEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(FileFolderEntity, dataSource, transactionManager);
  }

  /** Tìm danh sách tất cả thư mục theo thứ tự tên */
  public async findAllOrdered(organizationUnitId?: number): Promise<FileFolderEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('folder').orderBy('folder.name', 'ASC');
      if (organizationUnitId !== undefined) {
        qb.andWhere('folder.organizationUnitId = :organizationUnitId', { organizationUnitId });
      }
      return qb.getMany();
    });
  }

  /** Tìm danh sách thư mục theo mảng ID */
  public async findByIds(ids: readonly number[]): Promise<FileFolderEntity[]> {
    if (ids.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { id: In([...ids]) },
      }),
    );
  }

  /** Đếm số thư mục con trực tiếp của một thư mục */
  public async countChildFolders(parentId: number): Promise<number> {
    return this.executeReadOnly(async (repo) =>
      repo.count({
        where: { parentId },
      }),
    );
  }

  /** Xóa mềm thư mục theo ID */
  public async softDeleteById(id: number): Promise<void> {
    await this.repository.softDelete(id);
  }
}
