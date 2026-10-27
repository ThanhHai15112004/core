import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  SearchRegistryService,
  defaultSearchRegistry,
  discoverManifestSearchableEntities,
  type ExternalSearchEngineClientContract,
  type RegisteredSearchableEntity,
  type SearchActorScopeContext,
  type SearchDataScopeType,
  type SearchDocumentInput,
  type SearchIndexLagReport,
  type SearchQueryInput,
  type SearchQueryResult,
  type SearchSyncExecutionMode,
  type SearchSyncHistoryRecord,
  type ZeroResultKeywordStat,
} from '@packages/kernel/index.js';
import {
  BaseMessagePublisherProvider,
  JOB_PRIORITIES,
  QUEUES,
  type MessageEnvelope,
} from '@packages/messaging/index.js';
import {
  DATA_SCOPE,
  DataScopeService,
  getDataScopeName,
  parseDataScope,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
} from '@modules/organizations/contracts/index.js';
import { UsersService } from '../services/users.service.js';
import type { UserResponse } from '../responses/users.response.js';

export const USERS_SEARCH_ENTITY_CODE = 'users.account';

export interface SyncUserSearchIndexRequest {
  readonly userIds?: readonly number[] | undefined;
  readonly async?: boolean | undefined;
  readonly sourceUpdatedAtOverride?: string | Date | undefined;
  readonly indexedAtOverride?: string | Date | undefined;
}

export interface RebuildUserSearchIndexRequest {
  readonly module?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityCode?: string | undefined;
  readonly async?: boolean | undefined;
}

export interface SearchUsersGlobalQuery {
  readonly keyword: string;
  readonly module?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityCode?: string | undefined;
  readonly status?: number | string | undefined;
  readonly organizationUnitId?: number | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly includeStale?: boolean | undefined;
}

export interface ExecuteUserSearchSyncOptions {
  readonly skipQueuePublish?: boolean | undefined;
  readonly existingHistoryId?: number | undefined;
  readonly jobId?: string | undefined;
  readonly executionMode?: SearchSyncExecutionMode | undefined;
}

@Injectable()
export class UserSearchService {
  private readonly searchRegistry: SearchRegistryService;

  constructor(
    private readonly usersService: UsersService,
    @Optional() searchRegistry?: SearchRegistryService,
    @Optional() private readonly dataScopeService?: DataScopeService | null,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider | null,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsPublicService?: IOrganizationsPublicService | null,
  ) {
    this.searchRegistry = searchRegistry ?? defaultSearchRegistry;
    this.ensureModuleSearchEntitiesRegistered();
  }

  /**
   * 8.5.1 — Đăng ký thực thể tìm kiếm `users.account` từ `module.manifest.json` và gắn Document Loader phục vụ `rebuildIndex`.
   */
  public ensureModuleSearchEntitiesRegistered(): void {
    const discovered = discoverManifestSearchableEntities().filter(
      (item) => item.module === 'users',
    );
    if (discovered.length > 0) {
      this.searchRegistry.registerManifestSearchableEntities(discovered);
    }

    if (!this.searchRegistry.getSearchableEntity(USERS_SEARCH_ENTITY_CODE)) {
      this.searchRegistry.registerSearchableEntity({
        code: USERS_SEARCH_ENTITY_CODE,
        module: 'users',
        entityType: 'user',
        name: 'Tài khoản & Hồ sơ nhân sự',
        description:
          'Tìm kiếm cán bộ nhân viên theo họ tên, mã nhân viên, tên đăng nhập, email và số điện thoại',
        requiredPermission: 'users.read',
        searchableFields: ['fullName', 'employeeCode', 'username', 'email', 'phone'],
        titleField: 'fullName',
        subtitleField: 'email',
        staleThresholdMs: 300_000,
        isSystem: true,
        status: 1,
      });
    }

    this.searchRegistry.registerEntityDocumentLoader(USERS_SEARCH_ENTITY_CODE, async () => {
      return this.loadUserSearchDocuments();
    });

    const searchExecutor = {
      module: 'users',
      entityCode: USERS_SEARCH_ENTITY_CODE,
      syncTopic: 'users.search_sync',
      rebuildTopic: 'users.search_rebuild',
      executeSearchJob: async (input: {
        readonly operation: 'search_sync' | 'search_rebuild';
        readonly module?: string | undefined;
        readonly entityType?: string | undefined;
        readonly entityCode?: string | undefined;
        readonly documentIds?: readonly (number | string)[] | undefined;
        readonly actorId?: number | undefined;
        readonly actor?: unknown;
        readonly historyId?: number | undefined;
        readonly jobId: string;
      }) => {
        const effectiveActor: UserIdentity | undefined =
          (input.actor as UserIdentity | undefined) ??
          (input.actorId !== undefined
            ? {
                id: input.actorId,
                roles: [],
                permissions: ['users.update', 'users.read'],
              }
            : undefined);

        if (input.operation === 'search_rebuild') {
          return this.rebuildSearchIndex(
            {
              ...(input.module ? { module: input.module } : {}),
              ...(input.entityType ? { entityType: input.entityType } : {}),
              ...(input.entityCode ? { entityCode: input.entityCode } : {}),
              async: false,
            },
            effectiveActor,
            {
              skipQueuePublish: true,
              ...(input.historyId !== undefined ? { existingHistoryId: input.historyId } : {}),
              jobId: input.jobId,
              executionMode: 'QUEUE',
            },
          );
        }

        const numericUserIds = Array.isArray(input.documentIds)
          ? input.documentIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
          : undefined;

        return this.syncUsersToSearchIndex(
          {
            ...(numericUserIds && numericUserIds.length > 0 ? { userIds: numericUserIds } : {}),
            async: false,
          },
          effectiveActor,
          {
            skipQueuePublish: true,
            ...(input.historyId !== undefined ? { existingHistoryId: input.historyId } : {}),
            jobId: input.jobId,
            executionMode: 'QUEUE',
          },
        );
      },
    };

    this.searchRegistry.registerWorkerExecutor(searchExecutor);
    if (this.searchRegistry !== defaultSearchRegistry) {
      defaultSearchRegistry.registerWorkerExecutor(searchExecutor);
    }
  }

  /**
   * 8.5.1 — Lấy danh sách các thực thể tìm kiếm đã đăng ký.
   */
  public listSearchableEntities(options?: {
    readonly includeAllModules?: boolean | undefined;
    readonly entityType?: string | undefined;
  }): RegisteredSearchableEntity[] {
    this.ensureModuleSearchEntitiesRegistered();
    if (options?.includeAllModules) {
      this.searchRegistry.syncFromManifests();
    }
    return this.searchRegistry.listSearchableEntities({
      ...(options?.includeAllModules ? {} : { module: 'users' }),
      ...(options?.entityType ? { entityType: options.entityType } : {}),
    });
  }

  /**
   * 8.5.3 — Cắm hoặc gỡ client Elasticsearch / OpenSearch tùy chọn lúc runtime.
   */
  public registerExternalSearchClient(client: ExternalSearchEngineClientContract | null): void {
    this.searchRegistry.registerExternalSearchClient(client);
  }

  /**
   * Chuyển đổi `UserResponse` thành `SearchDocumentInput` chuẩn cho Search Index.
   */
  public mapUserToSearchDocument(
    user: UserResponse,
    overrides?: {
      readonly sourceUpdatedAt?: string | Date | undefined;
      readonly indexedAt?: string | Date | undefined;
    },
  ): SearchDocumentInput {
    const primaryOrgUnit =
      user.organizationUnits?.find((unit) => unit.isPrimary) ?? user.organizationUnits?.[0];
    const organizationUnitId = primaryOrgUnit?.organizationUnitId ?? null;
    const roleCodes = (user.roles ?? []).map((role) => role.code);

    const keywords: string[] = [
      user.username,
      user.email,
      ...(user.employeeCode ? [user.employeeCode] : []),
      ...(user.phone ? [user.phone] : []),
      ...roleCodes,
    ];

    return {
      id: user.id,
      entityCode: USERS_SEARCH_ENTITY_CODE,
      module: 'users',
      entityType: 'user',
      title: user.fullName || user.username,
      subtitle: user.email,
      keywords,
      searchableText: [
        user.fullName,
        user.username,
        user.email,
        user.employeeCode ?? '',
        user.phone ?? '',
        primaryOrgUnit?.name ?? '',
      ]
        .filter((part) => Boolean(part))
        .join(' '),
      ownerId: user.id,
      organizationUnitId,
      status: user.status,
      metadata: {
        username: user.username,
        email: user.email,
        employeeCode: user.employeeCode ?? null,
        phone: user.phone ?? null,
        roles: roleCodes,
        organizationUnitId,
      },
      sourceUpdatedAt: overrides?.sourceUpdatedAt ?? user.updatedAt ?? user.createdAt,
      indexedAt: overrides?.indexedAt ?? new Date().toISOString(),
    };
  }

  /**
   * Nạp danh sách tài liệu người dùng từ Database theo từng trang (batch 500 bản ghi/trang)
   * để đồng bộ hoặc tạo lại Search Index đầy đủ không bị giới hạn cứng ở 500 người dùng đầu tiên.
   */
  public async loadUserSearchDocuments(
    userIds?: readonly number[],
    overrides?: {
      readonly sourceUpdatedAt?: string | Date | undefined;
      readonly indexedAt?: string | Date | undefined;
    },
  ): Promise<SearchDocumentInput[]> {
    const pageSize = 500;
    const maxPages = 100;
    const collectedUsers: UserResponse[] = [];
    const seenIds = new Set<number>();

    const serviceWithPagination = this.usersService as UsersService & {
      findAll?: UsersService['listPaginated'];
      listPaginated?: UsersService['listPaginated'];
    };

    for (let page = 1; page <= maxPages; page += 1) {
      const fetchFn =
        typeof serviceWithPagination.findAll === 'function'
          ? serviceWithPagination.findAll.bind(this.usersService)
          : serviceWithPagination.listPaginated?.bind(this.usersService);

      if (!fetchFn) {
        break;
      }

      const result = await fetchFn({
        page,
        limit: pageSize,
        sortBy: 'id',
        sortOrder: 'ASC',
      });

      const batch: readonly UserResponse[] = Array.isArray(result?.data) ? result.data : [];
      let newlyAdded = 0;
      for (const user of batch) {
        if (!seenIds.has(user.id)) {
          seenIds.add(user.id);
          collectedUsers.push(user);
          newlyAdded += 1;
        }
      }

      const total = result?.meta?.total;
      const hasNextPage = result?.meta?.hasNextPage;
      if (
        batch.length < pageSize ||
        newlyAdded === 0 ||
        hasNextPage === false ||
        (typeof total === 'number' && collectedUsers.length >= total)
      ) {
        break;
      }
    }

    const idFilter = Array.isArray(userIds) && userIds.length > 0 ? new Set<number>(userIds) : null;
    const filteredUsers = idFilter
      ? collectedUsers.filter((user: UserResponse) => idFilter.has(user.id))
      : collectedUsers;

    return filteredUsers.map((user: UserResponse) => this.mapUserToSearchDocument(user, overrides));
  }

  /**
   * 8.5.4 — Đồng bộ dữ liệu người dùng sang Search Index (chạy trực tiếp hoặc đẩy vào Queue `system.heavy`).
   */
  public async syncUsersToSearchIndex(
    request?: SyncUserSearchIndexRequest,
    actor?: UserIdentity,
    options?: ExecuteUserSearchSyncOptions,
  ): Promise<SearchSyncHistoryRecord> {
    this.ensureModuleSearchEntitiesRegistered();

    const shouldEnqueue =
      request?.async === true &&
      options?.skipQueuePublish !== true &&
      Boolean(this.messagePublisher);

    if (shouldEnqueue) {
      return this.enqueueSearchSync(request ?? {}, actor);
    }

    const docs = await this.loadUserSearchDocuments(request?.userIds, {
      ...(request?.sourceUpdatedAtOverride
        ? { sourceUpdatedAt: request.sourceUpdatedAtOverride }
        : {}),
      ...(request?.indexedAtOverride ? { indexedAt: request.indexedAtOverride } : {}),
    });

    const synced = await this.searchRegistry.syncDocuments(docs, {
      actorId: actor?.id ?? null,
      executionMode: options?.executionMode ?? 'SYNC',
      ...(options?.jobId !== undefined ? { jobId: options.jobId } : {}),
      ...(options?.existingHistoryId !== undefined
        ? { existingHistoryId: options.existingHistoryId }
        : {}),
    });

    return synced.history;
  }

  /**
   * 8.5.4 — Đẩy tác vụ đồng bộ dữ liệu sang Search Index vào hàng đợi `QUEUES.SYSTEM_HEAVY`.
   */
  public async enqueueSearchSync(
    request: SyncUserSearchIndexRequest,
    actor?: UserIdentity,
  ): Promise<SearchSyncHistoryRecord> {
    const jobId = `search_sync_${Date.now()}`;
    const history = this.searchRegistry.createSyncHistory({
      operation: 'SYNC',
      module: 'users',
      entityType: 'user',
      entityCode: USERS_SEARCH_ENTITY_CODE,
      driverUsed: this.searchRegistry.getActiveDriver(),
      executionMode: 'QUEUE',
      status: 'QUEUED',
      indexedCount: 0,
      removedCount: 0,
      jobId,
      actorId: actor?.id ?? null,
    });

    if (this.messagePublisher) {
      const envelope: MessageEnvelope & { readonly priority?: number } = {
        id: jobId,
        topic: 'users.search_sync',
        timestamp: new Date().toISOString(),
        priority: JOB_PRIORITIES.NORMAL,
        payload: {
          operation: 'search_sync',
          executeInWorker: true,
          historyId: history.id,
          actorId: actor?.id,
          actor,
          userIds: request.userIds ? [...request.userIds] : undefined,
        },
      };
      const publisherCompat = this.messagePublisher as unknown as {
        publish: (queueOrTopic: string, envelopeOrPayload: unknown) => Promise<unknown>;
      };
      await publisherCompat.publish(QUEUES.SYSTEM_HEAVY, envelope);
    }

    return history;
  }

  /**
   * 8.5.5 — Cho phép tạo lại toàn bộ Index (`rebuildIndex`) theo module hoặc loại dữ liệu (`entityType`),
   * hỗ trợ chạy trực tiếp hoặc đẩy qua Queue `QUEUES.SYSTEM_HEAVY`.
   */
  public async rebuildSearchIndex(
    request?: RebuildUserSearchIndexRequest,
    actor?: UserIdentity,
    options?: ExecuteUserSearchSyncOptions,
  ): Promise<SearchSyncHistoryRecord> {
    this.ensureModuleSearchEntitiesRegistered();

    const targetModule = request?.module?.trim() || 'users';
    const targetEntityType = request?.entityType?.trim();
    const targetEntityCode = request?.entityCode?.trim();

    const shouldEnqueue =
      request?.async === true &&
      options?.skipQueuePublish !== true &&
      Boolean(this.messagePublisher);

    if (shouldEnqueue) {
      const jobId = `search_rebuild_${Date.now()}`;
      const queuedHistory = this.searchRegistry.createSyncHistory({
        operation: 'REBUILD',
        module: targetModule,
        entityType: targetEntityType ?? 'user',
        entityCode: targetEntityCode ?? USERS_SEARCH_ENTITY_CODE,
        driverUsed: this.searchRegistry.getActiveDriver(),
        executionMode: 'QUEUE',
        status: 'QUEUED',
        indexedCount: 0,
        removedCount: 0,
        jobId,
        actorId: actor?.id ?? null,
      });

      const envelope: MessageEnvelope & { readonly priority?: number } = {
        id: jobId,
        topic: 'users.search_rebuild',
        timestamp: new Date().toISOString(),
        priority: JOB_PRIORITIES.NORMAL,
        payload: {
          operation: 'search_rebuild',
          executeInWorker: true,
          historyId: queuedHistory.id,
          actorId: actor?.id,
          actor,
          module: targetModule,
          entityType: targetEntityType,
          entityCode: targetEntityCode,
        },
      };
      const publisherCompat = this.messagePublisher as unknown as {
        publish: (queueOrTopic: string, envelopeOrPayload: unknown) => Promise<unknown>;
      };
      await publisherCompat.publish(QUEUES.SYSTEM_HEAVY, envelope);
      return queuedHistory;
    }

    const rebuilt = await this.searchRegistry.rebuildIndex({
      module: targetModule,
      ...(targetEntityType ? { entityType: targetEntityType } : {}),
      ...(targetEntityCode ? { entityCode: targetEntityCode } : {}),
      actorId: actor?.id ?? null,
      executionMode: options?.executionMode ?? 'SYNC',
      ...(options?.jobId !== undefined ? { jobId: options.jobId } : {}),
      ...(options?.existingHistoryId !== undefined
        ? { existingHistoryId: options.existingHistoryId }
        : {}),
    });

    return rebuilt.history;
  }

  /**
   * 8.5.2, 8.5.3, 8.5.6, 8.5.7 & 8.5.8 — Tìm kiếm người dùng & thực thể liên quan:
   * - Tự động nạp dữ liệu từ Database nếu dự án nhỏ chưa chạy Index Sync trước đó (8.5.2).
   * - Áp dụng quyền (`users.read`) và `DataScope` (`ALL`, `ORG_UNIT`, `SUBORDINATES`, `SELF`) của `actor` (8.5.6).
   * - Tính toán độ trễ Index (`indexLagMs`, `isStale`) (8.5.7) và thống kê từ khóa không có kết quả (8.5.8).
   */
  public async searchUsers(
    query: SearchUsersGlobalQuery,
    actor?: UserIdentity,
    options?: {
      readonly autoSeedFromDatabase?: boolean | undefined;
      readonly scopeOverride?: SearchActorScopeContext | undefined;
    },
  ): Promise<SearchQueryResult> {
    this.ensureModuleSearchEntitiesRegistered();

    const indexedCount = this.searchRegistry.getIndexedDocumentCount({
      module: query.module ?? 'users',
    });
    if (indexedCount === 0 && options?.autoSeedFromDatabase !== false) {
      await this.syncUsersToSearchIndex(undefined, actor);
    }

    const scopeContext = options?.scopeOverride ?? (await this.resolveActorScopeContext(actor));
    const searchQuery: SearchQueryInput = {
      keyword: query.keyword,
      module: query.module ?? 'users',
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityCode ? { entityCode: query.entityCode } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.organizationUnitId !== undefined
        ? { organizationUnitId: query.organizationUnitId }
        : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.includeStale !== undefined ? { includeStale: query.includeStale } : {}),
    };

    return this.searchRegistry.search(searchQuery, scopeContext);
  }

  /**
   * 8.5.7 — Lấy báo cáo độ trễ cập nhật Search Index (`lagMs`, `isStale`).
   */
  public getSearchIndexLagReport(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly entityCode?: string | undefined;
    readonly staleOnly?: boolean | undefined;
    readonly staleThresholdMs?: number | undefined;
  }): SearchIndexLagReport {
    this.ensureModuleSearchEntitiesRegistered();
    return this.searchRegistry.getIndexLagReport({
      module: filter?.module ?? 'users',
      ...(filter?.entityType ? { entityType: filter.entityType } : {}),
      ...(filter?.entityCode ? { entityCode: filter.entityCode } : {}),
      ...(filter?.staleOnly !== undefined ? { staleOnly: filter.staleOnly } : {}),
      ...(filter?.staleThresholdMs !== undefined
        ? { staleThresholdMs: filter.staleThresholdMs }
        : {}),
    });
  }

  /**
   * 8.5.8 — Lấy thống kê các từ khóa tìm kiếm không có kết quả.
   */
  public listZeroResultKeywords(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly limit?: number | undefined;
  }): ZeroResultKeywordStat[] {
    return this.searchRegistry.listZeroResultKeywords({
      ...(filter?.module ? { module: filter.module } : {}),
      ...(filter?.entityType ? { entityType: filter.entityType } : {}),
      ...(filter?.limit !== undefined ? { limit: filter.limit } : {}),
    });
  }

  /**
   * Xem lịch sử đồng bộ / tạo lại Search Index (8.5.4 & 8.5.5).
   */
  public listSearchSyncHistories(filter?: {
    readonly module?: string | undefined;
    readonly operation?: 'SYNC' | 'REBUILD' | 'REMOVE' | undefined;
    readonly limit?: number | undefined;
  }): SearchSyncHistoryRecord[] {
    return this.searchRegistry.listSyncHistories({
      module: filter?.module ?? 'users',
      ...(filter?.operation ? { operation: filter.operation } : {}),
      ...(filter?.limit !== undefined ? { limit: filter.limit } : {}),
    });
  }

  /**
   * 8.5.6 — Giải quyết ngữ cảnh quyền và Data Scope (`ALL`, `ORG_UNIT`, `SUBORDINATES`, `SELF`) từ `UserIdentity`.
   */
  private async resolveActorScopeContext(
    actor?: UserIdentity,
  ): Promise<SearchActorScopeContext | undefined> {
    if (!actor) {
      return undefined;
    }

    const actorWithCustomScopes = actor as UserIdentity & {
      readonly organizationUnitId?: number | string | null;
      readonly allowedOrganizationUnitIds?: readonly number[];
      readonly subordinateUserIds?: readonly number[];
    };

    const actorId = typeof actor.id === 'number' ? actor.id : Number(actor.id);
    const rawOrgUnitId =
      actorWithCustomScopes.organizationUnitId ?? actor.organizationUnitIds?.[0] ?? null;
    const organizationUnitId =
      typeof rawOrgUnitId === 'number' ? rawOrgUnitId : rawOrgUnitId ? Number(rawOrgUnitId) : null;

    let resolvedScopes: SearchDataScopeType[] = ['ALL'];
    if (this.dataScopeService) {
      try {
        const scopeFilter = await this.dataScopeService.resolveScopeFilter(actor, 'users', 'read');
        if (Array.isArray(scopeFilter.grantedScopes) && scopeFilter.grantedScopes.length > 0) {
          resolvedScopes = scopeFilter.grantedScopes.map((code) =>
            getDataScopeName(parseDataScope(code)),
          );
        }
      } catch {
        // Fallback to actor's explicit dataScopes if present
      }
    }

    if (Array.isArray(actor.dataScopes) && actor.dataScopes.length > 0) {
      resolvedScopes = actor.dataScopes.map((code) =>
        getDataScopeName(parseDataScope(code, DATA_SCOPE.ALL)),
      );
    }

    const allowedOrganizationUnitIds = new Set<number>(
      actorWithCustomScopes.allowedOrganizationUnitIds ?? [],
    );
    if (organizationUnitId !== null && Number.isFinite(organizationUnitId)) {
      allowedOrganizationUnitIds.add(organizationUnitId);
      const orgServiceCompat = this.organizationsPublicService as
        | (IOrganizationsPublicService & {
            getDescendantIds?: (unitId: number) => Promise<readonly number[]>;
          })
        | null
        | undefined;

      if (resolvedScopes.includes('SUBORDINATES') && orgServiceCompat) {
        try {
          if (typeof orgServiceCompat.getDescendantIds === 'function') {
            const descendants = await orgServiceCompat.getDescendantIds(organizationUnitId);
            for (const id of descendants) {
              allowedOrganizationUnitIds.add(id);
            }
          } else if (typeof orgServiceCompat.resolveDescendantUnitIds === 'function') {
            const descendants = await orgServiceCompat.resolveDescendantUnitIds([
              organizationUnitId,
            ]);
            for (const id of descendants) {
              allowedOrganizationUnitIds.add(id);
            }
          }
        } catch {
          // Ignore organization lookup failure
        }
      }
    }

    return {
      actorId: Number.isFinite(actorId) ? actorId : null,
      permissions: actor.permissions ?? ['users.read'],
      roles: actor.roles ?? [],
      dataScopes: resolvedScopes,
      organizationUnitId,
      allowedOrganizationUnitIds: Array.from(allowedOrganizationUnitIds),
      subordinateUserIds: actorWithCustomScopes.subordinateUserIds ?? [],
    };
  }
}
