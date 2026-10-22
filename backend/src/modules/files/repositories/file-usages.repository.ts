import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { FileUsageEntity } from '../entities/file-usage.entity.js';

@Injectable()
export class FileUsagesRepository extends BaseTypeOrmRepository<FileUsageEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(FileUsageEntity, dataSource, transactionManager);
  }

  /** Lấy danh sách các chức năng/bản ghi đang sử dụng một file */
  public async findByFileId(fileId: number): Promise<FileUsageEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { fileId },
        order: { id: 'DESC' },
      }),
    );
  }

  /** Lấy danh sách liên kết sử dụng của nhiều file cùng lúc */
  public async findByFileIds(fileIds: readonly number[]): Promise<FileUsageEntity[]> {
    if (fileIds.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { fileId: In([...fileIds]) },
        order: { id: 'DESC' },
      }),
    );
  }

  /** Tìm một liên kết cụ thể theo bộ khóa mục tiêu */
  public async findByTarget(params: {
    fileId: number;
    moduleName: string;
    entityType: string;
    entityId: string;
    fieldName: string;
  }): Promise<FileUsageEntity | null> {
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: {
          fileId: params.fileId,
          moduleName: params.moduleName,
          entityType: params.entityType,
          entityId: params.entityId,
          fieldName: params.fieldName,
        },
      }),
    );
  }

  /** Tìm toàn bộ liên kết của một thực thể nghiệp vụ (phục vụ đồng bộ `syncEntityFileUsages`) */
  public async findByEntity(params: {
    moduleName: string;
    entityType: string;
    entityId: string;
    fieldName?: string;
  }): Promise<FileUsageEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: {
          moduleName: params.moduleName,
          entityType: params.entityType,
          entityId: params.entityId,
          ...(params.fieldName ? { fieldName: params.fieldName } : {}),
        },
      }),
    );
  }

  /** Đếm tổng số liên kết đang gắn với một file */
  public async countByFileId(fileId: number): Promise<number> {
    return this.executeReadOnly(async (repo) =>
      repo.count({
        where: { fileId },
      }),
    );
  }

  /** Xóa mềm bản ghi liên kết theo ID */
  public async softDeleteById(id: number): Promise<void> {
    await this.repository.softDelete(id);
  }
}
