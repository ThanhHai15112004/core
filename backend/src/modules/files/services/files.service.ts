import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
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
} from '@packages/kernel/index.js';
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
  FILE_CATEGORY,
  FILE_PERMISSION_SUBJECT,
  FILE_STATUS,
  FILE_VISIBILITY,
  type FileCategoryCode,
  type FilePermissionSubjectCode,
  type FileSummary,
  type IFilesPublicService,
  getFileCategoryName,
  parseFilePermissionSubjectType,
} from '../contracts/index.js';
import type { FileFolderEntity } from '../entities/file-folder.entity.js';
import type { FilePermissionEntity } from '../entities/file-permission.entity.js';
import type { FileRecordEntity } from '../entities/file-record.entity.js';
import { FilesMapper } from '../mappers/files.mapper.js';
import { FileFoldersRepository } from '../repositories/file-folders.repository.js';
import { FilePermissionsRepository } from '../repositories/file-permissions.repository.js';
import { FileUsagesRepository } from '../repositories/file-usages.repository.js';
import { type FileScopeConstraint, FilesRepository } from '../repositories/files.repository.js';
import type {
  AttachFileUsageRequest,
  CreateFileFolderRequest,
  CreateTemporaryDownloadLinkRequest,
  GrantFilePermissionRequest,
  ListFilesQuery,
  UpdateFileFolderRequest,
  UpdateFileMetadataRequest,
  UploadBatchFilesRequest,
  UploadSingleFileRequest,
} from '../requests/files.requests.js';
import type {
  FileFolderResponse,
  FilePermissionItemResponse,
  FileRecordResponse,
  FileStatsResponse,
  FileUploaderSummary,
  FileUsageItemResponse,
  TemporaryDownloadLinkResponse,
} from '../responses/files.response.js';
import { FileValidationService } from './file-validation.service.js';

const DAY_MS = 86_400_000;
const FALLBACK_TEMP_LINK_SECRET = 'core-files-temporary-download-hmac-secret-key';
const ALL_CATEGORIES: readonly FileCategoryCode[] = [
  FILE_CATEGORY.IMAGE,
  FILE_CATEGORY.VIDEO,
  FILE_CATEGORY.AUDIO,
  FILE_CATEGORY.DOCUMENT,
  FILE_CATEGORY.SPREADSHEET,
  FILE_CATEGORY.ARCHIVE,
  FILE_CATEGORY.OTHER,
];

interface TemporaryDownloadTokenPayload {
  readonly typ: 'file_temp_dl';
  readonly fid: number;
  readonly exp: number;
  readonly disp: 'attachment' | 'inline';
  readonly uid: number | null;
}

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
    @Optional()
    private readonly permissionsRepo?: FilePermissionsRepository | null,
    @Optional()
    private readonly tokenService?: TokenService | null,
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

  /** Tải một file lên hệ thống, kiểm tra chữ ký & dung lượng (theo đơn vị + người dùng) trước khi lưu */
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
      permissions: [],
      canDownload: true,
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
    const { page, limit } = resolvePagination(query, {
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

    const mapped = items.map((entity) =>
      this.mapper.toFileResponse(entity, {
        folderName: entity.folderId ? (folderMap.get(entity.folderId) ?? null) : null,
        uploadedByUser: entity.uploadedByUserId
          ? (uploaderMap.get(entity.uploadedByUserId) ?? null)
          : null,
      }),
    );

    return createPaginatedResult(mapped, total, page, limit);
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

    return this.mapper.toFileResponse(entity, {
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
    for (const cat of ALL_CATEGORIES) {
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
        userStorageQuotaMb: this.validationService.getUserStorageQuotaMb(orgId),
        tempLinkDefaultTtlSec: this.validationService.getTempLinkDefaultTtlSec(orgId),
        tempLinkMaxTtlSec: this.validationService.getTempLinkMaxTtlSec(orgId),
        reconcileOnList: this.validationService.shouldReconcileOnList(),
        storageKeyPrefix: this.validationService.getStorageKeyPrefix(),
      },
    };
  }

  // ─── 4. Tải file xuống, Stream Video & Link tải tạm thời (Mục 6.2) ─────────

  /** Chuẩn bị luồng tải file xuống (kiểm tra quyền tải file tách biệt quyền xem) */
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
      file: this.mapper.toFileResponse(entity),
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
      file: this.mapper.toFileResponse(entity),
      byteRange,
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
      file: this.mapper.toFileResponse(entity),
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

    return this.mapper.toFileResponse(saved, {
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

    await this.assertCanManageFile(entity, actor);
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
    const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signatureSegment = createHmac('sha256', secret)
      .update(payloadSegment)
      .digest('base64url');
    return `${payloadSegment}.${signatureSegment}`;
  }

  private verifyTemporaryDownloadToken(
    token: string,
    secret: string,
  ): TemporaryDownloadTokenPayload | null {
    if (!token || !secret) return null;
    const parts = token.trim().split('.');
    if (parts.length !== 2) return null;
    const [payloadSegment, signatureSegment] = parts;
    if (!payloadSegment || !signatureSegment) return null;

    try {
      const expectedSig = createHmac('sha256', secret).update(payloadSegment).digest('base64url');
      const sigBuf = Buffer.from(signatureSegment, 'utf8');
      const expectedBuf = Buffer.from(expectedSig, 'utf8');
      if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
        return null;
      }

      const decoded = JSON.parse(
        Buffer.from(payloadSegment, 'base64url').toString('utf8'),
      ) as Partial<TemporaryDownloadTokenPayload>;

      if (
        !decoded ||
        decoded.typ !== 'file_temp_dl' ||
        typeof decoded.fid !== 'number' ||
        decoded.fid <= 0 ||
        typeof decoded.exp !== 'number'
      ) {
        return null;
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (decoded.exp <= nowSeconds) {
        return null;
      }

      return {
        typ: 'file_temp_dl',
        fid: decoded.fid,
        exp: decoded.exp,
        disp: decoded.disp === 'inline' ? 'inline' : 'attachment',
        uid: typeof decoded.uid === 'number' ? decoded.uid : null,
      };
    } catch {
      return null;
    }
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
