import { Inject, Injectable, Optional } from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  NotFoundAppException,
  type PaginatedResult,
  SequenceRegistryService,
  defaultCodeRegistry,
  defaultSequenceRegistry,
  formatBytes,
  resolvePagination,
} from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider } from '@packages/messaging/index.js';
import {
  AuditLogService,
  DataScopeService,
  TokenService,
  type UserIdentity,
} from '@packages/security/index.js';
import { BaseStorageProvider, type ObjectStream } from '@packages/storage/index.js';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
} from '@modules/organizations/contracts/index.js';
import { type IUsersPublicService, USERS_PUBLIC_SERVICE } from '@modules/users/contracts/index.js';
import {
  type AttachFileUsageInput,
  FILE_STATUS,
  FILE_VISIBILITY,
  type FileCategoryCode,
  type FileSummary,
  type IFilesPublicService,
  getFileCategoryName,
} from '../contracts/index.js';
import type { FileRecordEntity } from '../entities/file-record.entity.js';
import { ALL_FILE_CATEGORIES } from '../enum/files.enum.js';
import { ChunkedUploadSessionManager } from '../helpers/chunked-upload-session.helper.js';
import {
  type FilesServiceContext,
  assertCanViewFile,
  canDownloadFile,
  grantFilePermission,
  listFilePermissions,
  resolveFileScopeConstraint,
  revokeFilePermission,
} from '../helpers/file-access-control.helper.js';
import {
  createSignedTemporaryDownloadLink,
  prepareFileDownload,
  prepareFileStream,
  prepareFileThumbnail,
  preparePublicFileAccess,
  prepareSignedTemporaryDownload,
} from '../helpers/file-delivery-stream.helper.js';
import {
  createFileFolder,
  deleteFileFolder,
  listFileFolders,
  updateFileFolder,
} from '../helpers/file-folder-management.helper.js';
import {
  attachFileUsageFromRequest,
  attachFileUsageRecord,
  cleanupUnusedFileRecords,
  detachFileUsageRecord,
  listFileUsages,
  moveFileToTrash,
  publishStagedFileRecord,
  purgeExpiredTrashedFiles,
  purgeFilePermanently,
  quarantineFileRecord,
  removeFileUsageById,
  restoreFileFromTrash,
  syncEntityFileUsageRecords,
  updateFileMetadata,
  verifyFileIntegrityChecksum,
} from '../helpers/file-lifecycle-governance.helper.js';
import {
  completeChunkedFileUpload,
  initChunkedFileUpload,
  uploadBatchFiles,
  uploadFileChunkPart,
  uploadSingleFile,
} from '../helpers/file-upload-orchestrator.helper.js';
import { FilesMapper } from '../mappers/files.mapper.js';
import { FileFoldersRepository } from '../repositories/file-folders.repository.js';
import { FilePermissionsRepository } from '../repositories/file-permissions.repository.js';
import { FileUsagesRepository } from '../repositories/file-usages.repository.js';
import { FilesRepository } from '../repositories/files.repository.js';
import type {
  AttachFileUsageRequest,
  CleanupUnusedFilesRequest,
  CompleteChunkedUploadRequest,
  CreateFileFolderRequest,
  CreateTemporaryDownloadLinkRequest,
  GrantFilePermissionRequest,
  InitChunkedUploadRequest,
  ListFilesQuery,
  QuarantineFileRequest,
  UpdateFileFolderRequest,
  UpdateFileMetadataRequest,
  UploadBatchFilesRequest,
  UploadChunkPartRequest,
  UploadSingleFileRequest,
} from '../requests/files.requests.js';
import type {
  ChunkedUploadInitResponse,
  ChunkedUploadPartResponse,
  CleanupUnusedFilesResponse,
  FileFolderResponse,
  FileIntegrityVerificationResponse,
  FilePermissionItemResponse,
  FileRecordResponse,
  FileStatsResponse,
  FileUploaderSummary,
  FileUsageItemResponse,
  TemporaryDownloadLinkResponse,
} from '../responses/files.response.js';
import type { ResolvedByteRange } from '../types/files.types.js';
import { FileValidationService } from './file-validation.service.js';

export type { ResolvedByteRange };

@Injectable()
export class FilesService implements IFilesPublicService {
  private readonly sequenceRegistry: SequenceRegistryService;
  public readonly chunkSessionManager = new ChunkedUploadSessionManager();

  constructor(
    public readonly filesRepo: FilesRepository,
    public readonly foldersRepo: FileFoldersRepository,
    public readonly usagesRepo: FileUsagesRepository,
    public readonly mapper: FilesMapper,
    public readonly validationService: FileValidationService,
    public readonly storage: BaseStorageProvider,
    @Optional()
    @Inject(DataScopeService)
    public readonly dataScopeService?: DataScopeService | null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService?: AuditLogService | null,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    public readonly usersPublicService?: IUsersPublicService | null,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    public readonly orgsPublicService?: IOrganizationsPublicService | null,
    @Optional()
    @Inject(SequenceRegistryService)
    sequenceRegistry?: SequenceRegistryService | null,
    @Optional()
    public readonly permissionsRepo?: FilePermissionsRepository | null,
    @Optional()
    public readonly tokenService?: TokenService | null,
    @Optional()
    public readonly messagePublisher?: BaseMessagePublisherProvider | null,
  ) {
    this.sequenceRegistry = sequenceRegistry ?? defaultSequenceRegistry;
    this.registerCodeUsageCheckers();
  }

  private get ctx(): FilesServiceContext {
    return this;
  }

  private registerCodeUsageCheckers(): void {
    const countField = async (
      field: 'status' | 'category' | 'visibility',
      numericCode: number,
    ): Promise<number> => {
      if (typeof this.filesRepo.countByCodeField === 'function') {
        return this.filesRepo.countByCodeField(field, numericCode);
      }
      const all = await this.filesRepo.findAllForStats();
      return all.filter((f) => Number(f[field]) === numericCode).length;
    };

    defaultCodeRegistry.registerUsageChecker(
      'files.status',
      'files.status',
      async ({ numericCode }) => countField('status', Number(numericCode)),
    );
    defaultCodeRegistry.registerUsageChecker(
      'files.category',
      'files.category',
      async ({ numericCode }) => countField('category', Number(numericCode)),
    );
    defaultCodeRegistry.registerUsageChecker(
      'files.visibility',
      'files.visibility',
      async ({ numericCode }) => countField('visibility', Number(numericCode)),
    );
    defaultCodeRegistry.registerUsageChecker(
      'files.permission_subject_type',
      'files.permission_subject_type',
      async () => 0,
    );
  }

  /** Giải quyết URL công khai qua Storage Adapter Contract (`StorageContract.getUrl`) */
  private async resolveStoragePublicUrl(key: string): Promise<string | null> {
    if (typeof this.storage.getUrl === 'function') {
      const resolved = await this.storage.getUrl(key).catch(() => '');
      return resolved || null;
    }
    return null;
  }

  /** Ánh xạ thực thể File sang `FileRecordResponse` kèm URL công khai/CDN cho file PUBLIC */
  public async toFileRecordResponse(
    entity: FileRecordEntity,
    options?: {
      folderName?: string | null;
      uploadedByUser?: FileUploaderSummary | null;
      usages?: readonly FileUsageItemResponse[];
      permissions?: readonly FilePermissionItemResponse[];
      canDownload?: boolean;
    },
  ): Promise<FileRecordResponse> {
    const cdnBaseUrl = this.validationService.getCdnBaseUrl(entity.organizationUnitId ?? null);
    const storagePublicUrl =
      entity.visibility === FILE_VISIBILITY.PUBLIC && entity.status === FILE_STATUS.ACTIVE
        ? await this.resolveStoragePublicUrl(entity.storageKey)
        : null;
    return this.mapper.toFileResponse(entity, {
      ...options,
      cdnBaseUrl,
      storagePublicUrl,
    });
  }

  public resolvePrimaryOrgId(actor?: UserIdentity): number | null {
    const first = actor?.organizationUnitIds?.[0];
    return typeof first === 'number' && first > 0 ? first : null;
  }

  /** Sinh mã định danh theo quy tắc cấu hình động từ `SequenceRegistryService` */
  public async generateEntityCode(
    sequenceKey: 'files.file_code' | 'files.folder_code',
    orgId?: number | null,
  ): Promise<string> {
    const generated = await this.sequenceRegistry.nextCode(
      sequenceKey,
      orgId ? { organizationUnitId: orgId } : undefined,
    );
    return generated.code;
  }

  // ─── 1. Quản lý Thư mục ảo (Logical Folders — Mục 6.2) ────────────────────

  public async listFolders(
    organizationUnitId?: number,
    actor?: UserIdentity,
  ): Promise<FileFolderResponse[]> {
    return listFileFolders(this.ctx, organizationUnitId, actor);
  }

  public async createFolder(
    input: CreateFileFolderRequest,
    actor?: UserIdentity,
  ): Promise<FileFolderResponse> {
    return createFileFolder(this.ctx, input, actor);
  }

  public async updateFolder(
    id: number,
    input: UpdateFileFolderRequest,
    actor?: UserIdentity,
  ): Promise<FileFolderResponse> {
    return updateFileFolder(this.ctx, id, input, actor);
  }

  public async deleteFolder(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ deleted: true; id: number }> {
    return deleteFileFolder(this.ctx, id, actor);
  }

  // ─── 2. Tải file lên hệ thống (Một, Nhiều hoặc Chunked 2GB+ — Mục 6.1, 6.2 & 6.3) ───

  public async uploadSingle(
    input: UploadSingleFileRequest,
    actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return uploadSingleFile(this.ctx, input, actor);
  }

  public async uploadBatch(
    input: UploadBatchFilesRequest,
    actor?: UserIdentity,
  ): Promise<{ items: FileRecordResponse[]; count: number }> {
    return uploadBatchFiles(this.ctx, input, actor);
  }

  public async initChunkedUpload(
    input: InitChunkedUploadRequest,
    actor?: UserIdentity,
  ): Promise<ChunkedUploadInitResponse> {
    return initChunkedFileUpload(this.ctx, input, actor);
  }

  public async uploadChunkPart(
    uploadId: string,
    input: UploadChunkPartRequest,
    actor?: UserIdentity,
  ): Promise<ChunkedUploadPartResponse> {
    return uploadFileChunkPart(this.ctx, uploadId, input, actor);
  }

  public async completeChunkedUpload(
    uploadId: string,
    input?: CompleteChunkedUploadRequest,
    actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return completeChunkedFileUpload(this.ctx, uploadId, input, actor);
  }

  // ─── 3. Tìm kiếm, Lọc & Xem thông tin chi tiết file (Mục 6.1) ──────────────

  private async reconcileStorageExistence(entity: FileRecordEntity): Promise<FileRecordEntity> {
    if (entity.status !== FILE_STATUS.ACTIVE && entity.status !== FILE_STATUS.MISSING) {
      return entity;
    }
    const exists = await this.storage.exists(entity.storageKey);
    if (!exists && entity.status === FILE_STATUS.ACTIVE) {
      return this.filesRepo.saveEntity({
        ...entity,
        status: FILE_STATUS.MISSING,
      });
    }
    if (exists && entity.status === FILE_STATUS.MISSING) {
      return this.filesRepo.saveEntity({
        ...entity,
        status: FILE_STATUS.ACTIVE,
      });
    }
    return entity;
  }

  public async listPaginated(
    query: ListFilesQuery,
    actor?: UserIdentity,
  ): Promise<PaginatedResult<FileRecordResponse>> {
    const { page, limit, countMode } = resolvePagination(query, {
      settingPrefix: 'files.pagination',
      defaultLimit: 20,
      maxLimit: 100,
    });
    const scope = await resolveFileScopeConstraint(this.ctx, actor);

    const { items: rawItems, total } = await this.filesRepo.findPaginatedFiltered(query, scope);
    const reconciledItems = this.validationService.shouldReconcileOnList()
      ? await Promise.all(rawItems.map((item) => this.reconcileStorageExistence(item)))
      : rawItems;
    const items =
      query.status === FILE_STATUS.ACTIVE
        ? reconciledItems.filter((item) => item.status === FILE_STATUS.ACTIVE)
        : query.status === FILE_STATUS.MISSING
          ? reconciledItems.filter((item) => item.status === FILE_STATUS.MISSING)
          : reconciledItems;

    const folderIds = [
      ...new Set(items.map((f) => f.folderId).filter((id): id is number => typeof id === 'number')),
    ];
    const uploaderIds = [
      ...new Set(
        items.map((f) => f.uploadedByUserId).filter((id): id is number => typeof id === 'number'),
      ),
    ];

    const [folders, uploaderMap] = await Promise.all([
      this.foldersRepo.findByIds(folderIds),
      this.loadUploaderSummaries(uploaderIds),
    ]);
    const folderMap = new Map(folders.map((f) => [f.id, f.name]));

    const mapped = await Promise.all(
      items.map((entity) =>
        this.toFileRecordResponse(entity, {
          folderName: entity.folderId ? (folderMap.get(entity.folderId) ?? null) : null,
          uploadedByUser: entity.uploadedByUserId
            ? (uploaderMap.get(entity.uploadedByUserId) ?? null)
            : null,
        }),
      ),
    );

    return createPaginatedResult(
      mapped,
      countMode === 'none' ? null : total,
      page,
      limit,
      query.fields ? { fields: query.fields } : undefined,
    );
  }

  public async getById(id: number, actor?: UserIdentity): Promise<FileRecordResponse> {
    const found = await this.filesRepo.findById(id);
    if (!found || found.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }

    await assertCanViewFile(this.ctx, found, actor);
    const entity = await this.reconcileStorageExistence(found);

    const [folder, uploaderMap, usages, permissions, downloadable] = await Promise.all([
      entity.folderId ? this.foldersRepo.findById(entity.folderId) : Promise.resolve(null),
      this.loadUploaderSummaries(entity.uploadedByUserId ? [entity.uploadedByUserId] : []),
      this.usagesRepo.findByFileId(entity.id),
      this.permissionsRepo ? this.permissionsRepo.findByFileId(entity.id) : Promise.resolve([]),
      canDownloadFile(this.ctx, entity, actor),
    ]);

    return this.toFileRecordResponse(entity, {
      folderName: folder?.name ?? null,
      uploadedByUser: entity.uploadedByUserId
        ? (uploaderMap.get(entity.uploadedByUserId) ?? null)
        : null,
      usages: usages.map((u) => this.mapper.toUsageResponse(u)),
      permissions: permissions.map((p) => this.mapper.toPermissionResponse(p)),
      canDownload: downloadable,
    });
  }

  public async getStats(actor?: UserIdentity): Promise<FileStatsResponse> {
    const orgId = this.resolvePrimaryOrgId(actor);
    const [allFiles, folders] = await Promise.all([
      this.filesRepo.findAllForStats(),
      this.foldersRepo.findAllOrdered(),
    ]);

    let totalActiveFiles = 0;
    let totalActiveBytes = 0;
    let totalTrashedFiles = 0;
    let totalTrashedBytes = 0;
    let totalReferencedFiles = 0;
    let currentUserActiveBytes = 0;

    const categoryTotals = new Map<FileCategoryCode, { count: number; bytes: number }>();
    for (const cat of ALL_FILE_CATEGORIES) {
      categoryTotals.set(cat, { count: 0, bytes: 0 });
    }

    for (const file of allFiles) {
      const size = Number(file.sizeBytes) || 0;
      if (file.status === FILE_STATUS.ACTIVE) {
        totalActiveFiles++;
        totalActiveBytes += size;
        if (actor?.id && file.uploadedByUserId === actor.id) {
          currentUserActiveBytes += size;
        }
        if ((Number(file.usageCount) || 0) > 0) {
          totalReferencedFiles++;
        }
        const entry = categoryTotals.get(file.category) ?? { count: 0, bytes: 0 };
        entry.count += 1;
        entry.bytes += size;
        categoryTotals.set(file.category, entry);
      } else if (file.status === FILE_STATUS.TRASHED) {
        totalTrashedFiles++;
        totalTrashedBytes += size;
      }
    }

    return {
      totalActiveFiles,
      totalActiveBytes,
      totalActiveFormatted: formatBytes(totalActiveBytes),
      totalTrashedFiles,
      totalTrashedBytes,
      totalTrashedFormatted: formatBytes(totalTrashedBytes),
      totalReferencedFiles,
      totalFolders: folders.length,
      currentUserActiveBytes,
      currentUserActiveFormatted: formatBytes(currentUserActiveBytes),
      byCategory: ALL_FILE_CATEGORIES.map((category) => {
        const stat = categoryTotals.get(category) ?? { count: 0, bytes: 0 };
        return {
          category,
          categoryName: getFileCategoryName(category),
          count: stat.count,
          bytes: stat.bytes,
          bytesFormatted: formatBytes(stat.bytes),
        };
      }),
      settings: {
        maxUploadSizeMb: this.validationService.getMaxUploadSizeMb(orgId),
        allowedExtensions: this.validationService.getAllowedExtensions(orgId),
        trashRetentionDays: this.validationService.getTrashRetentionDays(orgId),
        maxBatchFiles: this.validationService.getMaxBatchFiles(orgId),
        verifyMagicBytes: this.validationService.shouldVerifyMagicBytes(orgId),
        defaultVisibility: this.validationService.getDefaultVisibility(orgId),
        storageQuotaMb: this.validationService.getStorageQuotaMb(orgId),
        userStorageQuotaMb: this.validationService.getUserStorageQuotaMb(orgId),
        tempLinkDefaultTtlSec: this.validationService.getTempLinkDefaultTtlSec(orgId),
        tempLinkMaxTtlSec: this.validationService.getTempLinkMaxTtlSec(orgId),
        reconcileOnList: this.validationService.shouldReconcileOnList(),
        storageKeyPrefix: this.validationService.getStorageKeyPrefix(),
        categoryAllowedExtensions: this.validationService.getCategoryAllowedExtensions(orgId),
        categoryMaxSizeMb: this.validationService.getCategoryMaxSizeMap(orgId),
        moduleMaxSizeMb: this.validationService.getModuleMaxSizeMap(orgId),
        malwareScanEnabled: this.validationService.isMalwareScanEnabled(orgId),
        stageBeforePublish: this.validationService.shouldStageBeforePublish(orgId),
        duplicatePolicy: this.validationService.getDuplicatePolicy(orgId),
        thumbnailEnabled: this.validationService.isThumbnailEnabled(orgId),
        thumbnailMaxDim: this.validationService.getThumbnailMaxDim(orgId),
        optimizeImageEnabled: this.validationService.isOptimizeImageEnabled(orgId),
        imageMaxWidth: this.validationService.getImageMaxWidth(orgId),
        imageMaxHeight: this.validationService.getImageMaxHeight(orgId),
        imageQuality: this.validationService.getImageQuality(orgId),
        unusedRetentionDays: this.validationService.getUnusedRetentionDays(orgId),
        cdnBaseUrl: this.validationService.getCdnBaseUrl(orgId),
      },
    };
  }

  // ─── 4. Tải file xuống, Stream Video, Thumbnail & Link tải tạm thời (Mục 6.1, 6.2, 6.3, 6.4) ─

  public async prepareDownload(
    id: number,
    actor?: UserIdentity,
  ): Promise<{
    stream: ObjectStream;
    file: FileRecordResponse;
    downloadFileName: string;
  }> {
    return prepareFileDownload(this.ctx, id, actor);
  }

  public async prepareStream(
    id: number,
    rangeHeader?: string,
    actor?: UserIdentity,
  ): Promise<{
    stream: ObjectStream;
    file: FileRecordResponse;
    byteRange: ResolvedByteRange | null;
  }> {
    return prepareFileStream(this.ctx, id, rangeHeader, actor);
  }

  public async preparePublicAccess(id: number): Promise<{
    redirectUrl: string | null;
    stream: ObjectStream | null;
    file: FileRecordResponse;
    downloadFileName: string;
  }> {
    return preparePublicFileAccess(this.ctx, id);
  }

  public async prepareThumbnail(
    id: number,
    actor?: UserIdentity,
  ): Promise<{
    stream: ObjectStream;
    mimeType: string;
    file: FileRecordResponse;
  }> {
    return prepareFileThumbnail(this.ctx, id, actor);
  }

  public async createTemporaryDownloadLink(
    fileId: number,
    input?: CreateTemporaryDownloadLinkRequest,
    actor?: UserIdentity,
  ): Promise<TemporaryDownloadLinkResponse> {
    return createSignedTemporaryDownloadLink(this.ctx, fileId, input, actor);
  }

  public async prepareTemporaryDownload(token: string): Promise<{
    stream: ObjectStream;
    file: FileRecordResponse;
    downloadFileName: string;
    disposition: 'attachment' | 'inline';
  }> {
    return prepareSignedTemporaryDownload(this.ctx, token);
  }

  // ─── 5. Đổi tên file & Di chuyển thư mục (Không đổi file gốc trong Storage) ─

  public async updateMetadata(
    id: number,
    input: UpdateFileMetadataRequest,
    actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return updateFileMetadata(this.ctx, id, input, actor);
  }

  // ─── 6. Phân quyền Xem & Tải file chi tiết (`file_permissions` — Mục 6.2) ──

  public async listPermissions(
    fileId: number,
    actor?: UserIdentity,
  ): Promise<FilePermissionItemResponse[]> {
    return listFilePermissions(this.ctx, fileId, actor);
  }

  public async grantPermission(
    fileId: number,
    input: GrantFilePermissionRequest,
    actor?: UserIdentity,
  ): Promise<FilePermissionItemResponse> {
    return grantFilePermission(this.ctx, fileId, input, actor);
  }

  public async revokePermission(
    fileId: number,
    permissionId: number,
    actor?: UserIdentity,
  ): Promise<{ revoked: true; permissionId: number }> {
    return revokeFilePermission(this.ctx, fileId, permissionId, actor);
  }

  // ─── 7. Vòng đời Thùng rác, Khôi phục, Xóa vĩnh viễn & Quản trị an toàn (Mục 6.1 & 6.3) ─

  public async moveToTrash(id: number, actor?: UserIdentity): Promise<FileRecordResponse> {
    return moveFileToTrash(this.ctx, id, actor);
  }

  public async restoreFromTrash(id: number, actor?: UserIdentity): Promise<FileRecordResponse> {
    return restoreFileFromTrash(this.ctx, id, actor);
  }

  public async purgeFile(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ purged: true; id: number; storageKey: string }> {
    return purgeFilePermanently(this.ctx, id, actor);
  }

  public async purgeExpiredTrash(
    actor?: UserIdentity,
    options?: { readonly skipQueuePublish?: boolean },
  ): Promise<{ purgedCount: number; purgedIds: number[] }> {
    return purgeExpiredTrashedFiles(this.ctx, actor, options);
  }

  public async publishStagedFile(id: number, actor?: UserIdentity): Promise<FileRecordResponse> {
    return publishStagedFileRecord(this.ctx, id, actor);
  }

  public async quarantineFile(
    id: number,
    input?: QuarantineFileRequest | string,
    actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return quarantineFileRecord(this.ctx, id, input, actor);
  }

  public async verifyFileIntegrity(
    id: number,
    actor?: UserIdentity,
  ): Promise<FileIntegrityVerificationResponse> {
    return verifyFileIntegrityChecksum(this.ctx, id, actor);
  }

  public async cleanupUnusedFiles(
    input?: CleanupUnusedFilesRequest,
    actor?: UserIdentity,
  ): Promise<CleanupUnusedFilesResponse> {
    return cleanupUnusedFileRecords(this.ctx, input, actor);
  }

  // ─── 8. Theo dõi liên kết sử dụng file (`file_usages` & Public Contract) ───

  public async listUsages(fileId: number, actor?: UserIdentity): Promise<FileUsageItemResponse[]> {
    return listFileUsages(this.ctx, fileId, actor);
  }

  public async attachUsageFromRequest(
    fileId: number,
    input: AttachFileUsageRequest,
    actor?: UserIdentity,
  ): Promise<FileUsageItemResponse> {
    return attachFileUsageFromRequest(this.ctx, fileId, input, actor);
  }

  public async removeUsageById(
    fileId: number,
    usageId: number,
    actor?: UserIdentity,
  ): Promise<{ removed: true; usageId: number; usageCount: number }> {
    return removeFileUsageById(this.ctx, fileId, usageId, actor);
  }

  // ─── IFilesPublicService Implementation ───────────────────────────────────

  public async findByIds(ids: readonly number[]): Promise<FileSummary[]> {
    const entities = await this.filesRepo.findByIds(ids);
    return entities
      .filter((e) => e.status !== FILE_STATUS.PURGED)
      .map((e) => this.mapper.toFileSummary(e));
  }

  public async ensureActiveFilesExist(ids: readonly number[]): Promise<FileSummary[]> {
    if (ids.length === 0) return [];
    const uniqueIds = [...new Set(ids)];
    const entities = await this.filesRepo.findByIds(uniqueIds);
    const active = entities.filter((e) => e.status === FILE_STATUS.ACTIVE);
    if (active.length !== uniqueIds.length) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    return active.map((e) => this.mapper.toFileSummary(e));
  }

  public async attachUsage(input: AttachFileUsageInput): Promise<void> {
    return attachFileUsageRecord(this.ctx, input);
  }

  public async detachUsage(params: {
    readonly fileId: number;
    readonly moduleName: string;
    readonly entityType: string;
    readonly entityId: string | number;
    readonly fieldName?: string;
  }): Promise<void> {
    return detachFileUsageRecord(this.ctx, params);
  }

  public async syncEntityFileUsages(params: {
    readonly moduleName: string;
    readonly entityType: string;
    readonly entityId: string | number;
    readonly fieldName?: string;
    readonly fileIds: readonly number[];
    readonly note?: string | null;
    readonly actorId?: number | null;
  }): Promise<void> {
    return syncEntityFileUsageRecords(this.ctx, params);
  }

  // ─── Shared Helpers (Users & Audit) ───────────────────────────────────────

  public async loadUploaderSummaries(
    userIds: readonly number[],
  ): Promise<Map<number, FileUploaderSummary>> {
    const map = new Map<number, FileUploaderSummary>();
    if (!this.usersPublicService || userIds.length === 0) {
      return map;
    }
    const uniqueIds = [...new Set(userIds)];
    await Promise.all(
      uniqueIds.map(async (uid) => {
        const user = await this.usersPublicService!.findAuthUserById(uid).catch(() => null);
        if (user) {
          map.set(uid, {
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            email: user.email,
          });
        }
      }),
    );
    return map;
  }

  public async recordAudit(
    actor: UserIdentity | undefined,
    action: string,
    resourceType: string,
    resourceId: string,
    beforeData: Record<string, unknown> | null,
    afterData: Record<string, unknown> | null,
  ): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService
      .record({
        actor: actor ?? null,
        actorUserId: actor?.id ?? null,
        actorIdentifier: actor?.email ?? actor?.username ?? 'system',
        module: 'files',
        feature: 'file_management',
        action,
        resourceType,
        resourceId,
        beforeData,
        afterData,
      })
      .catch(() => undefined);
  }
}
