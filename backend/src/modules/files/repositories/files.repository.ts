import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In, LessThanOrEqual } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { FILE_STATUS } from '../contracts/index.js';
import { FileRecordEntity } from '../entities/file-record.entity.js';
import type { ListFilesQuery } from '../requests/files.requests.js';

export interface FileScopeConstraint {
  readonly unrestricted: boolean;
  readonly allowedOrgUnitIds?: readonly number[] | undefined;
  readonly selfUserId?: number | null | undefined;
}

@Injectable()
export class FilesRepository extends BaseTypeOrmRepository<FileRecordEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(FileRecordEntity, dataSource, transactionManager);
  }

  /** Tìm danh sách file theo mảng ID */
  public async findByIds(ids: readonly number[]): Promise<FileRecordEntity[]> {
    if (ids.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { id: In([...ids]) },
        order: { id: 'DESC' },
      }),
    );
  }

  /** Đếm số file (chưa bị xóa vĩnh viễn) trong một thư mục */
  public async countFilesInFolder(folderId: number): Promise<number> {
    return this.executeReadOnly(async (repo) =>
      repo
        .createQueryBuilder('f')
        .where('f.folderId = :folderId', { folderId })
        .andWhere('f.status != :purged', { purged: FILE_STATUS.PURGED })
        .getCount(),
    );
  }

  /** Tìm kiếm và lọc file có phân trang kèm kiểm soát phạm vi dữ liệu (Mục 6.1) */
  public async findPaginatedFiltered(
    query: ListFilesQuery,
    scope: FileScopeConstraint,
  ): Promise<{ items: FileRecordEntity[]; total: number }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('f');

      if (query.status !== undefined) {
        qb.andWhere('f.status = :status', { status: query.status });
      } else {
        qb.andWhere('f.status IN (:...statuses)', {
          statuses: [FILE_STATUS.ACTIVE, FILE_STATUS.MISSING],
        });
      }

      if (query.folderId !== undefined) {
        if (query.folderId === 0) {
          qb.andWhere('f.folderId IS NULL');
        } else {
          qb.andWhere('f.folderId = :folderId', { folderId: query.folderId });
        }
      }

      if (query.category !== undefined) {
        qb.andWhere('f.category = :category', { category: query.category });
      }

      if (query.visibility !== undefined) {
        qb.andWhere('f.visibility = :visibility', { visibility: query.visibility });
      }

      if (query.extension) {
        const ext = query.extension.trim().replace(/^\./, '').toLowerCase();
        qb.andWhere('LOWER(f.extension) = :ext', { ext });
      }

      if (query.mimeType) {
        const mime = query.mimeType.trim().toLowerCase();
        qb.andWhere('LOWER(f.mimeType) LIKE :mime', { mime: `%${mime}%` });
      }

      if (query.uploadedByUserId !== undefined) {
        qb.andWhere('f.uploadedByUserId = :uploadedByUserId', {
          uploadedByUserId: query.uploadedByUserId,
        });
      }

      if (query.organizationUnitId !== undefined) {
        qb.andWhere('f.organizationUnitId = :organizationUnitId', {
          organizationUnitId: query.organizationUnitId,
        });
      }

      if (query.createdFrom) {
        const fromDate = new Date(query.createdFrom);
        if (!Number.isNaN(fromDate.getTime())) {
          qb.andWhere('f.createdAt >= :createdFrom', { createdFrom: fromDate });
        }
      }

      if (query.createdTo) {
        const toDate = new Date(query.createdTo);
        if (!Number.isNaN(toDate.getTime())) {
          qb.andWhere('f.createdAt <= :createdTo', { createdTo: toDate });
        }
      }

      if (query.minSizeBytes !== undefined) {
        qb.andWhere('f.sizeBytes >= :minSizeBytes', { minSizeBytes: query.minSizeBytes });
      }

      if (query.maxSizeBytes !== undefined) {
        qb.andWhere('f.sizeBytes <= :maxSizeBytes', { maxSizeBytes: query.maxSizeBytes });
      }

      if (query.onlyReferenced === true) {
        qb.andWhere('f.usageCount > 0');
      } else if (query.onlyUnused === true) {
        qb.andWhere('f.usageCount = 0');
      }

      if (query.search) {
        const keyword = `%${query.search.trim().toLowerCase()}%`;
        qb.andWhere(
          '(LOWER(f.displayName) LIKE :keyword OR LOWER(f.originalName) LIKE :keyword OR LOWER(f.code) LIKE :keyword)',
          { keyword },
        );
      }

      if (!scope.unrestricted) {
        const orgIds = scope.allowedOrgUnitIds ?? [];
        const selfId = scope.selfUserId ?? null;
        if (orgIds.length > 0 && selfId) {
          qb.andWhere(
            '(f.organizationUnitId IN (:...orgIds) OR f.uploadedByUserId = :selfId OR f.visibility >= 2)',
            { orgIds: [...orgIds], selfId },
          );
        } else if (orgIds.length > 0) {
          qb.andWhere('(f.organizationUnitId IN (:...orgIds) OR f.visibility >= 2)', {
            orgIds: [...orgIds],
          });
        } else if (selfId) {
          qb.andWhere('(f.uploadedByUserId = :selfId OR f.visibility >= 2)', { selfId });
        } else {
          qb.andWhere('f.visibility >= 2');
        }
      }

      qb.orderBy('f.createdAt', 'DESC').addOrderBy('f.id', 'DESC').skip(skip).take(limit);

      const [items, total] = await qb.getManyAndCount();
      return { items, total };
    });
  }

  /** Lấy toàn bộ file đang hoạt động và trong thùng rác để tính thống kê */
  public async findAllForStats(): Promise<FileRecordEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo
        .createQueryBuilder('f')
        .where('f.status IN (:...statuses)', {
          statuses: [FILE_STATUS.ACTIVE, FILE_STATUS.TRASHED],
        })
        .getMany(),
    );
  }

  /** Tìm các file trong thùng rác đã quá thời gian chờ (`purge_after_at <= now`) */
  public async findExpiredTrashedFiles(now: Date): Promise<FileRecordEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: {
          status: FILE_STATUS.TRASHED,
          purgeAfterAt: LessThanOrEqual(now),
        },
        order: { id: 'ASC' },
      }),
    );
  }

  /** Xóa mềm bản ghi file theo ID */
  public async softDeleteById(id: number): Promise<void> {
    await this.repository.softDelete(id);
  }
}
