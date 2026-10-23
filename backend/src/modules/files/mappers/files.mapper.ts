import { Injectable } from '@nestjs/common';
import { formatBytes, safeJsonParseObject } from '@packages/kernel/index.js';
import {
  FILE_STATUS,
  FILE_VISIBILITY,
  type FileSummary,
  getFileCategoryName,
  getFilePermissionSubjectTypeName,
  getFileStatusName,
  getFileVisibilityName,
} from '../contracts/index.js';
import type { FileFolderEntity } from '../entities/file-folder.entity.js';
import type { FilePermissionEntity } from '../entities/file-permission.entity.js';
import type { FileRecordEntity } from '../entities/file-record.entity.js';
import type { FileUsageEntity } from '../entities/file-usage.entity.js';
import type {
  FileFolderResponse,
  FilePermissionItemResponse,
  FileRecordResponse,
  FileUploaderSummary,
  FileUsageItemResponse,
} from '../responses/files.response.js';

@Injectable()
export class FilesMapper {
  /** Chuyển đổi thực thể Thư mục sang DTO phản hồi */
  public toFolderResponse(entity: FileFolderEntity): FileFolderResponse {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      slug: entity.slug,
      parentId: entity.parentId ?? null,
      folderPath: entity.folderPath,
      organizationUnitId: entity.organizationUnitId ?? null,
      createdByUserId: entity.createdByUserId ?? null,
      description: entity.description ?? null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /** Chuyển đổi thực thể Liên kết sử dụng file sang DTO phản hồi */
  public toUsageResponse(entity: FileUsageEntity): FileUsageItemResponse {
    return {
      id: entity.id,
      fileId: entity.fileId,
      moduleName: entity.moduleName,
      entityType: entity.entityType,
      entityId: entity.entityId,
      fieldName: entity.fieldName,
      note: entity.note ?? null,
      createdByUserId: entity.createdByUserId ?? null,
      createdAt: entity.createdAt.toISOString(),
    };
  }

  /** Chuyển đổi thực thể Phân quyền truy cập file sang DTO phản hồi */
  public toPermissionResponse(entity: FilePermissionEntity): FilePermissionItemResponse {
    return {
      id: entity.id,
      fileId: entity.fileId,
      subjectType: entity.subjectType,
      subjectTypeName: getFilePermissionSubjectTypeName(entity.subjectType),
      subjectId: entity.subjectId,
      canView: Boolean(entity.canView),
      canDownload: Boolean(entity.canDownload),
      expiresAt: entity.expiresAt ? entity.expiresAt.toISOString() : null,
      note: entity.note ?? null,
      grantedByUserId: entity.grantedByUserId ?? null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /** Chuyển đổi thực thể File sang DTO phản hồi chi tiết */
  public toFileResponse(
    entity: FileRecordEntity,
    options?: {
      folderName?: string | null;
      uploadedByUser?: FileUploaderSummary | null;
      usages?: readonly FileUsageItemResponse[];
      permissions?: readonly FilePermissionItemResponse[];
      canDownload?: boolean;
      cdnBaseUrl?: string | null;
      storagePublicUrl?: string | null;
    },
  ): FileRecordResponse {
    const sizeBytes = Number(entity.sizeBytes) || 0;
    const usageCount = Number(entity.usageCount) || 0;
    const parsedMeta = entity.metadataJson
      ? safeJsonParseObject<Record<string, unknown>>(entity.metadataJson)
      : null;
    const metadata = parsedMeta && Object.keys(parsedMeta).length > 0 ? parsedMeta : null;
    const hasThumbnail =
      typeof metadata?.thumbnailStorageKey === 'string' && metadata.thumbnailStorageKey.length > 0;
    const thumbnailUrl =
      hasThumbnail || entity.category === 1 ? `/api/v1/files/${entity.id}/thumbnail` : null;
    const scanStatus =
      metadata?.scanStatus === 'CLEAN' ||
      metadata?.scanStatus === 'PENDING' ||
      metadata?.scanStatus === 'INFECTED'
        ? metadata.scanStatus
        : entity.status === FILE_STATUS.PENDING_SCAN
          ? 'PENDING'
          : entity.status === FILE_STATUS.QUARANTINED
            ? 'INFECTED'
            : 'CLEAN';
    const threatName = typeof metadata?.threatName === 'string' ? metadata.threatName : null;
    const duplicateOfFileId =
      typeof metadata?.duplicateOfFileId === 'number' && metadata.duplicateOfFileId > 0
        ? metadata.duplicateOfFileId
        : null;
    const rawDims = metadata?.imageDimensions as { width?: unknown; height?: unknown } | undefined;
    const imageDimensions =
      rawDims &&
      typeof rawDims.width === 'number' &&
      rawDims.width > 0 &&
      typeof rawDims.height === 'number' &&
      rawDims.height > 0
        ? { width: rawDims.width, height: rawDims.height }
        : null;
    const optimizedSavedBytes =
      typeof metadata?.optimizedSavedBytes === 'number' && metadata.optimizedSavedBytes >= 0
        ? metadata.optimizedSavedBytes
        : undefined;
    const moduleName = typeof metadata?.moduleName === 'string' ? metadata.moduleName : null;

    // Mục 6.4.7: Hỗ trợ CDN hoặc URL công khai chỉ áp dụng cho file được phép công khai (PUBLIC + ACTIVE)
    const isPubliclyAccessible =
      entity.visibility === FILE_VISIBILITY.PUBLIC && entity.status === FILE_STATUS.ACTIVE;
    const cleanKey = entity.storageKey.replace(/^\/+/, '');
    const cleanCdnBase = options?.cdnBaseUrl ? options.cdnBaseUrl.trim().replace(/\/+$/, '') : '';
    const resolvedPublicUrl = isPubliclyAccessible
      ? cleanCdnBase
        ? `${cleanCdnBase}/${cleanKey}`
        : options?.storagePublicUrl && /^https?:\/\//i.test(options.storagePublicUrl)
          ? options.storagePublicUrl
          : `/api/v1/files/${entity.id}/public`
      : null;

    return {
      id: entity.id,
      code: entity.code,
      folderId: entity.folderId ?? null,
      folderName: options?.folderName ?? null,
      displayName: entity.displayName,
      originalName: entity.originalName,
      storageDriver: entity.storageDriver,
      storageKey: entity.storageKey,
      mimeType: entity.mimeType,
      extension: entity.extension,
      category: entity.category,
      categoryName: getFileCategoryName(entity.category),
      sizeBytes,
      sizeFormatted: formatBytes(sizeBytes),
      checksumSha256: entity.checksumSha256,
      visibility: entity.visibility,
      visibilityName: getFileVisibilityName(entity.visibility),
      status: entity.status,
      statusName: getFileStatusName(entity.status),
      uploadedByUserId: entity.uploadedByUserId ?? null,
      uploadedByUser: options?.uploadedByUser ?? null,
      organizationUnitId: entity.organizationUnitId ?? null,
      usageCount,
      ...(options?.usages !== undefined ? { usages: options.usages } : {}),
      ...(options?.permissions !== undefined ? { permissions: options.permissions } : {}),
      ...(options?.canDownload !== undefined ? { canDownload: options.canDownload } : {}),
      canDelete: usageCount === 0 && entity.status !== FILE_STATUS.PURGED,
      trashedAt: entity.trashedAt ? entity.trashedAt.toISOString() : null,
      trashedByUserId: entity.trashedByUserId ?? null,
      purgeAfterAt: entity.purgeAfterAt ? entity.purgeAfterAt.toISOString() : null,
      metadata,
      downloadUrl: `/api/v1/files/${entity.id}/download`,
      streamUrl: `/api/v1/files/${entity.id}/stream`,
      publicUrl: resolvedPublicUrl,
      thumbnailUrl,
      scanStatus,
      threatName,
      duplicateOfFileId,
      imageDimensions,
      ...(optimizedSavedBytes !== undefined ? { optimizedSavedBytes } : {}),
      moduleName,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /** Chuyển đổi thực thể File sang bản tóm tắt dùng cho Public Contract */
  public toFileSummary(entity: FileRecordEntity): FileSummary {
    const sizeBytes = Number(entity.sizeBytes) || 0;
    return {
      id: entity.id,
      code: entity.code,
      displayName: entity.displayName,
      originalName: entity.originalName,
      mimeType: entity.mimeType,
      extension: entity.extension,
      category: entity.category,
      categoryName: getFileCategoryName(entity.category),
      sizeBytes,
      sizeFormatted: formatBytes(sizeBytes),
      status: entity.status,
      statusName: getFileStatusName(entity.status),
      visibility: entity.visibility,
      visibilityName: getFileVisibilityName(entity.visibility),
      usageCount: Number(entity.usageCount) || 0,
    };
  }
}
