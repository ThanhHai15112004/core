import { Inject, Injectable, Optional } from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  type PaginatedResult,
  SequenceRegistryService,
  defaultCodeRegistry,
  defaultSequenceRegistry,
  formatBytes,
  resolvePagination,
  safeJsonParseObject,
} from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider, JOB_PRIORITIES, QUEUES } from '@packages/messaging/index.js';
import {
  AuditLogService,
  DATA_SCOPE,
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
  FILE_PERMISSION_SUBJECT,
  FILE_STATUS,
  FILE_VISIBILITY,
  type FileCategoryCode,
  type FilePermissionSubjectCode,
  type FileSummary,
  type IFilesPublicService,
  getFileCategoryName,
  getFileStatusName,
  parseFilePermissionSubjectType,
} from '../contracts/index.js';
import type { FileFolderEntity } from '../entities/file-folder.entity.js';
import type { FilePermissionEntity } from '../entities/file-permission.entity.js';
import type { FileRecordEntity } from '../entities/file-record.entity.js';
import { ALL_FILE_CATEGORIES, DAY_MS, FALLBACK_TEMP_LINK_SECRET } from '../enum/files.enum.js';
import { ChunkedUploadSessionManager } from '../helpers/chunked-upload-session.helper.js';
import {
  buildImmutableStorageKey,
  buildSafeDownloadFileName,
  buildThumbnailStorageKey,
  computeSha256Hex,
  parseByteRangeHeader,
  signTemporaryDownloadToken,
  slugifyFolderName,
  verifyTemporaryDownloadToken,
} from '../helpers/file-storage.helper.js';
import { FilesMapper } from '../mappers/files.mapper.js';
import { FileFoldersRepository } from '../repositories/file-folders.repository.js';
import { FilePermissionsRepository } from '../repositories/file-permissions.repository.js';
import { FileUsagesRepository } from '../repositories/file-usages.repository.js';
import { type FileScopeConstraint, FilesRepository } from '../repositories/files.repository.js';
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
import type { ResolvedByteRange, TemporaryDownloadTokenPayload } from '../types/files.types.js';
import { FileValidationService } from './file-validation.service.js';

export type { ResolvedByteRange };

@Injectable()
export class FilesService implements IFilesPublicService {
  private readonly sequenceRegistry: SequenceRegistryService;
  private readonly chunkSessionManager = new ChunkedUploadSessionManager();

  constructor(
    private readonly filesRepo: FilesRepository,
    private readonly foldersRepo: FileFoldersRepository,
    private readonly usagesRepo: FileUsagesRepository,
    private readonly mapper: FilesMapper,
    private readonly validationService: FileValidationService,
    private readonly storage: BaseStorageProvider,
    @Optional()
    @Inject(DataScopeService)
    private readonly dataScopeService?: DataScopeService | null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService?: AuditLogService | null,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService?: IUsersPublicService | null,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly orgsPublicService?: IOrganizationsPublicService | null,
    @Optional()
    @Inject(SequenceRegistryService)
    sequenceRegistry?: SequenceRegistryService | null,
    @Optional()
    private readonly permissionsRepo?: FilePermissionsRepository | null,
    @Optional()
    private readonly tokenService?: TokenService | null,
    @Optional()
    private readonly messagePublisher?: BaseMessagePublisherProvider | null,
  ) {
    this.sequenceRegistry = sequenceRegistry ?? defaultSequenceRegistry;
    this.registerCodeUsageCheckers();
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

  /** Giải quyết URL công khai của Storage Driver (nếu có) */
  private async resolveStoragePublicUrl(key: string): Promise<string | null> {
    if (typeof this.storage.getUrl === 'function') {
      return this.storage.getUrl(key).catch(() => null);
    }
    if (typeof this.storage.driver?.url === 'function') {
      return this.storage.driver.url(key);
    }
    return null;
  }

  /** Ánh xạ thực thể File sang `FileRecordResponse` kèm URL công khai/CDN cho file PUBLIC */
  private async toFileRecordResponse(
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

  private resolvePrimaryOrgId(actor?: UserIdentity): number | null {
    const first = actor?.organizationUnitIds?.[0];
    return typeof first === 'number' && first > 0 ? first : null;
  }

  /** Sinh mã định danh theo quy tắc cấu hình động từ `SequenceRegistryService` */
  private async generateEntityCode(
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

  /** Lấy danh sách thư mục lưu trữ (có lọc theo phạm vi dữ liệu của người dùng) */
  public async listFolders(
    organizationUnitId?: number,
    actor?: UserIdentity,
  ): Promise<FileFolderResponse[]> {
    const folders = await this.foldersRepo.findAllOrdered(organizationUnitId);
    const scope = await this.resolveFileScopeConstraint(actor);
    if (scope.unrestricted) {
      return folders.map((f) => this.mapper.toFolderResponse(f));
    }

    const visibleFolders = folders.filter((f) => this.isFolderAccessibleInScope(f, scope));
    return visibleFolders.map((f) => this.mapper.toFolderResponse(f));
  }

  /** Tạo thư mục mới trong File Manager (kiểm tra quyền, chống trùng tên cùng cấp) */
  public async createFolder(
    input: CreateFileFolderRequest,
    actor?: UserIdentity,
  ): Promise<FileFolderResponse> {
    let parentFolder: FileFolderEntity | null = null;
    if (input.parentId !== undefined && input.parentId !== null) {
      parentFolder = await this.foldersRepo.findById(input.parentId);
      if (!parentFolder) {
        throw new NotFoundAppException('files.error.parentFolderNotFound');
      }
      await this.assertCanAccessFolder(parentFolder, actor);
    }

    const trimmedName = input.name.trim();
    const slug = this.slugifyName(trimmedName);
    const parentId = parentFolder ? parentFolder.id : null;
    await this.assertUniqueFolderSlugInParent(parentId, slug);

    const orgId =
      input.organizationUnitId ??
      parentFolder?.organizationUnitId ??
      this.resolvePrimaryOrgId(actor);
    const code = await this.generateEntityCode('files.folder_code', orgId);

    const created = await this.foldersRepo.saveEntity({
      code,
      name: trimmedName,
      slug,
      parentId,
      folderPath: '/',
      organizationUnitId: orgId,
      createdByUserId: actor?.id ?? null,
      description: input.description ?? null,
    });

    const folderPath = parentFolder
      ? `${parentFolder.folderPath.replace(/\/$/, '')}/${created.id}/`
      : `/${created.id}/`;
    const updated = await this.foldersRepo.saveEntity({
      ...created,
      folderPath,
    });

    await this.recordAudit(actor, 'folder.create', 'file_folder', String(updated.id), null, {
      name: updated.name,
      parentId: updated.parentId ?? null,
      folderPath: updated.folderPath,
    });

    return this.mapper.toFolderResponse(updated);
  }

  /**
   * Đổi tên hoặc di chuyển thư mục (Mục 6.2):
   * - Kiểm tra quyền quản lý trên thư mục hiện tại và thư mục cha đích.
   * - Kiểm tra chống vòng lặp cây thư mục và chống trùng tên cùng cấp.
   * - Tự động cập nhật dây chuyền `folderPath` cho toàn bộ thư mục con cháu (descendants).
   */
  public async updateFolder(
    id: number,
    input: UpdateFileFolderRequest,
    actor?: UserIdentity,
  ): Promise<FileFolderResponse> {
    const folder = await this.foldersRepo.findById(id);
    if (!folder) {
      throw new NotFoundAppException('files.error.folderNotFound');
    }

    await this.assertCanAccessFolder(folder, actor);

    const oldFolderPath = folder.folderPath;
    let nextParentId = folder.parentId ?? null;
    let nextFolderPath = folder.folderPath;

    if (input.parentId !== undefined) {
      if (input.parentId === null) {
        nextParentId = null;
        nextFolderPath = `/${folder.id}/`;
      } else {
        if (input.parentId === folder.id) {
          throw new BadRequestAppException('files.error.folderCycleDetected');
        }
        const parent = await this.foldersRepo.findById(input.parentId);
        if (!parent) {
          throw new NotFoundAppException('files.error.parentFolderNotFound');
        }
        await this.assertCanAccessFolder(parent, actor);
        if (parent.folderPath.includes(`/${folder.id}/`)) {
          throw new BadRequestAppException('files.error.folderCycleDetected');
        }
        nextParentId = parent.id;
        nextFolderPath = `${parent.folderPath.replace(/\/$/, '')}/${folder.id}/`;
      }
    }

    const nextName = input.name !== undefined ? input.name.trim() : folder.name;
    const nextSlug = this.slugifyName(nextName);

    if (nextSlug !== folder.slug || nextParentId !== (folder.parentId ?? null)) {
      await this.assertUniqueFolderSlugInParent(nextParentId, nextSlug, folder.id);
    }

    const saved = await this.foldersRepo.saveEntity({
      ...folder,
      name: nextName,
      slug: nextSlug,
      parentId: nextParentId,
      folderPath: nextFolderPath,
      description:
        input.description !== undefined ? input.description : (folder.description ?? null),
    });

    // Cập nhật dây chuyền `folderPath` cho toàn bộ thư mục con cháu khi di chuyển thư mục cha
    if (nextFolderPath !== oldFolderPath) {
      await this.cascadeUpdateDescendantFolderPaths(folder.id, oldFolderPath, nextFolderPath);
    }

    await this.recordAudit(
      actor,
      'folder.update',
      'file_folder',
      String(saved.id),
      {
        name: folder.name,
        parentId: folder.parentId ?? null,
        folderPath: oldFolderPath,
      },
      {
        name: saved.name,
        parentId: saved.parentId ?? null,
        folderPath: saved.folderPath,
      },
    );

    return this.mapper.toFolderResponse(saved);
  }

  /** Xóa thư mục khi thư mục trống (chặn xóa nếu còn thư mục con hoặc còn file) */
  public async deleteFolder(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ deleted: true; id: number }> {
    const folder = await this.foldersRepo.findById(id);
    if (!folder) {
      throw new NotFoundAppException('files.error.folderNotFound');
    }

    await this.assertCanAccessFolder(folder, actor);

    const [childFolders, filesCount] = await Promise.all([
      this.foldersRepo.countChildFolders(id),
      this.filesRepo.countFilesInFolder(id),
    ]);

    if (childFolders > 0 || filesCount > 0) {
      throw new ConflictAppException('files.error.folderNotEmpty');
    }

    await this.foldersRepo.softDeleteById(id);
    await this.recordAudit(
      actor,
      'folder.delete',
      'file_folder',
      String(id),
      { name: folder.name },
      null,
    );

    return { deleted: true, id };
  }

  // ─── 2. Tải file lên hệ thống (Một hoặc nhiều file) ────────────────────────

  /**
   * Tải một file lên hệ thống (Mục 6.1, 6.2 & 6.3):
   * - Kiểm tra định dạng (extension, MIME, Magic Bytes) và giới hạn dung lượng theo Loại file & Module.
   * - Quét mã độc, hỗ trợ đưa vào khu vực chờ (`PENDING_SCAN = 5`) hoặc cách ly (`QUARANTINED = 6`).
   * - Tính checksum SHA-256 và xử lý file trùng lặp theo chính sách (`ALLOW` | `REJECT` | `REUSE`).
   * - Tự động Resize, tối ưu dung lượng ảnh và tạo ảnh thu nhỏ (`thumbnail`) hiển thị nhanh.
   */
  public async uploadSingle(
    input: UploadSingleFileRequest,
    actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    const orgId = input.organizationUnitId ?? this.resolvePrimaryOrgId(actor);

    let folder: FileFolderEntity | null = null;
    if (input.folderId !== undefined && input.folderId !== null) {
      folder = await this.foldersRepo.findById(input.folderId);
      if (!folder) {
        throw new NotFoundAppException('files.error.folderNotFound');
      }
      await this.assertCanAccessFolder(folder, actor);
    }

    const validated = this.validationService.validateUploadInput(input, orgId);
    await this.assertStorageQuotaWithinLimit(validated.sizeBytes, orgId, actor?.id ?? null);
    const checksumSha256 = this.computeSha256Hex(validated.buffer);

    // Kiểm tra trùng lặp theo mã băm SHA-256 (Mục 6.3.4)
    const duplicateMatches =
      typeof this.filesRepo.findByChecksumSha256 === 'function'
        ? await this.filesRepo.findByChecksumSha256(checksumSha256, orgId)
        : (await this.filesRepo.findAllForStats()).filter(
            (f) => f.checksumSha256 === checksumSha256 && f.status === FILE_STATUS.ACTIVE,
          );
    const existingDuplicate = duplicateMatches[0] ?? null;
    const duplicatePolicy = input.rejectDuplicate
      ? 'REJECT'
      : input.reuseDuplicate
        ? 'REUSE'
        : this.validationService.getDuplicatePolicy(orgId);

    if (existingDuplicate) {
      if (duplicatePolicy === 'REJECT') {
        throw new ConflictAppException('files.error.duplicateFileDetected', [], {
          duplicateFileId: existingDuplicate.id,
        });
      }
      if (duplicatePolicy === 'REUSE') {
        return this.getById(existingDuplicate.id, actor);
      }
    }

    const storageKey = this.buildImmutableStorageKey(validated.extension);
    await this.storage.upload(storageKey, validated.buffer, validated.mimeType);

    let thumbnailStorageKey: string | null = null;
    if (validated.thumbnail) {
      thumbnailStorageKey = this.buildThumbnailStorageKey(validated.thumbnail.extension);
      await this.storage.upload(
        thumbnailStorageKey,
        validated.thumbnail.buffer,
        validated.thumbnail.mimeType,
      );
    }

    // Xác định trạng thái vòng đời ban đầu (ACTIVE, PENDING_SCAN hoặc QUARANTINED — Mục 6.3.3)
    const shouldStage =
      Boolean(input.stageForScan) || this.validationService.shouldStageBeforePublish(orgId);
    const initialStatus = !validated.malwareScan.clean
      ? FILE_STATUS.QUARANTINED
      : shouldStage
        ? FILE_STATUS.PENDING_SCAN
        : FILE_STATUS.ACTIVE;

    const scanStatus = !validated.malwareScan.clean
      ? 'INFECTED'
      : initialStatus === FILE_STATUS.PENDING_SCAN
        ? 'PENDING'
        : 'CLEAN';

    const enrichedMeta: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      ...(input.moduleName ? { moduleName: input.moduleName.trim().toLowerCase() } : {}),
      scanStatus,
      scannedAt: validated.malwareScan.scannedAt,
      ...(validated.malwareScan.threatName ? { threatName: validated.malwareScan.threatName } : {}),
      ...(existingDuplicate ? { duplicateOfFileId: existingDuplicate.id } : {}),
      ...(validated.imageDimensions ? { imageDimensions: validated.imageDimensions } : {}),
      ...(validated.optimizedSavedBytes > 0
        ? {
            originalSizeBytes: validated.originalSizeBytes,
            optimizedSavedBytes: validated.optimizedSavedBytes,
          }
        : {}),
      ...(thumbnailStorageKey
        ? {
            thumbnailStorageKey,
            thumbnailMimeType: validated.thumbnail?.mimeType ?? 'image/png',
            thumbnailWidth: validated.thumbnail?.width ?? null,
            thumbnailHeight: validated.thumbnail?.height ?? null,
          }
        : {}),
    };

    const code = await this.generateEntityCode('files.file_code', orgId);
    const defaultVisibility = this.validationService.getDefaultVisibility(orgId);
    const saved = await this.filesRepo.saveEntity({
      code,
      folderId: folder ? folder.id : null,
      displayName: validated.displayName,
      originalName: validated.originalName,
      storageDriver: this.storage.driver.name,
      storageKey,
      mimeType: validated.mimeType,
      extension: validated.extension,
      category: validated.category,
      sizeBytes: validated.sizeBytes,
      checksumSha256,
      visibility: input.visibility ?? defaultVisibility,
      status: initialStatus,
      uploadedByUserId: actor?.id ?? null,
      organizationUnitId: orgId,
      usageCount: 0,
      trashedAt: null,
      trashedByUserId: null,
      purgeAfterAt: null,
      metadataJson: Object.keys(enrichedMeta).length > 0 ? JSON.stringify(enrichedMeta) : null,
    });

    await this.recordAudit(actor, 'file.upload', 'file', String(saved.id), null, {
      code: saved.code,
      displayName: saved.displayName,
      originalName: saved.originalName,
      mimeType: saved.mimeType,
      sizeBytes: Number(saved.sizeBytes),
      storageKey: saved.storageKey,
      status: saved.status,
      scanStatus,
    });

    const HEAVY_MEDIA_QUEUE_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5MB
    if (
      this.messagePublisher &&
      (saved.status === FILE_STATUS.PENDING_SCAN ||
        Number(saved.sizeBytes) >= HEAVY_MEDIA_QUEUE_THRESHOLD_BYTES)
    ) {
      await this.messagePublisher
        .publish(
          'files.media_process',
          {
            operation: 'media_process' as const,
            fileId: saved.id,
            storageKey: saved.storageKey,
            mimeType: saved.mimeType,
            extension: saved.extension,
            totalItems: 1,
          },
          QUEUES.SYSTEM_HEAVY,
          {
            priority: JOB_PRIORITIES.LOW,
            index: {
              operation: 'media_process',
              fileId: saved.id,
              extension: saved.extension,
            },
          },
        )
        .catch(() => null);
    }

    const uploaderMap = await this.loadUploaderSummaries(
      saved.uploadedByUserId ? [saved.uploadedByUserId] : [],
    );

    return this.toFileRecordResponse(saved, {
      folderName: folder?.name ?? null,
      uploadedByUser: saved.uploadedByUserId
        ? (uploaderMap.get(saved.uploadedByUserId) ?? null)
        : null,
      usages: [],
      permissions: [],
      canDownload: saved.status === FILE_STATUS.ACTIVE,
    });
  }

  /** Tải nhiều file lên hệ thống cùng lúc */
  public async uploadBatch(
    input: UploadBatchFilesRequest,
    actor?: UserIdentity,
  ): Promise<{ items: FileRecordResponse[]; count: number }> {
    if (!input.files || input.files.length === 0) {
      throw new BadRequestAppException('files.error.batchEmpty');
    }

    const orgId = input.organizationUnitId ?? this.resolvePrimaryOrgId(actor);
    const maxBatchFiles = this.validationService.getMaxBatchFiles(orgId);
    if (input.files.length > maxBatchFiles) {
      throw new BadRequestAppException('files.error.batchTooLarge', [], {
        maxFiles: maxBatchFiles,
      });
    }

    const items: FileRecordResponse[] = [];
    for (const fileItem of input.files) {
      const mergedItem: UploadSingleFileRequest = {
        ...fileItem,
        folderId: fileItem.folderId !== undefined ? fileItem.folderId : input.folderId,
        visibility: fileItem.visibility !== undefined ? fileItem.visibility : input.visibility,
        organizationUnitId:
          fileItem.organizationUnitId !== undefined
            ? fileItem.organizationUnitId
            : input.organizationUnitId,
        moduleName: fileItem.moduleName !== undefined ? fileItem.moduleName : input.moduleName,
        stageForScan:
          fileItem.stageForScan !== undefined ? fileItem.stageForScan : input.stageForScan,
        quarantineOnThreat:
          fileItem.quarantineOnThreat !== undefined
            ? fileItem.quarantineOnThreat
            : input.quarantineOnThreat,
        rejectDuplicate:
          fileItem.rejectDuplicate !== undefined ? fileItem.rejectDuplicate : input.rejectDuplicate,
        reuseDuplicate:
          fileItem.reuseDuplicate !== undefined ? fileItem.reuseDuplicate : input.reuseDuplicate,
        optimizeImage:
          fileItem.optimizeImage !== undefined ? fileItem.optimizeImage : input.optimizeImage,
        generateThumbnail:
          fileItem.generateThumbnail !== undefined
            ? fileItem.generateThumbnail
            : input.generateThumbnail,
      };
      const uploaded = await this.uploadSingle(mergedItem, actor);
      items.push(uploaded);
    }

    return { items, count: items.length };
  }

  // ─── 2B. Tải file dung lượng lớn theo mảnh (Chunked Upload 2GB+) ──────────

  /**
   * Khởi tạo phiên tải lên theo mảnh (Chunked Upload Init):
   * Kiểm tra trước định dạng, hạn mức dung lượng và Quota lưu trữ trước khi nhận dữ liệu.
   */
  public async initChunkedUpload(
    input: InitChunkedUploadRequest,
    actor?: UserIdentity,
  ): Promise<ChunkedUploadInitResponse> {
    await this.chunkSessionManager.cleanupExpired(this.storage);
    const orgId = input.organizationUnitId ?? this.resolvePrimaryOrgId(actor);

    let folder: FileFolderEntity | null = null;
    if (input.folderId !== undefined && input.folderId !== null) {
      folder = await this.foldersRepo.findById(input.folderId);
      if (!folder) {
        throw new NotFoundAppException('files.error.folderNotFound');
      }
      await this.assertCanAccessFolder(folder, actor);
    }

    const validated = this.validationService.validateChunkedInitInput(input, orgId);
    await this.assertStorageQuotaWithinLimit(validated.sizeBytes, orgId, actor?.id ?? null);

    const session = this.chunkSessionManager.createSession({
      storagePrefix: this.validationService.getStorageKeyPrefix(),
      input,
      originalName: validated.originalName,
      displayName: validated.displayName,
      extension: validated.extension,
      mimeType: validated.mimeType,
      category: validated.category,
      folderId: folder ? folder.id : null,
      folderName: folder ? folder.name : null,
      organizationUnitId: orgId,
      actorUserId: actor?.id ?? null,
    });

    return {
      uploadId: session.uploadId,
      chunkSizeBytes: session.chunkSizeBytes,
      totalChunks: session.totalChunks,
      expiresAt: new Date(session.expiresAtMs).toISOString(),
    };
  }

  /**
   * Ghi nối tiếp một mảnh dữ liệu (chunk) vào tệp tạm trên đĩa và cập nhật mã băm SHA-256 streaming.
   * Ở mảnh đầu tiên (`chunkIndex === 0`), kiểm tra ngay Magic Bytes và quét mã độc.
   */
  public async uploadChunkPart(
    uploadId: string,
    input: UploadChunkPartRequest,
    actor?: UserIdentity,
  ): Promise<ChunkedUploadPartResponse> {
    const session = this.chunkSessionManager.getActiveSession(uploadId, actor?.id ?? null);
    const chunkBuffer = this.chunkSessionManager.decodeChunkPayload(input, session.originalName);

    if (input.chunkIndex === 0) {
      try {
        session.malwareScan = this.validationService.validateFirstChunkBuffer(
          chunkBuffer,
          session.extension,
          {
            organizationUnitId: session.organizationUnitId,
            quarantineOnThreat: session.quarantineOnThreat,
            stageForScan: session.stageForScan,
          },
        );
        session.imageDimensions = this.validationService.extractImageDimensions(
          chunkBuffer,
          session.extension,
        );
      } catch (err) {
        await this.chunkSessionManager.abortSession(uploadId, this.storage);
        throw err;
      }
    }

    const receivedBytes = await this.chunkSessionManager.appendChunkToStorage(
      session,
      input.chunkIndex,
      chunkBuffer,
      this.storage,
    );
    const progressPercent = Math.min(
      100,
      Math.round((receivedBytes / Math.max(1, session.totalBytes)) * 100),
    );

    return {
      uploadId: session.uploadId,
      chunkIndex: input.chunkIndex,
      receivedBytes,
      totalBytes: session.totalBytes,
      progressPercent,
    };
  }

  /**
   * Hoàn tất phiên tải lên theo mảnh (Chunked Upload Complete):
   * Đối chiếu tổng số byte đã nhận, chốt mã băm SHA-256 toàn file, kiểm tra trùng lặp,
   * đổi tên nguyên tử tệp tạm sang `storageKey` chính thức và lưu bản ghi DB.
   */
  public async completeChunkedUpload(
    uploadId: string,
    input?: CompleteChunkedUploadRequest,
    actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    const session = this.chunkSessionManager.getActiveSession(uploadId, actor?.id ?? null);

    if (
      session.receivedBytes !== session.totalBytes ||
      session.expectedChunkIndex < session.totalChunks
    ) {
      await this.chunkSessionManager.abortSession(uploadId, this.storage);
      throw new BadRequestAppException('files.error.incompleteChunkedUpload', [], {
        expectedBytes: session.totalBytes,
        receivedBytes: session.receivedBytes,
      });
    }

    const checksumSha256 = session.sha256Hash.digest('hex');
    const orgId = session.organizationUnitId;

    const duplicateMatches =
      typeof this.filesRepo.findByChecksumSha256 === 'function'
        ? await this.filesRepo.findByChecksumSha256(checksumSha256, orgId)
        : (await this.filesRepo.findAllForStats()).filter(
            (f) => f.checksumSha256 === checksumSha256 && f.status === FILE_STATUS.ACTIVE,
          );
    const existingDuplicate = duplicateMatches[0] ?? null;
    const duplicatePolicy = session.rejectDuplicate
      ? 'REJECT'
      : session.reuseDuplicate
        ? 'REUSE'
        : this.validationService.getDuplicatePolicy(orgId);

    if (existingDuplicate) {
      if (duplicatePolicy === 'REJECT') {
        await this.chunkSessionManager.abortSession(uploadId, this.storage);
        throw new ConflictAppException('files.error.duplicateFileDetected', [], {
          duplicateFileId: existingDuplicate.id,
        });
      }
      if (duplicatePolicy === 'REUSE') {
        await this.chunkSessionManager.abortSession(uploadId, this.storage);
        return this.getById(existingDuplicate.id, actor);
      }
    }

    const storageKey = this.buildImmutableStorageKey(session.extension);
    await this.chunkSessionManager.finalizeToStorageKey(session, storageKey, this.storage);

    const shouldStage =
      Boolean(session.stageForScan) || this.validationService.shouldStageBeforePublish(orgId);
    const initialStatus = !session.malwareScan.clean
      ? FILE_STATUS.QUARANTINED
      : shouldStage
        ? FILE_STATUS.PENDING_SCAN
        : FILE_STATUS.ACTIVE;

    const scanStatus = !session.malwareScan.clean
      ? 'INFECTED'
      : initialStatus === FILE_STATUS.PENDING_SCAN
        ? 'PENDING'
        : 'CLEAN';

    const enrichedMeta: Record<string, unknown> = {
      ...(session.metadata ?? {}),
      ...(input?.metadata ?? {}),
      ...(session.moduleName ? { moduleName: session.moduleName.trim().toLowerCase() } : {}),
      chunkedUpload: true,
      totalChunks: session.totalChunks,
      scanStatus,
      scannedAt: session.malwareScan.scannedAt,
      ...(session.malwareScan.threatName ? { threatName: session.malwareScan.threatName } : {}),
      ...(existingDuplicate ? { duplicateOfFileId: existingDuplicate.id } : {}),
      ...(session.imageDimensions ? { imageDimensions: session.imageDimensions } : {}),
    };

    const code = await this.generateEntityCode('files.file_code', orgId);
    const defaultVisibility = this.validationService.getDefaultVisibility(orgId);
    const saved = await this.filesRepo.saveEntity({
      code,
      folderId: session.folderId,
      displayName: session.displayName,
      originalName: session.originalName,
      storageDriver: this.storage.driver.name,
      storageKey,
      mimeType: session.mimeType,
      extension: session.extension,
      category: session.category,
      sizeBytes: session.totalBytes,
      checksumSha256,
      visibility: session.visibility ?? defaultVisibility,
      status: initialStatus,
      uploadedByUserId: actor?.id ?? session.actorUserId ?? null,
      organizationUnitId: orgId,
      usageCount: 0,
      trashedAt: null,
      trashedByUserId: null,
      purgeAfterAt: null,
      metadataJson: Object.keys(enrichedMeta).length > 0 ? JSON.stringify(enrichedMeta) : null,
    });

    await this.recordAudit(actor, 'file.upload_chunked', 'file', String(saved.id), null, {
      code: saved.code,
      displayName: saved.displayName,
      originalName: saved.originalName,
      mimeType: saved.mimeType,
      sizeBytes: Number(saved.sizeBytes),
      storageKey: saved.storageKey,
      status: saved.status,
      scanStatus,
      totalChunks: session.totalChunks,
    });

    if (this.messagePublisher) {
      await this.messagePublisher
        .publish(
          'files.media_process',
          {
            operation: 'media_process' as const,
            fileId: saved.id,
            storageKey: saved.storageKey,
            mimeType: saved.mimeType,
            extension: saved.extension,
            totalItems: 1,
          },
          QUEUES.SYSTEM_HEAVY,
          {
            priority: JOB_PRIORITIES.LOW,
            index: {
              operation: 'media_process',
              fileId: saved.id,
              extension: saved.extension,
              chunkedUpload: 'true',
            },
          },
        )
        .catch(() => null);
    }

    const uploaderMap = await this.loadUploaderSummaries(
      saved.uploadedByUserId ? [saved.uploadedByUserId] : [],
    );

    return this.toFileRecordResponse(saved, {
      folderName: session.folderName,
      uploadedByUser: saved.uploadedByUserId
        ? (uploaderMap.get(saved.uploadedByUserId) ?? null)
        : null,
      usages: [],
      permissions: [],
      canDownload: saved.status === FILE_STATUS.ACTIVE,
    });
  }

  // ─── 3. Tìm kiếm, Lọc & Xem thông tin chi tiết file ────────────────────────

  /**
   * Đối soát sự tồn tại của file vật lý trên Storage.
   * Nếu bản ghi đang `ACTIVE` nhưng file vật lý đã bị xóa ngoài đĩa, tự động đánh dấu `MISSING (4)` vào DB.
   * Ngược lại nếu bản ghi đang `MISSING` nhưng file vật lý đã được khôi phục lại vào đĩa, tự động chuyển về `ACTIVE (1)`.
   */
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

  /** Tìm kiếm và lọc danh sách file theo tên, loại, người tải, thời gian và trạng thái */
  public async listPaginated(
    query: ListFilesQuery,
    actor?: UserIdentity,
  ): Promise<PaginatedResult<FileRecordResponse>> {
    const { page, limit, countMode } = resolvePagination(query, {
      settingPrefix: 'files.pagination',
      defaultLimit: 20,
      maxLimit: 100,
    });
    const scope = await this.resolveFileScopeConstraint(actor);

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

  /** Xem thông tin chi tiết của một file kèm người tải, liên kết sử dụng và phân quyền truy cập */
  public async getById(id: number, actor?: UserIdentity): Promise<FileRecordResponse> {
    const found = await this.filesRepo.findById(id);
    if (!found || found.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }

    await this.assertCanViewFile(found, actor);
    const entity = await this.reconcileStorageExistence(found);

    const [folder, uploaderMap, usages, permissions, canDownload] = await Promise.all([
      entity.folderId ? this.foldersRepo.findById(entity.folderId) : Promise.resolve(null),
      this.loadUploaderSummaries(entity.uploadedByUserId ? [entity.uploadedByUserId] : []),
      this.usagesRepo.findByFileId(entity.id),
      this.permissionsRepo ? this.permissionsRepo.findByFileId(entity.id) : Promise.resolve([]),
      this.canDownloadFile(entity, actor),
    ]);

    return this.toFileRecordResponse(entity, {
      folderName: folder?.name ?? null,
      uploadedByUser: entity.uploadedByUserId
        ? (uploaderMap.get(entity.uploadedByUserId) ?? null)
        : null,
      usages: usages.map((u) => this.mapper.toUsageResponse(u)),
      permissions: permissions.map((p) => this.mapper.toPermissionResponse(p)),
      canDownload,
    });
  }

  /** Thống kê tổng quan dung lượng, phân loại file và cấu hình hiện hành */
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

  // ─── 4. Tải file xuống, Stream Video, Thumbnail & Link tải tạm thời ─────────

  /** Chuẩn bị luồng tải file xuống (kiểm tra quyền tải file & chặn nếu đang chờ quét/cách ly) */
  public async prepareDownload(
    id: number,
    actor?: UserIdentity,
  ): Promise<{
    stream: ObjectStream;
    file: FileRecordResponse;
    downloadFileName: string;
  }> {
    const entity = await this.filesRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    if (entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.alreadyPurged');
    }
    if (entity.status === FILE_STATUS.TRASHED) {
      throw new BadRequestAppException('files.error.inTrashCannotDownload');
    }
    if (entity.status === FILE_STATUS.PENDING_SCAN) {
      throw new ForbiddenAppException('files.error.filePendingScan');
    }
    if (entity.status === FILE_STATUS.QUARANTINED) {
      throw new ForbiddenAppException('files.error.fileInQuarantine');
    }

    await this.assertCanDownloadFile(entity, actor);

    const exists = await this.storage.exists(entity.storageKey);
    if (!exists) {
      if (entity.status !== FILE_STATUS.MISSING) {
        await this.filesRepo.saveEntity({
          ...entity,
          status: FILE_STATUS.MISSING,
        });
      }
      throw new NotFoundAppException('files.error.storageObjectMissing');
    }

    const stream = await this.storage.driver.stream(entity.storageKey);
    const downloadFileName = this.buildSafeDownloadFileName(entity.displayName, entity.extension);

    await this.recordAudit(actor, 'file.download', 'file', String(entity.id), null, {
      displayName: entity.displayName,
      sizeBytes: Number(entity.sizeBytes),
    });

    return {
      stream,
      file: await this.toFileRecordResponse(entity),
      downloadFileName,
    };
  }

  /**
   * Chuẩn bị luồng phát trực tiếp (Inline / Video & Audio Byte-Range Streaming `206 Partial Content`).
   * Kiểm tra quyền tải/phát (`assertCanDownloadFile`) trước khi mở stream.
   */
  public async prepareStream(
    id: number,
    rangeHeader?: string,
    actor?: UserIdentity,
  ): Promise<{
    stream: ObjectStream;
    file: FileRecordResponse;
    byteRange: ResolvedByteRange | null;
  }> {
    const entity = await this.filesRepo.findById(id);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    if (entity.status === FILE_STATUS.TRASHED) {
      throw new BadRequestAppException('files.error.inTrashCannotDownload');
    }
    if (entity.status === FILE_STATUS.PENDING_SCAN) {
      throw new ForbiddenAppException('files.error.filePendingScan');
    }
    if (entity.status === FILE_STATUS.QUARANTINED) {
      throw new ForbiddenAppException('files.error.fileInQuarantine');
    }

    await this.assertCanDownloadFile(entity, actor);

    const exists = await this.storage.exists(entity.storageKey);
    if (!exists) {
      if (entity.status !== FILE_STATUS.MISSING) {
        await this.filesRepo.saveEntity({
          ...entity,
          status: FILE_STATUS.MISSING,
        });
      }
      throw new NotFoundAppException('files.error.storageObjectMissing');
    }

    const totalSize = Number(entity.sizeBytes) || 0;
    let byteRange: ResolvedByteRange | null = null;

    if (rangeHeader && totalSize > 0 && rangeHeader.startsWith('bytes=')) {
      byteRange = this.parseByteRangeHeader(rangeHeader, totalSize);
    }

    const stream = byteRange
      ? await this.storage.driver.stream(entity.storageKey, {
          start: byteRange.start,
          end: byteRange.end,
        })
      : await this.storage.driver.stream(entity.storageKey);

    return {
      stream,
      file: await this.toFileRecordResponse(entity),
      byteRange,
    };
  }

  /**
   * Chuẩn bị luồng truy cập công khai hoặc điều hướng CDN (Mục 6.4.7).
   * CHỈ cho phép các file có `visibility = PUBLIC (3)` và `status = ACTIVE (1)`.
   * Nếu file là `PRIVATE` hoặc `INTERNAL`, từ chối ngay với `ForbiddenAppException`.
   */
  public async preparePublicAccess(id: number): Promise<{
    redirectUrl: string | null;
    stream: ObjectStream | null;
    file: FileRecordResponse;
    downloadFileName: string;
  }> {
    const entity = await this.filesRepo.findById(id);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    if (entity.visibility !== FILE_VISIBILITY.PUBLIC) {
      throw new ForbiddenAppException('files.error.publicAccessDenied');
    }
    if (entity.status === FILE_STATUS.TRASHED) {
      throw new BadRequestAppException('files.error.inTrashCannotDownload');
    }
    if (entity.status === FILE_STATUS.PENDING_SCAN) {
      throw new ForbiddenAppException('files.error.filePendingScan');
    }
    if (entity.status === FILE_STATUS.QUARANTINED) {
      throw new ForbiddenAppException('files.error.fileInQuarantine');
    }

    const exists = await this.storage.exists(entity.storageKey);
    if (!exists) {
      if (entity.status !== FILE_STATUS.MISSING) {
        await this.filesRepo.saveEntity({
          ...entity,
          status: FILE_STATUS.MISSING,
        });
      }
      throw new NotFoundAppException('files.error.storageObjectMissing');
    }

    const fileResponse = await this.toFileRecordResponse(entity);
    const downloadFileName = this.buildSafeDownloadFileName(entity.displayName, entity.extension);

    if (fileResponse.publicUrl && /^https?:\/\//i.test(fileResponse.publicUrl)) {
      return {
        redirectUrl: fileResponse.publicUrl,
        stream: null,
        file: fileResponse,
        downloadFileName,
      };
    }

    const stream = await this.storage.driver.stream(entity.storageKey);
    return {
      redirectUrl: null,
      stream,
      file: fileResponse,
      downloadFileName,
    };
  }

  /**
   * Chuẩn bị luồng ảnh thu nhỏ (Thumbnail — Mục 6.3.5) để hiển thị nhanh trên giao diện.
   * Nếu tệp có `thumbnailStorageKey` trên Storage thì trả về stream của ảnh thumbnail,
   * nếu không có thì fallback trả về stream của ảnh gốc.
   */
  public async prepareThumbnail(
    id: number,
    actor?: UserIdentity,
  ): Promise<{
    stream: ObjectStream;
    mimeType: string;
    file: FileRecordResponse;
  }> {
    const entity = await this.filesRepo.findById(id);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    if (entity.status === FILE_STATUS.QUARANTINED) {
      throw new ForbiddenAppException('files.error.fileInQuarantine');
    }

    await this.assertCanViewFile(entity, actor);

    const meta = entity.metadataJson
      ? safeJsonParseObject<Record<string, unknown>>(entity.metadataJson)
      : null;
    const thumbKey =
      typeof meta?.thumbnailStorageKey === 'string' && meta.thumbnailStorageKey.length > 0
        ? meta.thumbnailStorageKey
        : null;
    const thumbMime =
      typeof meta?.thumbnailMimeType === 'string' && meta.thumbnailMimeType.length > 0
        ? meta.thumbnailMimeType
        : entity.mimeType;

    if (thumbKey && (await this.storage.exists(thumbKey))) {
      const stream = await this.storage.driver.stream(thumbKey);
      return {
        stream,
        mimeType: thumbMime,
        file: this.mapper.toFileResponse(entity),
      };
    }

    const exists = await this.storage.exists(entity.storageKey);
    if (!exists) {
      throw new NotFoundAppException('files.error.storageObjectMissing');
    }
    const stream = await this.storage.driver.stream(entity.storageKey);
    return {
      stream,
      mimeType: entity.mimeType,
      file: this.mapper.toFileResponse(entity),
    };
  }

  /**
   * Tạo đường dẫn tải file tạm thời tự hết hạn (Signed Temporary Download Link — Mục 6.2).
   * Kiểm tra người tạo phải có quyền tải file (`assertCanDownloadFile`), sau đó ký HMAC-SHA256.
   */
  public async createTemporaryDownloadLink(
    fileId: number,
    input?: CreateTemporaryDownloadLinkRequest,
    actor?: UserIdentity,
  ): Promise<TemporaryDownloadLinkResponse> {
    const entity = await this.filesRepo.findById(fileId);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    if (entity.status === FILE_STATUS.TRASHED) {
      throw new BadRequestAppException('files.error.inTrashCannotDownload');
    }
    if (entity.status === FILE_STATUS.PENDING_SCAN) {
      throw new ForbiddenAppException('files.error.filePendingScan');
    }
    if (entity.status === FILE_STATUS.QUARANTINED) {
      throw new ForbiddenAppException('files.error.fileInQuarantine');
    }

    await this.assertCanDownloadFile(entity, actor);

    const orgId = entity.organizationUnitId ?? this.resolvePrimaryOrgId(actor);
    const defaultTtlSec = this.validationService.getTempLinkDefaultTtlSec(orgId);
    const maxTtlSec = this.validationService.getTempLinkMaxTtlSec(orgId);

    const requestedTtl = input?.expiresInSeconds ?? defaultTtlSec;
    if (requestedTtl > maxTtlSec) {
      throw new BadRequestAppException('files.error.temporaryLinkTtlExceeded', [], {
        maxSeconds: maxTtlSec,
      });
    }

    const expiresInSeconds = Math.max(1, Math.trunc(requestedTtl));
    const disposition = input?.disposition === 'inline' ? 'inline' : 'attachment';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expSeconds = nowSeconds + expiresInSeconds;

    const payload: TemporaryDownloadTokenPayload = {
      typ: 'file_temp_dl',
      fid: entity.id,
      exp: expSeconds,
      disp: disposition,
      uid: actor?.id ?? null,
    };

    const secret = await this.resolveSigningSecret();
    const token = this.signTemporaryDownloadToken(payload, secret);
    const expiresAt = new Date(expSeconds * 1000).toISOString();
    const downloadUrl = `/api/v1/files/temporary-download/${token}`;

    await this.recordAudit(actor, 'file.temporary_link_create', 'file', String(entity.id), null, {
      expiresInSeconds,
      expiresAt,
      disposition,
    });

    return {
      fileId: entity.id,
      token,
      expiresInSeconds,
      expiresAt,
      disposition,
      downloadUrl,
    };
  }

  /**
   * Giải mã và xác thực đường dẫn tải tạm thời (`GET /api/v1/files/temporary-download/:token`).
   * Tự động từ chối nếu chữ ký không khớp hoặc đã quá thời hạn `exp`.
   */
  public async prepareTemporaryDownload(token: string): Promise<{
    stream: ObjectStream;
    file: FileRecordResponse;
    downloadFileName: string;
    disposition: 'attachment' | 'inline';
  }> {
    const secret = await this.resolveSigningSecret();
    const payload = this.verifyTemporaryDownloadToken(token, secret);
    if (!payload) {
      throw new ForbiddenAppException('files.error.temporaryLinkExpiredOrInvalid');
    }

    const entity = await this.filesRepo.findById(payload.fid);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    if (entity.status === FILE_STATUS.TRASHED) {
      throw new BadRequestAppException('files.error.inTrashCannotDownload');
    }

    const exists = await this.storage.exists(entity.storageKey);
    if (!exists) {
      if (entity.status !== FILE_STATUS.MISSING) {
        await this.filesRepo.saveEntity({
          ...entity,
          status: FILE_STATUS.MISSING,
        });
      }
      throw new NotFoundAppException('files.error.storageObjectMissing');
    }

    const stream = await this.storage.driver.stream(entity.storageKey);
    const downloadFileName = this.buildSafeDownloadFileName(entity.displayName, entity.extension);

    await this.recordAudit(
      undefined,
      'file.temporary_link_download',
      'file',
      String(entity.id),
      null,
      {
        displayName: entity.displayName,
        issuedByUserId: payload.uid,
      },
    );

    return {
      stream,
      file: await this.toFileRecordResponse(entity),
      downloadFileName,
      disposition: payload.disp,
    };
  }

  // ─── 5. Đổi tên file & Di chuyển thư mục (Không đổi file gốc trong Storage) ─

  /** Đổi tên hiển thị, di chuyển thư mục (kiểm tra quyền thư mục đích, giữ nguyên liên kết sử dụng & storage_key) */
  public async updateMetadata(
    id: number,
    input: UpdateFileMetadataRequest,
    actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    const entity = await this.filesRepo.findById(id);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }

    await this.assertCanManageFile(entity, actor);

    let folder: FileFolderEntity | null = null;
    let nextFolderId = entity.folderId ?? null;
    if (input.folderId !== undefined) {
      if (input.folderId === null) {
        nextFolderId = null;
      } else {
        folder = await this.foldersRepo.findById(input.folderId);
        if (!folder) {
          throw new NotFoundAppException('files.error.folderNotFound');
        }
        await this.assertCanAccessFolder(folder, actor);
        nextFolderId = folder.id;
      }
    } else if (entity.folderId) {
      folder = await this.foldersRepo.findById(entity.folderId);
    }

    const previousDisplayName = entity.displayName;
    const nextDisplayName =
      input.displayName !== undefined ? input.displayName.trim() : entity.displayName;
    const nextVisibility = input.visibility !== undefined ? input.visibility : entity.visibility;
    const nextMetadataJson =
      input.metadata !== undefined
        ? input.metadata
          ? JSON.stringify(input.metadata)
          : null
        : (entity.metadataJson ?? null);

    // Chú ý: `storageKey` và `file_usages` được giữ nguyên 100% không bao giờ thay đổi
    const saved = await this.filesRepo.saveEntity({
      ...entity,
      displayName: nextDisplayName,
      folderId: nextFolderId,
      visibility: nextVisibility,
      metadataJson: nextMetadataJson,
    });

    await this.recordAudit(
      actor,
      'file.rename_or_update',
      'file',
      String(saved.id),
      {
        displayName: previousDisplayName,
        folderId: entity.folderId ?? null,
        visibility: entity.visibility,
        storageKey: entity.storageKey,
      },
      {
        displayName: saved.displayName,
        folderId: saved.folderId ?? null,
        visibility: saved.visibility,
        storageKey: saved.storageKey,
      },
    );

    const [uploaderMap, usages, permissions, canDownload] = await Promise.all([
      this.loadUploaderSummaries(saved.uploadedByUserId ? [saved.uploadedByUserId] : []),
      this.usagesRepo.findByFileId(saved.id),
      this.permissionsRepo ? this.permissionsRepo.findByFileId(saved.id) : Promise.resolve([]),
      this.canDownloadFile(saved, actor),
    ]);

    return this.toFileRecordResponse(saved, {
      folderName: folder?.name ?? null,
      uploadedByUser: saved.uploadedByUserId
        ? (uploaderMap.get(saved.uploadedByUserId) ?? null)
        : null,
      usages: usages.map((u) => this.mapper.toUsageResponse(u)),
      permissions: permissions.map((p) => this.mapper.toPermissionResponse(p)),
      canDownload,
    });
  }

  // ─── 6. Phân quyền Xem & Tải file chi tiết (`file_permissions` — Mục 6.2) ──

  /** Xem danh sách phân quyền chi tiết (User / Role / Đơn vị) của một file */
  public async listPermissions(
    fileId: number,
    actor?: UserIdentity,
  ): Promise<FilePermissionItemResponse[]> {
    const entity = await this.filesRepo.findById(fileId);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    await this.assertCanViewFile(entity, actor);

    if (!this.permissionsRepo) return [];
    const list = await this.permissionsRepo.findByFileId(fileId);
    return list.map((p) => this.mapper.toPermissionResponse(p));
  }

  /**
   * Cấp hoặc cập nhật quyền Xem (`canView`) / Tải (`canDownload`) cho Người dùng, Vai trò hoặc Đơn vị.
   * Quyền tải file có thể độc lập với quyền xem (ví dụ: cho phép xem thông tin nhưng không cho tải xuống).
   * Nếu `canDownload = true` thì tự động bật `canView = true`.
   */
  public async grantPermission(
    fileId: number,
    input: GrantFilePermissionRequest,
    actor?: UserIdentity,
  ): Promise<FilePermissionItemResponse> {
    const entity = await this.filesRepo.findById(fileId);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    await this.assertCanManageFile(entity, actor);

    if (!this.permissionsRepo) {
      throw new NotFoundAppException('files.error.permissionNotFound');
    }

    const subjectType: FilePermissionSubjectCode = parseFilePermissionSubjectType(
      input.subjectType,
    );
    const rawSubjectId = String(input.subjectId).trim();
    const subjectId =
      subjectType === FILE_PERMISSION_SUBJECT.ROLE ? rawSubjectId.toLowerCase() : rawSubjectId;

    const canDownload = Boolean(input.canDownload);
    const canView = canDownload ? true : (input.canView ?? true);
    let expiresAt: Date | null = null;
    if (input.expiresAt) {
      const parsedDate = new Date(input.expiresAt);
      if (!Number.isNaN(parsedDate.getTime())) {
        expiresAt = parsedDate;
      }
    }

    const existing = await this.permissionsRepo.findByTarget({
      fileId,
      subjectType,
      subjectId,
    });

    const saved = await this.permissionsRepo.saveEntity({
      ...(existing ?? {}),
      fileId,
      subjectType,
      subjectId,
      canView,
      canDownload,
      expiresAt,
      note: input.note !== undefined ? input.note : (existing?.note ?? null),
      grantedByUserId: actor?.id ?? existing?.grantedByUserId ?? null,
    });

    await this.recordAudit(
      actor,
      'file.permission_grant',
      'file',
      String(fileId),
      existing
        ? {
            subjectType: existing.subjectType,
            subjectId: existing.subjectId,
            canView: existing.canView,
            canDownload: existing.canDownload,
          }
        : null,
      {
        subjectType: saved.subjectType,
        subjectId: saved.subjectId,
        canView: saved.canView,
        canDownload: saved.canDownload,
        expiresAt: saved.expiresAt ? saved.expiresAt.toISOString() : null,
      },
    );

    return this.mapper.toPermissionResponse(saved);
  }

  /** Thu hồi một bản ghi phân quyền truy cập file */
  public async revokePermission(
    fileId: number,
    permissionId: number,
    actor?: UserIdentity,
  ): Promise<{ revoked: true; permissionId: number }> {
    const entity = await this.filesRepo.findById(fileId);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    await this.assertCanManageFile(entity, actor);

    if (!this.permissionsRepo) {
      throw new NotFoundAppException('files.error.permissionNotFound');
    }

    const found = await this.permissionsRepo.findById(permissionId);
    if (!found || found.fileId !== fileId) {
      throw new NotFoundAppException('files.error.permissionNotFound');
    }

    await this.permissionsRepo.softDeleteById(found.id);

    await this.recordAudit(
      actor,
      'file.permission_revoke',
      'file',
      String(fileId),
      {
        permissionId: found.id,
        subjectType: found.subjectType,
        subjectId: found.subjectId,
        canView: found.canView,
        canDownload: found.canDownload,
      },
      null,
    );

    return { revoked: true, permissionId };
  }

  // ─── 7. Đưa vào thùng rác, Khôi phục & Xóa vĩnh viễn ───────────────────────

  /**
   * Đưa file vào thùng rác (Soft Trash có thời gian chờ trước khi xóa vĩnh viễn).
   * Chặn ngay nếu file vẫn đang được sử dụng bởi bất kỳ chức năng nào (`usageCount > 0`).
   */
  public async moveToTrash(id: number, actor?: UserIdentity): Promise<FileRecordResponse> {
    const entity = await this.filesRepo.findById(id);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    if (entity.status === FILE_STATUS.TRASHED) {
      throw new ConflictAppException('files.error.alreadyInTrash');
    }

    await this.assertCanManageFile(entity, actor);
    await this.assertNoActiveUsages(entity.id);

    const retentionDays = this.validationService.getTrashRetentionDays(
      entity.organizationUnitId ?? this.resolvePrimaryOrgId(actor),
    );
    const now = new Date();
    const purgeAfterAt = new Date(now.getTime() + retentionDays * DAY_MS);

    const saved = await this.filesRepo.saveEntity({
      ...entity,
      status: FILE_STATUS.TRASHED,
      trashedAt: now,
      trashedByUserId: actor?.id ?? null,
      purgeAfterAt,
    });

    await this.recordAudit(
      actor,
      'file.trash',
      'file',
      String(saved.id),
      { status: FILE_STATUS.ACTIVE },
      {
        status: FILE_STATUS.TRASHED,
        trashedAt: now.toISOString(),
        purgeAfterAt: purgeAfterAt.toISOString(),
      },
    );

    return this.toFileRecordResponse(saved);
  }

  /** Khôi phục file từ thùng rác (Chỉ khi file chưa bị xóa vĩnh viễn khỏi Storage) */
  public async restoreFromTrash(id: number, actor?: UserIdentity): Promise<FileRecordResponse> {
    const entity = await this.filesRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    if (entity.status === FILE_STATUS.PURGED) {
      throw new ConflictAppException('files.error.alreadyPurged');
    }
    if (entity.status !== FILE_STATUS.TRASHED) {
      throw new BadRequestAppException('files.error.notInTrash');
    }

    await this.assertCanManageFile(entity, actor);

    const existsInStorage = await this.storage.exists(entity.storageKey);
    if (!existsInStorage) {
      await this.filesRepo.saveEntity({
        ...entity,
        status: FILE_STATUS.MISSING,
      });
      throw new NotFoundAppException('files.error.storageObjectMissing');
    }

    const saved = await this.filesRepo.saveEntity({
      ...entity,
      status: FILE_STATUS.ACTIVE,
      trashedAt: null,
      trashedByUserId: null,
      purgeAfterAt: null,
    });

    await this.recordAudit(
      actor,
      'file.restore',
      'file',
      String(saved.id),
      { status: FILE_STATUS.TRASHED },
      { status: FILE_STATUS.ACTIVE },
    );

    return this.toFileRecordResponse(saved);
  }

  /** Xóa vĩnh viễn một file khỏi Storage và đánh dấu PURGED (Chặn nếu còn liên kết dữ liệu) */
  public async purgeFile(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ purged: true; id: number; storageKey: string }> {
    const entity = await this.filesRepo.findById(id);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }

    await this.assertCanManageFile(entity, actor);
    await this.assertNoActiveUsages(entity.id);

    const existsInStorage = await this.storage.exists(entity.storageKey);
    if (existsInStorage) {
      await this.storage.delete(entity.storageKey);
    }
    await this.deleteThumbnailIfPresent(entity);

    await this.filesRepo.saveEntity({
      ...entity,
      status: FILE_STATUS.PURGED,
    });
    await this.filesRepo.softDeleteById(entity.id);

    await this.recordAudit(
      actor,
      'file.purge',
      'file',
      String(entity.id),
      {
        displayName: entity.displayName,
        storageKey: entity.storageKey,
        status: entity.status,
      },
      { status: FILE_STATUS.PURGED },
    );

    return {
      purged: true,
      id: entity.id,
      storageKey: entity.storageKey,
    };
  }

  /** Tự động dọn dẹp các file trong thùng rác đã hết thời gian chờ (`purge_after_at <= now`) */
  public async purgeExpiredTrash(
    actor?: UserIdentity,
    options?: { readonly skipQueuePublish?: boolean },
  ): Promise<{ purgedCount: number; purgedIds: number[] }> {
    const expired = await this.filesRepo.findExpiredTrashedFiles(new Date());
    const purgedIds: number[] = [];

    for (const file of expired) {
      const usageCount = await this.usagesRepo.countByFileId(file.id);
      if (usageCount > 0) continue;

      const existsInStorage = await this.storage.exists(file.storageKey);
      if (existsInStorage) {
        await this.storage.delete(file.storageKey).catch(() => undefined);
      }
      await this.deleteThumbnailIfPresent(file);

      await this.filesRepo.saveEntity({
        ...file,
        status: FILE_STATUS.PURGED,
      });
      await this.filesRepo.softDeleteById(file.id);
      purgedIds.push(file.id);
    }

    if (purgedIds.length > 0) {
      await this.recordAudit(actor, 'file.purge_expired', 'file', 'batch', null, {
        purgedCount: purgedIds.length,
        purgedIds,
      });
      if (!options?.skipQueuePublish && this.messagePublisher) {
        await this.messagePublisher
          .publish(
            'files.trash_cleanup',
            {
              operation: 'trash_cleanup' as const,
              executeInWorker: false as const,
              totalItems: purgedIds.length,
              fileIds: purgedIds,
            },
            QUEUES.SYSTEM_HEAVY,
            {
              priority: JOB_PRIORITIES.LOW,
              index: {
                operation: 'trash_cleanup',
                purgedCount: purgedIds.length,
              },
            },
          )
          .catch(() => null);
      }
    }

    return {
      purgedCount: purgedIds.length,
      purgedIds,
    };
  }

  // ─── 7B. Khu vực chờ quét mã độc, Kiểm tra toàn vẹn Checksum & Dọn file không dùng (Mục 6.3) ───

  /**
   * Duyệt và công bố file từ khu vực chờ (`PENDING_SCAN = 5` hoặc `QUARANTINED = 6`) sang hoạt động (`ACTIVE = 1` — Mục 6.3.3).
   * Thực hiện quét lại mã độc trên nội dung vật lý trước khi cho phép công bố.
   */
  public async publishStagedFile(id: number, actor?: UserIdentity): Promise<FileRecordResponse> {
    const entity = await this.filesRepo.findById(id);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    await this.assertCanManageFile(entity, actor);

    const exists = await this.storage.exists(entity.storageKey);
    if (!exists) {
      await this.filesRepo.saveEntity({ ...entity, status: FILE_STATUS.MISSING });
      throw new NotFoundAppException('files.error.storageObjectMissing');
    }

    if (typeof this.storage.download === 'function') {
      const physicalBuf = await this.storage.download(entity.storageKey);
      const scanRes = this.validationService.scanForMalware(
        physicalBuf,
        entity.extension,
        entity.organizationUnitId ?? null,
      );
      if (!scanRes.clean) {
        const meta = entity.metadataJson
          ? (safeJsonParseObject<Record<string, unknown>>(entity.metadataJson) ?? {})
          : {};
        await this.filesRepo.saveEntity({
          ...entity,
          status: FILE_STATUS.QUARANTINED,
          metadataJson: JSON.stringify({
            ...meta,
            scanStatus: 'INFECTED',
            threatName: scanRes.threatName,
            scannedAt: scanRes.scannedAt,
          }),
        });
        throw new BadRequestAppException('files.error.malwareDetected', [], {
          threatName: scanRes.threatName ?? 'SUSPICIOUS_PAYLOAD',
        });
      }
    }

    const prevStatus = entity.status;
    const prevMeta = entity.metadataJson
      ? (safeJsonParseObject<Record<string, unknown>>(entity.metadataJson) ?? {})
      : {};
    const nextMeta: Record<string, unknown> = {
      ...prevMeta,
      scanStatus: 'CLEAN',
      threatName: null,
      publishedAt: new Date().toISOString(),
      publishedByUserId: actor?.id ?? null,
    };

    const saved = await this.filesRepo.saveEntity({
      ...entity,
      status: FILE_STATUS.ACTIVE,
      metadataJson: JSON.stringify(nextMeta),
    });

    await this.recordAudit(
      actor,
      'file.publish',
      'file',
      String(saved.id),
      { status: prevStatus },
      { status: FILE_STATUS.ACTIVE, scanStatus: 'CLEAN' },
    );

    return this.getById(saved.id, actor);
  }

  /**
   * Đưa file vào khu vực cách ly (`QUARANTINED = 6` — Mục 6.3.3) khi phát hiện nghi ngờ mã độc hoặc vi phạm.
   * File bị cách ly sẽ bị khóa tải xuống và phát trực tiếp.
   */
  public async quarantineFile(
    id: number,
    input?: QuarantineFileRequest | string,
    actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    const entity = await this.filesRepo.findById(id);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    await this.assertCanManageFile(entity, actor);

    const prevStatus = entity.status;
    const prevMeta = entity.metadataJson
      ? (safeJsonParseObject<Record<string, unknown>>(entity.metadataJson) ?? {})
      : {};
    const rawReason = typeof input === 'string' ? input : input?.reason;
    const reason = rawReason?.trim() || 'QUARANTINED_BY_ADMIN';
    const nextMeta: Record<string, unknown> = {
      ...prevMeta,
      scanStatus: 'INFECTED',
      threatName: reason,
      quarantinedAt: new Date().toISOString(),
      quarantinedByUserId: actor?.id ?? null,
    };

    const saved = await this.filesRepo.saveEntity({
      ...entity,
      status: FILE_STATUS.QUARANTINED,
      metadataJson: JSON.stringify(nextMeta),
    });

    await this.recordAudit(
      actor,
      'file.quarantine',
      'file',
      String(saved.id),
      { status: prevStatus },
      { status: FILE_STATUS.QUARANTINED, reason },
    );

    return this.getById(saved.id, actor);
  }

  /**
   * Kiểm tra tính toàn vẹn của file bằng mã băm SHA-256 và phát hiện file trùng lặp (Mục 6.3.4):
   * - Đọc lại nội dung vật lý từ Storage, tính lại SHA-256 và so khớp với `entity.checksumSha256`.
   * - Nếu nội dung vật lý đã bị thay đổi ngoài đĩa (`intact = false`), tự động gắn cờ cảnh báo.
   * - Trả về danh sách các file khác có cùng mã băm SHA-256 (`duplicateFileIds`).
   */
  public async verifyFileIntegrity(
    id: number,
    actor?: UserIdentity,
  ): Promise<FileIntegrityVerificationResponse> {
    const entity = await this.filesRepo.findById(id);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    await this.assertCanViewFile(entity, actor);

    const verifiedAt = new Date().toISOString();
    const exists = await this.storage.exists(entity.storageKey);
    if (!exists) {
      const updated = await this.filesRepo.saveEntity({
        ...entity,
        status: FILE_STATUS.MISSING,
      });
      return {
        fileId: updated.id,
        expectedChecksumSha256: updated.checksumSha256,
        actualChecksumSha256: null,
        intact: false,
        status: updated.status,
        statusName: getFileStatusName(updated.status),
        duplicateFileIds: [],
        verifiedAt,
      };
    }

    let actualChecksumSha256: string | null = null;
    if (typeof this.storage.download === 'function') {
      const buf = await this.storage.download(entity.storageKey);
      actualChecksumSha256 = this.computeSha256Hex(buf);
    } else {
      const objStream = await this.storage.driver.stream(entity.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of objStream.body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }
      actualChecksumSha256 = this.computeSha256Hex(Buffer.concat(chunks));
    }

    const intact = actualChecksumSha256 === entity.checksumSha256;
    const sameHashList =
      typeof this.filesRepo.findByChecksumSha256 === 'function'
        ? await this.filesRepo.findByChecksumSha256(
            entity.checksumSha256,
            entity.organizationUnitId ?? null,
          )
        : (await this.filesRepo.findAllForStats()).filter(
            (f) => f.checksumSha256 === entity.checksumSha256,
          );
    const duplicateFileIds = sameHashList.filter((f) => f.id !== entity.id).map((f) => f.id);

    const prevMeta = entity.metadataJson
      ? (safeJsonParseObject<Record<string, unknown>>(entity.metadataJson) ?? {})
      : {};
    const updatedEntity = await this.filesRepo.saveEntity({
      ...entity,
      status: intact ? entity.status : FILE_STATUS.QUARANTINED,
      metadataJson: JSON.stringify({
        ...prevMeta,
        integrityVerifiedAt: verifiedAt,
        integrityIntact: intact,
        ...(!intact ? { scanStatus: 'INFECTED', threatName: 'CHECKSUM_TAMPERED' } : {}),
      }),
    });

    await this.recordAudit(actor, 'file.verify_integrity', 'file', String(entity.id), null, {
      intact,
      expectedChecksumSha256: entity.checksumSha256,
      actualChecksumSha256,
      duplicateFileIds,
    });

    return {
      fileId: updatedEntity.id,
      expectedChecksumSha256: updatedEntity.checksumSha256,
      actualChecksumSha256,
      intact,
      status: updatedEntity.status,
      statusName: getFileStatusName(updatedEntity.status),
      duplicateFileIds,
      verifiedAt,
    };
  }

  /**
   * Dọn dẹp các file không còn được sử dụng (`usageCount = 0`) sau khi đã qua thời gian an toàn (Mục 6.3.7).
   * Chỉ tác động lên những file có `usageCount = 0` và `createdAt <= now - retentionDays`.
   * Hỗ trợ 2 chế độ: `'trash'` (đưa vào thùng rác chờ xóa) hoặc `'purge'` (xóa vĩnh viễn).
   */
  public async cleanupUnusedFiles(
    input?: CleanupUnusedFilesRequest,
    actor?: UserIdentity,
  ): Promise<CleanupUnusedFilesResponse> {
    const orgId = input?.organizationUnitId ?? this.resolvePrimaryOrgId(actor);
    const configuredDays = this.validationService.getUnusedRetentionDays(orgId);
    const retentionDays =
      input?.olderThanDays !== undefined && input.olderThanDays >= 0
        ? input.olderThanDays
        : configuredDays;
    const action = input?.action === 'purge' ? 'purge' : 'trash';

    const now = new Date();
    const cutoffDate = new Date(now.getTime() - retentionDays * DAY_MS);

    const candidates =
      typeof this.filesRepo.findUnusedFilesOlderThan === 'function'
        ? await this.filesRepo.findUnusedFilesOlderThan(cutoffDate, orgId)
        : (await this.filesRepo.findAllForStats()).filter(
            (f) =>
              f.status === FILE_STATUS.ACTIVE &&
              (Number(f.usageCount) || 0) === 0 &&
              f.createdAt.getTime() <= cutoffDate.getTime() &&
              (!orgId || f.organizationUnitId === orgId),
          );

    const cleanedIds: number[] = [];
    const trashRetentionDays = this.validationService.getTrashRetentionDays(orgId);
    const purgeAfterAt = new Date(now.getTime() + trashRetentionDays * DAY_MS);

    for (const file of candidates) {
      const liveUsageCount = await this.usagesRepo.countByFileId(file.id);
      if (liveUsageCount > 0) {
        await this.syncFileUsageCount(file.id);
        continue;
      }

      if (action === 'purge') {
        const existsInStorage = await this.storage.exists(file.storageKey);
        if (existsInStorage) {
          await this.storage.delete(file.storageKey).catch(() => undefined);
        }
        await this.deleteThumbnailIfPresent(file);
        await this.filesRepo.saveEntity({
          ...file,
          status: FILE_STATUS.PURGED,
        });
        await this.filesRepo.softDeleteById(file.id);
      } else {
        await this.filesRepo.saveEntity({
          ...file,
          status: FILE_STATUS.TRASHED,
          trashedAt: now,
          trashedByUserId: actor?.id ?? null,
          purgeAfterAt,
        });
      }
      cleanedIds.push(file.id);
    }

    if (cleanedIds.length > 0) {
      await this.recordAudit(actor, 'file.cleanup_unused', 'file', 'batch', null, {
        retentionDays,
        action,
        cleanedCount: cleanedIds.length,
        cleanedIds,
      });
    }

    return {
      retentionDays,
      action,
      cleanedCount: cleanedIds.length,
      cleanedIds,
    };
  }

  // ─── 8. Theo dõi liên kết sử dụng file (`file_usages` & Public Contract) ───

  /** Lấy danh sách các chức năng/bản ghi đang sử dụng một file */
  public async listUsages(fileId: number, actor?: UserIdentity): Promise<FileUsageItemResponse[]> {
    const entity = await this.filesRepo.findById(fileId);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    await this.assertCanViewFile(entity, actor);

    const usages = await this.usagesRepo.findByFileId(fileId);
    return usages.map((u) => this.mapper.toUsageResponse(u));
  }

  /** Gắn liên kết sử dụng file từ API Controller */
  public async attachUsageFromRequest(
    fileId: number,
    input: AttachFileUsageRequest,
    actor?: UserIdentity,
  ): Promise<FileUsageItemResponse> {
    await this.attachUsage({
      fileId,
      moduleName: input.moduleName,
      entityType: input.entityType,
      entityId: input.entityId,
      fieldName: input.fieldName ?? 'default',
      note: input.note ?? null,
      actorId: actor?.id ?? null,
    });
    const saved = await this.usagesRepo.findByTarget({
      fileId,
      moduleName: input.moduleName.trim(),
      entityType: input.entityType.trim(),
      entityId: String(input.entityId).trim(),
      fieldName: (input.fieldName ?? 'default').trim(),
    });
    if (!saved) {
      throw new NotFoundAppException('files.error.usageNotFound');
    }
    return this.mapper.toUsageResponse(saved);
  }

  /** Gỡ một liên kết sử dụng file theo ID bản ghi `file_usages` */
  public async removeUsageById(
    fileId: number,
    usageId: number,
    actor?: UserIdentity,
  ): Promise<{ removed: true; usageId: number; usageCount: number }> {
    const file = await this.filesRepo.findById(fileId);
    if (!file) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }

    const usage = await this.usagesRepo.findById(usageId);
    if (!usage || usage.fileId !== fileId) {
      throw new NotFoundAppException('files.error.usageNotFound');
    }

    await this.usagesRepo.softDeleteById(usage.id);
    const nextCount = await this.syncFileUsageCount(fileId);

    await this.recordAudit(
      actor,
      'file.usage_detach',
      'file',
      String(fileId),
      {
        moduleName: usage.moduleName,
        entityType: usage.entityType,
        entityId: usage.entityId,
      },
      { usageCount: nextCount },
    );

    return { removed: true, usageId, usageCount: nextCount };
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
    const file = await this.filesRepo.findById(input.fileId);
    if (!file || file.status !== FILE_STATUS.ACTIVE) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }

    const target = {
      fileId: input.fileId,
      moduleName: input.moduleName.trim(),
      entityType: input.entityType.trim(),
      entityId: String(input.entityId).trim(),
      fieldName: (input.fieldName ?? 'default').trim(),
    };

    const existing = await this.usagesRepo.findByTarget(target);
    if (!existing) {
      await this.usagesRepo.saveEntity({
        ...target,
        note: input.note ?? null,
        createdByUserId: input.actorId ?? null,
      });
    } else if (input.note !== undefined && existing.note !== input.note) {
      await this.usagesRepo.saveEntity({
        ...existing,
        note: input.note ?? null,
      });
    }

    await this.syncFileUsageCount(input.fileId);
  }

  public async detachUsage(params: {
    readonly fileId: number;
    readonly moduleName: string;
    readonly entityType: string;
    readonly entityId: string | number;
    readonly fieldName?: string;
  }): Promise<void> {
    const existing = await this.usagesRepo.findByTarget({
      fileId: params.fileId,
      moduleName: params.moduleName.trim(),
      entityType: params.entityType.trim(),
      entityId: String(params.entityId).trim(),
      fieldName: (params.fieldName ?? 'default').trim(),
    });
    if (existing) {
      await this.usagesRepo.softDeleteById(existing.id);
      await this.syncFileUsageCount(params.fileId);
    }
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
    const entityIdStr = String(params.entityId).trim();
    const fieldName = (params.fieldName ?? 'default').trim();
    const desiredFileIds = new Set(params.fileIds);

    const currentUsages = await this.usagesRepo.findByEntity({
      moduleName: params.moduleName.trim(),
      entityType: params.entityType.trim(),
      entityId: entityIdStr,
      fieldName,
    });

    for (const usage of currentUsages) {
      if (!desiredFileIds.has(usage.fileId)) {
        await this.usagesRepo.softDeleteById(usage.id);
        await this.syncFileUsageCount(usage.fileId);
      }
    }

    for (const fileId of desiredFileIds) {
      await this.attachUsage({
        fileId,
        moduleName: params.moduleName,
        entityType: params.entityType,
        entityId: entityIdStr,
        fieldName,
        note: params.note ?? null,
        actorId: params.actorId ?? null,
      });
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async syncFileUsageCount(fileId: number): Promise<number> {
    const count = await this.usagesRepo.countByFileId(fileId);
    const file = await this.filesRepo.findById(fileId);
    if (file && Number(file.usageCount) !== count) {
      await this.filesRepo.saveEntity({
        ...file,
        usageCount: count,
      });
    }
    return count;
  }

  private async assertNoActiveUsages(fileId: number): Promise<void> {
    const count = await this.syncFileUsageCount(fileId);
    if (count > 0) {
      throw new ConflictAppException('files.error.cannotDeleteReferencedFile', [], { count });
    }
  }

  /**
   * Kiểm tra hạn mức dung lượng lưu trữ (Mục 6.2):
   * 1. Theo đơn vị / hệ thống (`file.storage.quota_mb`).
   * 2. Theo người dùng (`file.storage.user_quota_mb`).
   */
  private async assertStorageQuotaWithinLimit(
    incomingSizeBytes: number,
    organizationUnitId?: number | null,
    userId?: number | null,
  ): Promise<void> {
    const orgQuotaMb = this.validationService.getStorageQuotaMb(organizationUnitId);
    if (orgQuotaMb > 0) {
      const maxOrgQuotaBytes = orgQuotaMb * 1024 * 1024;
      const usedOrgBytes =
        typeof this.filesRepo.sumActiveBytesByOrgUnit === 'function'
          ? await this.filesRepo.sumActiveBytesByOrgUnit(organizationUnitId)
          : (await this.filesRepo.findAllForStats())
              .filter(
                (f) =>
                  f.status === FILE_STATUS.ACTIVE &&
                  (!organizationUnitId || f.organizationUnitId === organizationUnitId),
              )
              .reduce((sum, f) => sum + (Number(f.sizeBytes) || 0), 0);

      if (usedOrgBytes + incomingSizeBytes > maxOrgQuotaBytes) {
        throw new BadRequestAppException('files.error.storageQuotaExceeded', [], {
          quotaMb: orgQuotaMb,
        });
      }
    }

    const userQuotaMb = this.validationService.getUserStorageQuotaMb(organizationUnitId);
    if (userQuotaMb > 0 && typeof userId === 'number' && userId > 0) {
      const maxUserQuotaBytes = userQuotaMb * 1024 * 1024;
      const usedUserBytes =
        typeof this.filesRepo.sumActiveBytesByUser === 'function'
          ? await this.filesRepo.sumActiveBytesByUser(userId)
          : (await this.filesRepo.findAllForStats())
              .filter((f) => f.status === FILE_STATUS.ACTIVE && f.uploadedByUserId === userId)
              .reduce((sum, f) => sum + (Number(f.sizeBytes) || 0), 0);

      if (usedUserBytes + incomingSizeBytes > maxUserQuotaBytes) {
        throw new BadRequestAppException('files.error.userStorageQuotaExceeded', [], {
          quotaMb: userQuotaMb,
        });
      }
    }
  }

  /** Kiểm tra trùng tên/slug thư mục trong cùng một thư mục cha (`parentId`) */
  private async assertUniqueFolderSlugInParent(
    parentId: number | null,
    slug: string,
    excludeFolderId?: number,
  ): Promise<void> {
    let duplicate: FileFolderEntity | null = null;
    if (typeof this.foldersRepo.findByParentAndSlug === 'function') {
      duplicate = await this.foldersRepo.findByParentAndSlug(parentId, slug);
    } else {
      const all = await this.foldersRepo.findAllOrdered();
      duplicate =
        all.find(
          (f) => (f.parentId ?? null) === parentId && f.slug.toLowerCase() === slug.toLowerCase(),
        ) ?? null;
    }

    if (duplicate && duplicate.id !== excludeFolderId) {
      throw new ConflictAppException('files.error.folderNameDuplicate');
    }
  }

  /** Cập nhật dây chuyền `folderPath` của toàn bộ thư mục con cháu khi di chuyển thư mục cha */
  private async cascadeUpdateDescendantFolderPaths(
    parentFolderId: number,
    oldFolderPath: string,
    newFolderPath: string,
  ): Promise<void> {
    const descendants =
      typeof this.foldersRepo.findDescendantsByPathPrefix === 'function'
        ? await this.foldersRepo.findDescendantsByPathPrefix(oldFolderPath)
        : (await this.foldersRepo.findAllOrdered()).filter((f) =>
            f.folderPath.startsWith(oldFolderPath),
          );

    for (const child of descendants) {
      if (child.id === parentFolderId) continue;
      if (child.folderPath.startsWith(oldFolderPath)) {
        const updatedChildPath = `${newFolderPath}${child.folderPath.slice(oldFolderPath.length)}`;
        await this.foldersRepo.saveEntity({
          ...child,
          folderPath: updatedChildPath,
        });
      }
    }
  }

  private isFolderAccessibleInScope(folder: FileFolderEntity, scope: FileScopeConstraint): boolean {
    if (scope.unrestricted) return true;
    if (!folder.organizationUnitId && !folder.createdByUserId) return true;
    if (folder.createdByUserId && folder.createdByUserId === scope.selfUserId) return true;
    if (folder.organizationUnitId && scope.allowedOrgUnitIds?.includes(folder.organizationUnitId)) {
      return true;
    }
    return false;
  }

  private async assertCanAccessFolder(
    folder: FileFolderEntity,
    actor?: UserIdentity,
  ): Promise<void> {
    if (!actor || !this.dataScopeService) return;
    const scope = await this.resolveFileScopeConstraint(actor);
    if (!this.isFolderAccessibleInScope(folder, scope)) {
      throw new ForbiddenAppException('files.error.folderAccessDenied');
    }
  }

  private computeSha256Hex(buffer: Buffer): string {
    return computeSha256Hex(buffer);
  }

  /** Sinh đường dẫn lưu trữ bất biến theo prefix cấu hình, năm/tháng/ngày và UUID */
  private buildImmutableStorageKey(ext: string): string {
    return buildImmutableStorageKey(this.validationService.getStorageKeyPrefix(), ext);
  }

  /** Sinh đường dẫn lưu trữ ảnh thu nhỏ (Thumbnail — Mục 6.3.5) */
  private buildThumbnailStorageKey(ext: string): string {
    return buildThumbnailStorageKey(this.validationService.getStorageKeyPrefix(), ext);
  }

  /** Xóa ảnh thumbnail trên Storage (nếu có) khi xóa vĩnh viễn file gốc */
  private async deleteThumbnailIfPresent(entity: FileRecordEntity): Promise<void> {
    if (!entity.metadataJson) return;
    const meta = safeJsonParseObject<Record<string, unknown>>(entity.metadataJson);
    const thumbKey =
      typeof meta?.thumbnailStorageKey === 'string' && meta.thumbnailStorageKey.length > 0
        ? meta.thumbnailStorageKey
        : null;
    if (thumbKey && (await this.storage.exists(thumbKey))) {
      await this.storage.delete(thumbKey).catch(() => undefined);
    }
  }

  /** Chuẩn hóa tên file khi tải xuống để dùng `displayName` mới kèm đuôi chuẩn */
  private buildSafeDownloadFileName(displayName: string, extension: string): string {
    return buildSafeDownloadFileName(displayName, extension);
  }

  /** Phân tích header `Range: bytes=start-end` phục vụ tua Video (`206 Partial Content`) */
  private parseByteRangeHeader(rangeHeader: string, totalSize: number): ResolvedByteRange {
    return parseByteRangeHeader(rangeHeader, totalSize);
  }

  private slugifyName(name: string): string {
    return slugifyFolderName(name);
  }

  private async resolveFileScopeConstraint(actor?: UserIdentity): Promise<FileScopeConstraint> {
    if (!actor || !this.dataScopeService) {
      return { unrestricted: true };
    }
    const resolvedFilter = await this.dataScopeService.resolveScopeFilter(actor, 'files', 'read');
    if (resolvedFilter.isUnrestricted || resolvedFilter.effectiveScope === DATA_SCOPE.ALL) {
      return { unrestricted: true };
    }
    const rootOrgIds = actor.organizationUnitIds ?? [];
    let allowedOrgUnitIds: number[] =
      resolvedFilter.allowedOrganizationUnitIds.length > 0
        ? [...resolvedFilter.allowedOrganizationUnitIds]
        : [...rootOrgIds];
    if (
      resolvedFilter.effectiveScope === DATA_SCOPE.ORG_UNIT &&
      rootOrgIds.length > 0 &&
      this.orgsPublicService?.resolveDescendantUnitIds
    ) {
      allowedOrgUnitIds = await this.orgsPublicService.resolveDescendantUnitIds(rootOrgIds);
    }

    let explicitAllowedFileIds: number[] = [];
    if (this.permissionsRepo) {
      const matchedPerms = await this.permissionsRepo.findActiveForActor({
        userId: actor.id,
        roles: actor.roles ?? [],
        orgUnitIds: allowedOrgUnitIds.length > 0 ? allowedOrgUnitIds : rootOrgIds,
      });
      explicitAllowedFileIds = [
        ...new Set(matchedPerms.filter((p) => p.canView || p.canDownload).map((p) => p.fileId)),
      ];
    }

    return {
      unrestricted: false,
      allowedOrgUnitIds,
      selfUserId: actor.id,
      explicitAllowedFileIds,
    };
  }

  /** Tìm các bản ghi phân quyền đang hiệu lực khớp với `actor` trên một `fileId` */
  private async findMatchingActivePermissions(
    fileId: number,
    actor: UserIdentity,
    allowedOrgUnitIds: readonly number[],
  ): Promise<FilePermissionEntity[]> {
    if (!this.permissionsRepo) return [];
    const orgIds =
      allowedOrgUnitIds.length > 0 ? allowedOrgUnitIds : (actor.organizationUnitIds ?? []);
    return this.permissionsRepo.findActiveForActor({
      fileId,
      userId: actor.id,
      roles: actor.roles ?? [],
      orgUnitIds: orgIds,
    });
  }

  /**
   * Kiểm tra quyền XEM thông tin file (Mục 6.2):
   * Hỗ trợ phân quyền theo Người dùng, Vai trò hoặc Đơn vị trong bảng `file_permissions` + `visibility` + `DataScope`.
   */
  private async assertCanViewFile(entity: FileRecordEntity, actor?: UserIdentity): Promise<void> {
    if (entity.visibility === FILE_VISIBILITY.PUBLIC) {
      return;
    }
    if (!actor) {
      return;
    }
    if (entity.uploadedByUserId && entity.uploadedByUserId === actor.id) {
      return;
    }

    const scope = await this.resolveFileScopeConstraint(actor);
    if (scope.unrestricted) {
      return;
    }

    const matchedPerms = await this.findMatchingActivePermissions(
      entity.id,
      actor,
      scope.allowedOrgUnitIds ?? [],
    );
    if (matchedPerms.length > 0) {
      if (matchedPerms.some((p) => p.canView || p.canDownload)) {
        return;
      }
      throw new ForbiddenAppException('files.error.accessDeniedScope');
    }

    if (entity.visibility === FILE_VISIBILITY.INTERNAL) {
      return;
    }
    if (entity.organizationUnitId && scope.allowedOrgUnitIds?.includes(entity.organizationUnitId)) {
      return;
    }
    throw new ForbiddenAppException('files.error.accessDeniedScope');
  }

  /**
   * Kiểm tra quyền TẢI XUỐNG / STREAM file (Mục 6.2 — Có thể khác quyền xem thông tin):
   * - Nếu người dùng có bản ghi phân quyền trong `file_permissions`:
   *   + Có ít nhất 1 quyền `canDownload = true` -> Cho phép tải.
   *   + Chỉ có quyền `canView = true` nhưng tất cả quyền khớp đều `canDownload = false` -> CHẶN TẢI (`downloadPermissionDenied`),
   *     dù người dùng vẫn xem được thông tin chi tiết của file.
   */
  private async assertCanDownloadFile(
    entity: FileRecordEntity,
    actor?: UserIdentity,
  ): Promise<void> {
    if (!actor) {
      return;
    }
    if (entity.uploadedByUserId && entity.uploadedByUserId === actor.id) {
      return;
    }

    const scope = await this.resolveFileScopeConstraint(actor);
    if (scope.unrestricted) {
      return;
    }

    const matchedPerms = await this.findMatchingActivePermissions(
      entity.id,
      actor,
      scope.allowedOrgUnitIds ?? [],
    );
    if (matchedPerms.length > 0) {
      if (matchedPerms.some((p) => p.canDownload)) {
        return;
      }
      if (matchedPerms.some((p) => p.canView)) {
        throw new ForbiddenAppException('files.error.downloadPermissionDenied');
      }
      throw new ForbiddenAppException('files.error.accessDeniedScope');
    }

    if (
      entity.visibility === FILE_VISIBILITY.PUBLIC ||
      entity.visibility === FILE_VISIBILITY.INTERNAL
    ) {
      return;
    }
    if (entity.organizationUnitId && scope.allowedOrgUnitIds?.includes(entity.organizationUnitId)) {
      return;
    }
    throw new ForbiddenAppException('files.error.accessDeniedScope');
  }

  private async canDownloadFile(entity: FileRecordEntity, actor?: UserIdentity): Promise<boolean> {
    try {
      await this.assertCanDownloadFile(entity, actor);
      return true;
    } catch {
      return false;
    }
  }

  /** Kiểm tra quyền quản lý file (sửa metadata, chuyển thư mục, cấp quyền, xóa) */
  private async assertCanManageFile(entity: FileRecordEntity, actor?: UserIdentity): Promise<void> {
    if (!actor || !this.dataScopeService) {
      return;
    }
    if (entity.uploadedByUserId && entity.uploadedByUserId === actor.id) {
      return;
    }
    const scope = await this.resolveFileScopeConstraint(actor);
    if (scope.unrestricted) {
      return;
    }
    if (entity.organizationUnitId && scope.allowedOrgUnitIds?.includes(entity.organizationUnitId)) {
      return;
    }
    throw new ForbiddenAppException('files.error.accessDeniedScope');
  }

  private async resolveSigningSecret(): Promise<string> {
    if (this.tokenService) {
      const accessSecret = await this.tokenService.getAccessSecret().catch(() => '');
      if (accessSecret) return accessSecret;
    }
    return FALLBACK_TEMP_LINK_SECRET;
  }

  private signTemporaryDownloadToken(
    payload: TemporaryDownloadTokenPayload,
    secret: string,
  ): string {
    return signTemporaryDownloadToken(payload, secret);
  }

  private verifyTemporaryDownloadToken(
    token: string,
    secret: string,
  ): TemporaryDownloadTokenPayload | null {
    return verifyTemporaryDownloadToken(token, secret);
  }

  private async loadUploaderSummaries(
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

  private async recordAudit(
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
