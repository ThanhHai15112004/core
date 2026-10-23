import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  type PaginatedResult,
  SequenceRegistryService,
  defaultSequenceRegistry,
  formatBytes,
} from '@packages/kernel/index.js';
import {
  AuditLogService,
  DATA_SCOPE,
  DataScopeService,
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
  FILE_CATEGORY,
  FILE_STATUS,
  FILE_VISIBILITY,
  type FileCategoryCode,
  type FileSummary,
  type IFilesPublicService,
  getFileCategoryName,
} from '../contracts/index.js';
import type { FileFolderEntity } from '../entities/file-folder.entity.js';
import type { FileRecordEntity } from '../entities/file-record.entity.js';
import { FilesMapper } from '../mappers/files.mapper.js';
import { FileFoldersRepository } from '../repositories/file-folders.repository.js';
import { FileUsagesRepository } from '../repositories/file-usages.repository.js';
import { type FileScopeConstraint, FilesRepository } from '../repositories/files.repository.js';
import type {
  AttachFileUsageRequest,
  CreateFileFolderRequest,
  ListFilesQuery,
  UpdateFileFolderRequest,
  UpdateFileMetadataRequest,
  UploadBatchFilesRequest,
  UploadSingleFileRequest,
} from '../requests/files.requests.js';
import type {
  FileFolderResponse,
  FileRecordResponse,
  FileStatsResponse,
  FileUploaderSummary,
  FileUsageItemResponse,
} from '../responses/files.response.js';
import { FileValidationService } from './file-validation.service.js';

const DAY_MS = 86_400_000;
const ALL_CATEGORIES: readonly FileCategoryCode[] = [
  FILE_CATEGORY.IMAGE,
  FILE_CATEGORY.VIDEO,
  FILE_CATEGORY.AUDIO,
  FILE_CATEGORY.DOCUMENT,
  FILE_CATEGORY.SPREADSHEET,
  FILE_CATEGORY.ARCHIVE,
  FILE_CATEGORY.OTHER,
];

export interface ResolvedByteRange {
  readonly start: number;
  readonly end: number;
  readonly totalSize: number;
  readonly contentLength: number;
}

@Injectable()
export class FilesService implements IFilesPublicService {
  private readonly sequenceRegistry: SequenceRegistryService;

  constructor(
    private readonly filesRepo: FilesRepository,
    private readonly foldersRepo: FileFoldersRepository,
    private readonly usagesRepo: FileUsagesRepository,
    private readonly mapper: FilesMapper,
    private readonly validationService: FileValidationService,
    private readonly storage: BaseStorageProvider,
    @Optional() private readonly dataScopeService?: DataScopeService | null,
    @Optional() private readonly auditLogService?: AuditLogService | null,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService?: IUsersPublicService | null,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly orgsPublicService?: IOrganizationsPublicService | null,
    @Optional()
    @Inject(SequenceRegistryService)
    sequenceRegistry?: SequenceRegistryService | null,
  ) {
    this.sequenceRegistry = sequenceRegistry ?? defaultSequenceRegistry;
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
    if (!this.sequenceRegistry.getRule(sequenceKey)) {
      this.sequenceRegistry.registerManifestSequences();
    }
    const generated = await this.sequenceRegistry.nextCode(
      sequenceKey,
      orgId ? { organizationUnitId: orgId } : undefined,
    );
    return generated.code;
  }

  // ─── 1. Quản lý Thư mục ảo (Logical Folders) ──────────────────────────────

  /** Lấy danh sách thư mục lưu trữ */
  public async listFolders(organizationUnitId?: number): Promise<FileFolderResponse[]> {
    const folders = await this.foldersRepo.findAllOrdered(organizationUnitId);
    return folders.map((f) => this.mapper.toFolderResponse(f));
  }

  /** Tạo thư mục mới trong File Manager (không tác động tới đường dẫn vật lý của file) */
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
    }

    const slug = this.slugifyName(input.name);
    const orgId = input.organizationUnitId ?? this.resolvePrimaryOrgId(actor);
    const code = await this.generateEntityCode('files.folder_code', orgId);

    const created = await this.foldersRepo.saveEntity({
      code,
      name: input.name.trim(),
      slug,
      parentId: parentFolder ? parentFolder.id : null,
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
    });

    return this.mapper.toFolderResponse(updated);
  }

  /** Đổi tên hoặc di chuyển thư mục (kiểm tra chống vòng lặp cây thư mục) */
  public async updateFolder(
    id: number,
    input: UpdateFileFolderRequest,
    actor?: UserIdentity,
  ): Promise<FileFolderResponse> {
    const folder = await this.foldersRepo.findById(id);
    if (!folder) {
      throw new NotFoundAppException('files.error.folderNotFound');
    }

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
        if (parent.folderPath.includes(`/${folder.id}/`)) {
          throw new BadRequestAppException('files.error.folderCycleDetected');
        }
        nextParentId = parent.id;
        nextFolderPath = `${parent.folderPath.replace(/\/$/, '')}/${folder.id}/`;
      }
    }

    const nextName = input.name !== undefined ? input.name.trim() : folder.name;
    const saved = await this.foldersRepo.saveEntity({
      ...folder,
      name: nextName,
      slug: this.slugifyName(nextName),
      parentId: nextParentId,
      folderPath: nextFolderPath,
      description:
        input.description !== undefined ? input.description : (folder.description ?? null),
    });

    await this.recordAudit(
      actor,
      'folder.update',
      'file_folder',
      String(saved.id),
      { name: folder.name, parentId: folder.parentId ?? null },
      { name: saved.name, parentId: saved.parentId ?? null },
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

  /** Tải một file lên hệ thống, kiểm tra chữ ký & dung lượng trước khi lưu vào Storage */
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
    }

    const validated = this.validationService.validateUploadInput(input, orgId);
    await this.assertStorageQuotaWithinLimit(validated.sizeBytes, orgId);
    const checksumSha256 = this.computeSha256Hex(validated.buffer);
    const storageKey = this.buildImmutableStorageKey(validated.extension);

    await this.storage.upload(storageKey, validated.buffer, validated.mimeType);

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
      status: FILE_STATUS.ACTIVE,
      uploadedByUserId: actor?.id ?? null,
      organizationUnitId: orgId,
      usageCount: 0,
      trashedAt: null,
      trashedByUserId: null,
      purgeAfterAt: null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    });

    await this.recordAudit(actor, 'file.upload', 'file', String(saved.id), null, {
      code: saved.code,
      displayName: saved.displayName,
      originalName: saved.originalName,
      mimeType: saved.mimeType,
      sizeBytes: Number(saved.sizeBytes),
      storageKey: saved.storageKey,
    });

    const uploaderMap = await this.loadUploaderSummaries(
      saved.uploadedByUserId ? [saved.uploadedByUserId] : [],
    );

    return this.mapper.toFileResponse(saved, {
      folderName: folder?.name ?? null,
      uploadedByUser: saved.uploadedByUserId
        ? (uploaderMap.get(saved.uploadedByUserId) ?? null)
        : null,
      usages: [],
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
      };
      const uploaded = await this.uploadSingle(mergedItem, actor);
      items.push(uploaded);
    }

    return { items, count: items.length };
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
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
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

    const mapped = items.map((entity) =>
      this.mapper.toFileResponse(entity, {
        folderName: entity.folderId ? (folderMap.get(entity.folderId) ?? null) : null,
        uploadedByUser: entity.uploadedByUserId
          ? (uploaderMap.get(entity.uploadedByUserId) ?? null)
          : null,
      }),
    );

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      data: mapped,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  /** Xem thông tin chi tiết của một file kèm người tải và danh sách chức năng đang sử dụng */
  public async getById(id: number, actor?: UserIdentity): Promise<FileRecordResponse> {
    const found = await this.filesRepo.findById(id);
    if (!found || found.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }

    await this.assertCanAccessFile(found, actor);
    const entity = await this.reconcileStorageExistence(found);

    const [folder, uploaderMap, usages] = await Promise.all([
      entity.folderId ? this.foldersRepo.findById(entity.folderId) : Promise.resolve(null),
      this.loadUploaderSummaries(entity.uploadedByUserId ? [entity.uploadedByUserId] : []),
      this.usagesRepo.findByFileId(entity.id),
    ]);

    return this.mapper.toFileResponse(entity, {
      folderName: folder?.name ?? null,
      uploadedByUser: entity.uploadedByUserId
        ? (uploaderMap.get(entity.uploadedByUserId) ?? null)
        : null,
      usages: usages.map((u) => this.mapper.toUsageResponse(u)),
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

    const categoryTotals = new Map<FileCategoryCode, { count: number; bytes: number }>();
    for (const cat of ALL_CATEGORIES) {
      categoryTotals.set(cat, { count: 0, bytes: 0 });
    }

    for (const file of allFiles) {
      const size = Number(file.sizeBytes) || 0;
      if (file.status === FILE_STATUS.ACTIVE) {
        totalActiveFiles++;
        totalActiveBytes += size;
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
      byCategory: ALL_CATEGORIES.map((category) => {
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
        reconcileOnList: this.validationService.shouldReconcileOnList(),
        storageKeyPrefix: this.validationService.getStorageKeyPrefix(),
      },
    };
  }

  // ─── 4. Tải file xuống & Stream Video có kiểm tra quyền ────────────────────

  /** Chuẩn bị luồng tải file xuống (kiểm tra quyền, dùng displayName đã đổi tên) */
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

    await this.assertCanAccessFile(entity, actor);

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
      file: this.mapper.toFileResponse(entity),
      downloadFileName,
    };
  }

  /**
   * Chuẩn bị luồng phát trực tiếp (Inline / Video & Audio Byte-Range Streaming `206 Partial Content`).
   * Cho phép trình phát Video tua nhanh đến bất kỳ thời điểm nào mà không phải tải toàn bộ file.
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

    await this.assertCanAccessFile(entity, actor);

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
      file: this.mapper.toFileResponse(entity),
      byteRange,
    };
  }

  // ─── 5. Đổi tên file & Di chuyển thư mục (Không đổi file gốc trong Storage) ─

  /** Đổi tên hiển thị, thư mục hoặc mức hiển thị mà không chạm vào `storage_key` vật lý */
  public async updateMetadata(
    id: number,
    input: UpdateFileMetadataRequest,
    actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    const entity = await this.filesRepo.findById(id);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }

    await this.assertCanAccessFile(entity, actor);

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

    // Chú ý: `storageKey` được giữ nguyên 100% không bao giờ thay đổi
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

    const [uploaderMap, usages] = await Promise.all([
      this.loadUploaderSummaries(saved.uploadedByUserId ? [saved.uploadedByUserId] : []),
      this.usagesRepo.findByFileId(saved.id),
    ]);

    return this.mapper.toFileResponse(saved, {
      folderName: folder?.name ?? null,
      uploadedByUser: saved.uploadedByUserId
        ? (uploaderMap.get(saved.uploadedByUserId) ?? null)
        : null,
      usages: usages.map((u) => this.mapper.toUsageResponse(u)),
    });
  }

  // ─── 6. Đưa vào thùng rác, Khôi phục & Xóa vĩnh viễn ───────────────────────

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

    await this.assertCanAccessFile(entity, actor);
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

    return this.mapper.toFileResponse(saved);
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

    await this.assertCanAccessFile(entity, actor);

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

    return this.mapper.toFileResponse(saved);
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

    await this.assertCanAccessFile(entity, actor);
    await this.assertNoActiveUsages(entity.id);

    const existsInStorage = await this.storage.exists(entity.storageKey);
    if (existsInStorage) {
      await this.storage.delete(entity.storageKey);
    }

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
    }

    return {
      purgedCount: purgedIds.length,
      purgedIds,
    };
  }

  // ─── 7. Theo dõi liên kết sử dụng file (`file_usages` & Public Contract) ───

  /** Lấy danh sách các chức năng/bản ghi đang sử dụng một file */
  public async listUsages(fileId: number, actor?: UserIdentity): Promise<FileUsageItemResponse[]> {
    const entity = await this.filesRepo.findById(fileId);
    if (!entity || entity.status === FILE_STATUS.PURGED) {
      throw new NotFoundAppException('files.error.fileNotFound');
    }
    await this.assertCanAccessFile(entity, actor);

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

  /** Kiểm tra hạn mức tổng dung lượng lưu trữ (`file.storage.quota_mb`) trước khi tải lên */
  private async assertStorageQuotaWithinLimit(
    incomingSizeBytes: number,
    organizationUnitId?: number | null,
  ): Promise<void> {
    const quotaMb = this.validationService.getStorageQuotaMb(organizationUnitId);
    if (quotaMb <= 0) return;

    const maxQuotaBytes = quotaMb * 1024 * 1024;
    const allFiles = await this.filesRepo.findAllForStats();
    const usedBytes = allFiles
      .filter(
        (f) =>
          f.status === FILE_STATUS.ACTIVE &&
          (!organizationUnitId || f.organizationUnitId === organizationUnitId),
      )
      .reduce((sum, f) => sum + (Number(f.sizeBytes) || 0), 0);

    if (usedBytes + incomingSizeBytes > maxQuotaBytes) {
      throw new BadRequestAppException('files.error.storageQuotaExceeded', [], { quotaMb });
    }
  }

  private computeSha256Hex(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /** Sinh đường dẫn lưu trữ bất biến theo prefix cấu hình, năm/tháng/ngày và UUID */
  private buildImmutableStorageKey(ext: string): string {
    const prefix = this.validationService.getStorageKeyPrefix();
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${prefix}/${yyyy}/${mm}/${dd}/${randomUUID()}.${ext}`;
  }

  /** Chuẩn hóa tên file khi tải xuống để dùng `displayName` mới kèm đuôi chuẩn */
  private buildSafeDownloadFileName(displayName: string, extension: string): string {
    const cleaned = displayName.trim().replace(/[^\p{L}\p{N}._\-() ]+/gu, '_');
    const expectedSuffix = `.${extension.toLowerCase()}`;
    const hasExt = cleaned.toLowerCase().endsWith(expectedSuffix);
    const withExt = hasExt ? cleaned : `${cleaned}${expectedSuffix}`;
    return path.basename(withExt) || `download${expectedSuffix}`;
  }

  /** Phân tích header `Range: bytes=start-end` phục vụ tua Video (`206 Partial Content`) */
  private parseByteRangeHeader(rangeHeader: string, totalSize: number): ResolvedByteRange {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      throw new BadRequestAppException('files.error.invalidByteRange');
    }
    const startStr = match[1] ?? '';
    const endStr = match[2] ?? '';

    let start = startStr ? Number.parseInt(startStr, 10) : 0;
    let end = endStr ? Number.parseInt(endStr, 10) : totalSize - 1;

    if (!startStr && endStr) {
      const suffixLength = Number.parseInt(endStr, 10);
      start = Math.max(0, totalSize - suffixLength);
      end = totalSize - 1;
    }

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      end < start ||
      start >= totalSize
    ) {
      throw new BadRequestAppException('files.error.invalidByteRange');
    }

    const clampedEnd = Math.min(end, totalSize - 1);
    return {
      start,
      end: clampedEnd,
      totalSize,
      contentLength: clampedEnd - start + 1,
    };
  }

  private slugifyName(name: string): string {
    return (
      name
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'folder'
    );
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
    return {
      unrestricted: false,
      allowedOrgUnitIds,
      selfUserId: actor.id,
    };
  }

  private async assertCanAccessFile(entity: FileRecordEntity, actor?: UserIdentity): Promise<void> {
    if (entity.visibility === FILE_VISIBILITY.PUBLIC) {
      return;
    }
    if (!actor || !this.dataScopeService) {
      return;
    }
    if (entity.visibility === FILE_VISIBILITY.INTERNAL) {
      return;
    }
    const scope = await this.resolveFileScopeConstraint(actor);
    if (scope.unrestricted) {
      return;
    }
    if (entity.uploadedByUserId && entity.uploadedByUserId === actor.id) {
      return;
    }
    if (entity.organizationUnitId && scope.allowedOrgUnitIds?.includes(entity.organizationUnitId)) {
      return;
    }
    throw new ForbiddenAppException('files.error.accessDeniedScope');
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
