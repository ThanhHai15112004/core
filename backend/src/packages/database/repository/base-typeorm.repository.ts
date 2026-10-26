import { Optional } from '@nestjs/common';
import type {
  DataSource,
  DeepPartial,
  EntityManager,
  EntityTarget,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';
import {
  ConflictAppException,
  type DateRangeInput,
  type FilterCondition,
  HTTP_ERROR_CODE,
  type RawPaginationInput,
  type ResolvePaginationOptions,
  type ResolvedPaginationParams,
  resolvePagination,
} from '@packages/kernel/index.js';
import { TransactionManager } from '../transaction/transaction-manager.service.js';
import { isUniqueConstraintError } from '../utils/error-classify.js';
import {
  type ApplyDataScopeOptions,
  type DataScopeQueryFilterInput,
  type DateRangeBuilderOptions,
  type KeywordSearchBuilderOptions,
  type QueryCoreExecutionConfig,
  type QueryCoreExecutionInput,
  type SortBuilderInput,
  type SortBuilderOptions,
  applyDataScopeToQueryBuilder,
  applyDateRangeToQueryBuilder,
  applyFilterConditionsToQueryBuilder,
  applyKeywordSearchToQueryBuilder,
  applyQueryCoreToBuilder,
  applySelectFieldsToQueryBuilder,
  applySortToQueryBuilder,
} from '../utils/query-builder-core.helper.js';

export interface PaginatedQueryBuilderResult<TEntity> extends ResolvedPaginationParams {
  readonly items: TEntity[];
  readonly total: number;
  /** Bằng `null` khi `countMode === 'none'` (dùng trực tiếp cho `createPaginatedResult` ở chế độ Lookahead). */
  readonly nullableTotal: number | null;
}

/**
 * Hàm dùng chung thực thi phân trang tối ưu trên TypeORM `SelectQueryBuilder`:
 * 1. Tự động chuẩn hóa `page`, `limit`, `skip` từ `SettingRegistryService` qua `resolvePagination`.
 * 2. Tối ưu `countMode === 'none'`: lấy `limit + 1` bản ghi (Lookahead), bỏ qua truy vấn `COUNT(*)` nặng trên bảng lớn.
 * 3. Tối ưu Short-Circuit khi `skip > 0` (từ trang 2 trở đi): kiểm tra `getCount()` trước; nếu `total === 0` hoặc `skip >= total`
 *    thì trả về mảng rỗng ngay lập tức, tránh chạy câu lệnh `SELECT ... JOIN ... ORDER BY ... OFFSET` vô ích.
 */
export async function paginateSelectQueryBuilder<TEntity extends ObjectLiteral>(
  qb: SelectQueryBuilder<TEntity>,
  input?: RawPaginationInput | null,
  options?: ResolvePaginationOptions,
): Promise<PaginatedQueryBuilderResult<TEntity>> {
  const pagination = resolvePagination(input, options);
  const { skip, limit, countMode } = pagination;

  if (countMode === 'none') {
    const items = await qb
      .skip(skip)
      .take(limit + 1)
      .getMany();
    return {
      ...pagination,
      items,
      total: skip + items.length,
      nullableTotal: null,
    };
  }

  if (skip > 0) {
    const total = await qb.getCount();
    if (total === 0 || skip >= total) {
      return {
        ...pagination,
        items: [],
        total,
        nullableTotal: total,
      };
    }
    const items = await qb.skip(skip).take(limit).getMany();
    return {
      ...pagination,
      items,
      total,
      nullableTotal: total,
    };
  }

  const [items, total] = await qb.skip(0).take(limit).getManyAndCount();
  return {
    ...pagination,
    items,
    total,
    nullableTotal: total,
  };
}

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
   * Kiểm tra xem `DataSource` hiện tại có cấu hình Read Replica (`replication`) sẵn sàng và nằm ngoài Transaction hay không.
   */
  public hasReadReplica(): boolean {
    if (this.transactionManager?.isInTransaction()) {
      return false;
    }
    const hasReplication = Boolean(
      (this.dataSource.options as { replication?: unknown } | undefined)?.replication,
    );
    return hasReplication && typeof this.dataSource.createQueryRunner === 'function';
  }

  /**
   * Thực thi tác vụ chỉ đọc (Read-Only) và trả về kèm thông tin nguồn dữ liệu thực tế (`'REPLICA' | 'PRIMARY'`).
   */
  public async executeReadOnlyWithMeta<TResult>(
    work: (repo: Repository<TEntity>, manager: EntityManager) => Promise<TResult>,
  ): Promise<{ readonly data: TResult; readonly dataSourceUsed: 'REPLICA' | 'PRIMARY' }> {
    if (!this.hasReadReplica()) {
      const data = await work(this.repository, this.manager);
      return { data, dataSourceUsed: 'PRIMARY' };
    }

    const readRunner = this.dataSource.createQueryRunner('slave');
    try {
      const readRepo = readRunner.manager.getRepository(this.entityTarget);
      const data = await work(readRepo, readRunner.manager);
      return { data, dataSourceUsed: 'REPLICA' };
    } finally {
      await readRunner.release();
    }
  }

  /**
   * Thực thi tác vụ chỉ đọc (Read-Only):
   * - Nếu đang ở trong một Transaction: luôn đọc từ Master/Transaction hiện hành để đảm bảo tính nhất quán (Read-your-own-writes).
   * - Nếu ngoài Transaction và hệ thống có cấu hình Read Replica (`replication`): mượn kết nối `'slave'` và giải phóng an toàn sau khi đọc xong.
   */
  public async executeReadOnly<TResult>(
    work: (repo: Repository<TEntity>, manager: EntityManager) => Promise<TResult>,
  ): Promise<TResult> {
    const result = await this.executeReadOnlyWithMeta(work);
    return result.data;
  }

  /** Tìm bản ghi theo khóa chính `id` */
  public async findById(id: string | number): Promise<TEntity | null> {
    return this.repository.findOne({
      where: { id } as unknown as FindOptionsWhere<TEntity>,
    });
  }

  /**
   * Thực thi phân trang tối ưu trên `SelectQueryBuilder` của Repository:
   * Chỉ cần gọi 1 dòng `return this.paginateQueryBuilder(qb, filter, { settingPrefix: '...' })`
   * để tự động áp dụng cấu hình động, giới hạn bảo vệ và tối ưu truy vấn `COUNT` / `OFFSET`.
   */
  protected async paginateQueryBuilder(
    qb: SelectQueryBuilder<TEntity>,
    input?: RawPaginationInput | null,
    options?: ResolvePaginationOptions,
  ): Promise<PaginatedQueryBuilderResult<TEntity>> {
    return paginateSelectQueryBuilder(qb, input, options);
  }

  /** Áp dụng toàn diện Query Core (Search + DateRange + Filter + DataScope + Select + Sort) chỉ với 1 dòng */
  protected applyQueryCore<TSortField extends string = string>(
    qb: SelectQueryBuilder<TEntity>,
    input: QueryCoreExecutionInput<TSortField>,
    config: QueryCoreExecutionConfig<TSortField>,
  ): SelectQueryBuilder<TEntity> {
    return applyQueryCoreToBuilder(qb, input, config);
  }

  /** Áp dụng tìm kiếm từ khóa an toàn (có escape `%`, `_`, `\`) lên danh sách cột cấu hình */
  protected applyKeywordSearch(
    qb: SelectQueryBuilder<TEntity>,
    keyword: string | undefined | null,
    searchableColumns: readonly string[],
    options?: KeywordSearchBuilderOptions,
  ): SelectQueryBuilder<TEntity> {
    return applyKeywordSearchToQueryBuilder(qb, keyword, searchableColumns, options);
  }

  /** Áp dụng lọc khoảng ngày (`from <= to`) lên cột thời gian cấu hình */
  protected applyDateRange(
    qb: SelectQueryBuilder<TEntity>,
    column: string,
    range?: DateRangeInput | null,
    options?: DateRangeBuilderOptions,
  ): SelectQueryBuilder<TEntity> {
    return applyDateRangeToQueryBuilder(qb, column, range, options);
  }

  /** Áp dụng danh sách điều kiện lọc theo whitelist cột cho phép */
  protected applyFilterConditions<TField extends string = string>(
    qb: SelectQueryBuilder<TEntity>,
    conditions: readonly FilterCondition<TField>[] | undefined | null,
    allowedColumnMap: Readonly<Record<string, string>>,
    options?: { paramPrefix?: string; maxConditions?: number; maxInValues?: number },
  ): SelectQueryBuilder<TEntity> {
    return applyFilterConditionsToQueryBuilder(qb, conditions, allowedColumnMap, options);
  }

  /** Áp dụng sắp xếp tăng/giảm có kiểm tra field trước khi query và tự gắn tie-breaker */
  protected applySort<TSortField extends string = string>(
    qb: SelectQueryBuilder<TEntity>,
    input: SortBuilderInput<TSortField> | undefined | null,
    allowedSortColumnMap: Readonly<Record<TSortField, string>>,
    options: SortBuilderOptions<TSortField>,
  ): SelectQueryBuilder<TEntity> {
    return applySortToQueryBuilder(qb, input, allowedSortColumnMap, options);
  }

  /** Áp dụng chọn cột SQL trả về theo whitelist */
  protected applySelectFields(
    qb: SelectQueryBuilder<TEntity>,
    fields: readonly string[] | undefined | null,
    selectableColumnMap: Readonly<Record<string, string>>,
    alwaysIncludeFields?: readonly string[],
  ): SelectQueryBuilder<TEntity> {
    return applySelectFieldsToQueryBuilder(qb, fields, selectableColumnMap, alwaysIncludeFields);
  }

  /** Áp dụng quyền và Data Scope (`ALL`, `ORG_UNIT`, `SUBORDINATES`, `SELF`) trực tiếp vào query */
  protected applyDataScope(
    qb: SelectQueryBuilder<TEntity>,
    scopeFilter: DataScopeQueryFilterInput | undefined | null,
    options: ApplyDataScopeOptions,
  ): SelectQueryBuilder<TEntity> {
    return applyDataScopeToQueryBuilder(qb, scopeFilter, options);
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
