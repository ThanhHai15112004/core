import { Injectable } from '@nestjs/common';
import { formatBytes, safeJsonParseObject } from '@packages/kernel/index.js';
import {
  FILE_STATUS,
  type FileSummary,
  getFileCategoryName,
  getFileStatusName,
  getFileVisibilityName,
} from '../contracts/index.js';
import type { FileFolderEntity } from '../entities/file-folder.entity.js';
import type { FileRecordEntity } from '../entities/file-record.entity.js';
import type { FileUsageEntity } from '../entities/file-usage.entity.js';
import type {
  FileFolderResponse,
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

  /** Chuyển đổi thực thể File sang DTO phản hồi chi tiết */
  public toFileResponse(
    entity: FileRecordEntity,
    options?: {
      folderName?: string | null;
      uploadedByUser?: FileUploaderSummary | null;
      usages?: readonly FileUsageItemResponse[];
    },
  ): FileRecordResponse {
    const sizeBytes = Number(entity.sizeBytes) || 0;
    const usageCount = Number(entity.usageCount) || 0;
    const parsedMeta = entity.metadataJson
      ? safeJsonParseObject<Record<string, unknown>>(entity.metadataJson)
      : null;
    const metadata = parsedMeta && Object.keys(parsedMeta).length > 0 ? parsedMeta : null;

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
      canDelete: usageCount === 0 && entity.status !== FILE_STATUS.PURGED,
      trashedAt: entity.trashedAt ? entity.trashedAt.toISOString() : null,
      trashedByUserId: entity.trashedByUserId ?? null,
      purgeAfterAt: entity.purgeAfterAt ? entity.purgeAfterAt.toISOString() : null,
      metadata,
      downloadUrl: `/api/v1/files/${entity.id}/download`,
      streamUrl: `/api/v1/files/${entity.id}/stream`,
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
