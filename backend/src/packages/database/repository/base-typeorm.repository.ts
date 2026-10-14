import { Optional } from '@nestjs/common';
import type {
  DataSource,
  DeepPartial,
  EntityManager,
  EntityTarget,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';
import { ConflictAppException, HTTP_ERROR_CODE } from '@packages/kernel/index.js';
import { TransactionManager } from '../transaction/transaction-manager.service.js';
import { isUniqueConstraintError } from '../utils/error-classify.js';

/**
 * Lớp Repository cơ sở cho từng module nghiệp vụ:
 * 1. Tự động tham gia vào phiên giao dịch của `TransactionManager` (`AsyncLocalStorage`) nếu có.
 * 2. Hỗ trợ định tuyến truy vấn chỉ đọc sang Read Replica (`executeReadOnly`) khi thật sự cần.
 * 3. Tự động chuyển đổi lỗi vi phạm Unique Constraint của DB sang `ConflictAppException` (HTTP 409).
 * 4. Cung cấp `updateWithOptimisticLock` chống ghi đè dữ liệu nhạy cảm khi xảy ra tranh chấp đồng thời.
 */
export abstract class BaseTypeOrmRepository<TEntity extends ObjectLiteral> {
  constructor(
    protected readonly entityTarget: EntityTarget<TEntity>,
    protected readonly dataSource: DataSource,
    @Optional() protected readonly transactionManager: TransactionManager | null = null,
  ) {}

  /**
   * Trả về `EntityManager` của Transaction hiện hành (nếu đang trong `runInTransaction`),
   * hoặc fallback về `EntityManager` mặc định của `DataSource`.
   */
  public get manager(): EntityManager {
    return this.transactionManager?.getCurrentManager() ?? this.dataSource.manager;
  }

  /**
   * Trả về `Repository<TEntity>` gắn liền với `EntityManager` hiện hành (tự động nhận biết Transaction).
   */
  public get repository(): Repository<TEntity> {
    return this.manager.getRepository(this.entityTarget);
  }

  /**
   * Thực thi tác vụ chỉ đọc (Read-Only):
   * - Nếu đang ở trong một Transaction: luôn đọc từ Master/Transaction hiện hành để đảm bảo tính nhất quán (Read-your-own-writes).
   * - Nếu ngoài Transaction và hệ thống có cấu hình Read Replica (`replication`): mượn kết nối `'slave'` và giải phóng an toàn sau khi đọc xong.
   */
  public async executeReadOnly<TResult>(
    work: (repo: Repository<TEntity>, manager: EntityManager) => Promise<TResult>,
  ): Promise<TResult> {
    if (this.transactionManager?.isInTransaction()) {
      return work(this.repository, this.manager);
    }

    const hasReplication = Boolean(
      (this.dataSource.options as { replication?: unknown } | undefined)?.replication,
    );

    if (!hasReplication || typeof this.dataSource.createQueryRunner !== 'function') {
      return work(this.repository, this.manager);
    }

    const readRunner = this.dataSource.createQueryRunner('slave');
    try {
      const readRepo = readRunner.manager.getRepository(this.entityTarget);
      return await work(readRepo, readRunner.manager);
    } finally {
      await readRunner.release();
    }
  }

  /** Tìm bản ghi theo khóa chính `id` */
  public async findById(id: string | number): Promise<TEntity | null> {
    return this.repository.findOne({
      where: { id } as unknown as FindOptionsWhere<TEntity>,
    });
  }

  /**
   * Lưu thực thể và tự động bắt lỗi Unique Constraint (trùng dữ liệu) để ném `ConflictAppException` (409).
   */
  public async saveEntity(entity: DeepPartial<TEntity>): Promise<TEntity> {
    try {
      return await this.repository.save(entity);
    } catch (err: unknown) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictAppException(
          HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
          [],
          undefined,
          HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
        );
      }
      throw err;
    }
  }

  /**
   * Cập nhật bản ghi nhạy cảm với cơ chế Optimistic Locking:
   * - Chỉ cập nhật khi `id = :id` VÀ `version = :expectedVersion`.
   * - Tự động tăng `version` lên `expectedVersion + 1`.
   * - Nếu `affected === 0` (bản ghi đã bị thay đổi bởi tiến trình khác hoặc không khớp version),
   *   ném ngay `ConflictAppException` (`OPTIMISTIC_LOCK_VERSION_MISMATCH`, HTTP 409).
   */
  public async updateWithOptimisticLock(
    id: string | number,
    expectedVersion: number,
    partialUpdate: QueryDeepPartialEntity<TEntity>,
  ): Promise<void> {
    try {
      const nextPayload = {
        ...partialUpdate,
        version: expectedVersion + 1,
      } as unknown as QueryDeepPartialEntity<TEntity>;

      const result = await this.repository.update(
        { id, version: expectedVersion } as unknown as FindOptionsWhere<TEntity>,
        nextPayload,
      );

      if (!result.affected || result.affected === 0) {
        throw new ConflictAppException(
          HTTP_ERROR_CODE.OPTIMISTIC_LOCK_VERSION_MISMATCH,
          [{ id, expectedVersion }],
          undefined,
          HTTP_ERROR_CODE.OPTIMISTIC_LOCK_VERSION_MISMATCH,
        );
      }
    } catch (err: unknown) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictAppException(
          HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
          [],
          undefined,
          HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
        );
      }
      throw err;
    }
  }
}
