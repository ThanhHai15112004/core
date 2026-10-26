import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In, LessThanOrEqual } from 'typeorm';
import {
  BaseTypeOrmRepository,
  TransactionManager,
  buildSafeLikePattern,
} from '@packages/database/index.js';
import { FILE_STATUS } from '../contracts/index.js';
import { FileRecordEntity } from '../entities/file-record.entity.js';
import type { FileSortField, ListFilesQuery } from '../requests/files.requests.js';

export const FILE_SEARCHABLE_COLUMNS = ['f.displayName', 'f.originalName', 'f.code'] as const;

export const FILE_SORT_COLUMN_MAP: Readonly<Record<FileSortField, string>> = {
  id: 'f.id',
  createdAt: 'f.createdAt',
  sizeBytes: 'f.sizeBytes',
  displayName: 'f.displayName',
  usageCount: 'f.usageCount',
};

export interface FileScopeConstraint {
  readonly unrestricted: boolean;
  readonly allowedOrgUnitIds?: readonly number[] | undefined;
  readonly selfUserId?: number | null | undefined;
  readonly explicitAllowedFileIds?: readonly number[] | undefined;
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

  /** Đếm số bản ghi file đang sử dụng một mã danh mục (`status`, `category`, `visibility`) */
  public async countByCodeField(
    field: 'status' | 'category' | 'visibility',
    numericCode: number,
  ): Promise<number> {
    return this.executeReadOnly(async (repo) =>
      repo.createQueryBuilder('f').where(`f.${field} = :numericCode`, { numericCode }).getCount(),
    );
  }

  /** Tìm kiếm và lọc file có phân trang kèm kiểm soát phạm vi dữ liệu (Mục 6.1) */
  public async findPaginatedFiltered(
    query: ListFilesQuery,
    scope: FileScopeConstraint,
  ): Promise<{ items: FileRecordEntity[]; total: number }> {
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
        qb.andWhere("LOWER(f.mimeType) LIKE :mime ESCAPE '\\\\'", {
          mime: buildSafeLikePattern(mime, 'contains'),
        });
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

      this.applyDateRange(
        qb,
        'f.createdAt',
        { from: query.createdFrom, to: query.createdTo },
        { fromFieldName: 'createdFrom', toFieldName: 'createdTo' },
      );

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

      this.applyKeywordSearch(qb, query.search ?? query.q, FILE_SEARCHABLE_COLUMNS);

      this.applyDataScope(
        qb,
        {
          unrestricted: scope.unrestricted,
          allowedOrgUnitIds: scope.allowedOrgUnitIds,
          selfUserId: scope.selfUserId,
          explicitAllowedIds: scope.explicitAllowedFileIds,
        },
        {
          alwaysAllowSqlClause: 'f.visibility >= 2',
          orgUnitColumn: 'f.organizationUnitId',
          userColumn: 'f.uploadedByUserId',
          idColumn: 'f.id',
        },
      );

      this.applySort(qb, query, FILE_SORT_COLUMN_MAP, {
        defaultSortBy: 'createdAt',
        defaultSortOrder: 'DESC',
        tieBreakerField: 'id',
      });

      const { items, total } = await this.paginateQueryBuilder(qb, query, {
        settingPrefix: 'files.pagination',
        defaultLimit: 20,
        maxLimit: 100,
      });
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

  /** Tính tổng dung lượng (bytes) của các file đang hoạt động theo đơn vị (hoặc toàn hệ thống) */
  public async sumActiveBytesByOrgUnit(organizationUnitId?: number | null): Promise<number> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('f')
        .select('COALESCE(SUM(f.sizeBytes), 0)', 'totalBytes')
        .where('f.status = :status', { status: FILE_STATUS.ACTIVE });
      if (typeof organizationUnitId === 'number' && organizationUnitId > 0) {
        qb.andWhere('f.organizationUnitId = :organizationUnitId', { organizationUnitId });
      }
      const raw = await qb.getRawOne<{ totalBytes?: string | number | null }>();
      return Number(raw?.totalBytes ?? 0) || 0;
    });
  }

  /** Tính tổng dung lượng (bytes) của các file đang hoạt động do một người dùng tải lên */
  public async sumActiveBytesByUser(userId: number): Promise<number> {
    return this.executeReadOnly(async (repo) => {
      const raw = await repo
        .createQueryBuilder('f')
        .select('COALESCE(SUM(f.sizeBytes), 0)', 'totalBytes')
        .where('f.status = :status', { status: FILE_STATUS.ACTIVE })
        .andWhere('f.uploadedByUserId = :userId', { userId })
        .getRawOne<{ totalBytes?: string | number | null }>();
      return Number(raw?.totalBytes ?? 0) || 0;
    });
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

  /** Tìm các file đang hoạt động có cùng mã băm SHA-256 (phục vụ phát hiện file trùng lặp — Mục 6.3) */
  public async findByChecksumSha256(
    checksumSha256: string,
    organizationUnitId?: number | null,
  ): Promise<FileRecordEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('f')
        .where('f.checksumSha256 = :checksumSha256', { checksumSha256 })
        .andWhere('f.status IN (:...statuses)', {
          statuses: [FILE_STATUS.ACTIVE, FILE_STATUS.PENDING_SCAN],
        })
        .orderBy('f.id', 'ASC');
      if (typeof organizationUnitId === 'number' && organizationUnitId > 0) {
        qb.andWhere('f.organizationUnitId = :organizationUnitId', { organizationUnitId });
      }
      return qb.getMany();
    });
  }

  /** Tìm các file không còn được sử dụng (`usageCount = 0`) đã vượt qua thời gian an toàn (Mục 6.3) */
  public async findUnusedFilesOlderThan(
    cutoffDate: Date,
    organizationUnitId?: number | null,
  ): Promise<FileRecordEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('f')
        .where('f.status = :status', { status: FILE_STATUS.ACTIVE })
        .andWhere('f.usageCount = 0')
        .andWhere('f.createdAt <= :cutoffDate', { cutoffDate })
        .orderBy('f.id', 'ASC');
      if (typeof organizationUnitId === 'number' && organizationUnitId > 0) {
        qb.andWhere('f.organizationUnitId = :organizationUnitId', { organizationUnitId });
      }
      return qb.getMany();
    });
  }

  /** Xóa mềm bản ghi file theo ID */
  public async softDeleteById(id: number): Promise<void> {
    await this.repository.softDelete(id);
  }
}
