import { z } from 'zod';
import type {
  FileCategoryCode,
  FileCategoryName,
  FilePermissionSubjectCode,
  FilePermissionSubjectName,
  FileStatusCode,
  FileStatusName,
  FileVisibilityCode,
  FileVisibilityName,
} from '../contracts/index.js';

export interface FileFolderResponse {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId: number | null;
  readonly folderPath: string;
  readonly organizationUnitId: number | null;
  readonly createdByUserId: number | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const fileFolderResponseSchema = z.object({
  id: z.number().int().min(1),
  code: z.string(),
  name: z.string(),
  slug: z.string(),
  parentId: z.number().int().min(1).nullable(),
  folderPath: z.string(),
  organizationUnitId: z.number().int().min(1).nullable(),
  createdByUserId: z.number().int().min(1).nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export interface FileUsageItemResponse {
  readonly id: number;
  readonly fileId: number;
  readonly moduleName: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly fieldName: string;
  readonly note: string | null;
  readonly createdByUserId: number | null;
  readonly createdAt: string;
}

export const fileUsageItemResponseSchema = z.object({
  id: z.number().int().min(1),
  fileId: z.number().int().min(1),
  moduleName: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  fieldName: z.string(),
  note: z.string().nullable(),
  createdByUserId: z.number().int().min(1).nullable(),
  createdAt: z.string(),
});

export interface FilePermissionItemResponse {
  readonly id: number;
  readonly fileId: number;
  readonly subjectType: FilePermissionSubjectCode;
  readonly subjectTypeName: FilePermissionSubjectName;
  readonly subjectId: string;
  readonly canView: boolean;
  readonly canDownload: boolean;
  readonly expiresAt: string | null;
  readonly note: string | null;
  readonly grantedByUserId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const filePermissionItemResponseSchema = z.object({
  id: z.number().int().min(1),
  fileId: z.number().int().min(1),
  subjectType: z.number().int().min(1).max(3),
  subjectTypeName: z.enum(['USER', 'ROLE', 'ORG_UNIT']),
  subjectId: z.string(),
  canView: z.boolean(),
  canDownload: z.boolean(),
  expiresAt: z.string().nullable(),
  note: z.string().nullable(),
  grantedByUserId: z.number().int().min(1).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export interface TemporaryDownloadLinkResponse {
  readonly fileId: number;
  readonly token: string;
  readonly expiresInSeconds: number;
  readonly expiresAt: string;
  readonly disposition: 'attachment' | 'inline';
  readonly downloadUrl: string;
}

export const temporaryDownloadLinkResponseSchema = z.object({
  fileId: z.number().int().min(1),
  token: z.string(),
  expiresInSeconds: z.number().int().min(1),
  expiresAt: z.string(),
  disposition: z.enum(['attachment', 'inline']),
  downloadUrl: z.string(),
});

export interface FileUploaderSummary {
  readonly id: number;
  readonly username: string;
  readonly fullName: string;
  readonly email: string;
}

export const fileUploaderSummarySchema = z.object({
  id: z.number().int().min(1),
  username: z.string(),
  fullName: z.string(),
  email: z.string(),
});

export interface FileRecordResponse {
  readonly id: number;
  readonly code: string;
  readonly folderId: number | null;
  readonly folderName: string | null;
  readonly displayName: string;
  readonly originalName: string;
  readonly storageDriver: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly extension: string;
  readonly category: FileCategoryCode;
  readonly categoryName: FileCategoryName;
  readonly sizeBytes: number;
  readonly sizeFormatted: string;
  readonly checksumSha256: string;
  readonly visibility: FileVisibilityCode;
  readonly visibilityName: FileVisibilityName;
  readonly status: FileStatusCode;
  readonly statusName: FileStatusName;
  readonly uploadedByUserId: number | null;
  readonly uploadedByUser: FileUploaderSummary | null;
  readonly organizationUnitId: number | null;
  readonly usageCount: number;
  readonly usages?: readonly FileUsageItemResponse[];
  readonly permissions?: readonly FilePermissionItemResponse[];
  readonly canDownload?: boolean;
  readonly canDelete: boolean;
  readonly trashedAt: string | null;
  readonly trashedByUserId: number | null;
  readonly purgeAfterAt: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly downloadUrl: string;
  readonly streamUrl: string;
  readonly publicUrl?: string | null;
  readonly thumbnailUrl?: string | null;
  readonly scanStatus?: 'CLEAN' | 'PENDING' | 'INFECTED';
  readonly threatName?: string | null;
  readonly duplicateOfFileId?: number | null;
  readonly imageDimensions?: { readonly width: number; readonly height: number } | null;
  readonly optimizedSavedBytes?: number;
  readonly moduleName?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const fileRecordResponseSchema = z.object({
  id: z.number().int().min(1),
  code: z.string(),
  folderId: z.number().int().min(1).nullable(),
  folderName: z.string().nullable(),
  displayName: z.string(),
  originalName: z.string(),
  storageDriver: z.string(),
  storageKey: z.string(),
  mimeType: z.string(),
  extension: z.string(),
  category: z.number().int().min(1).max(7),
  categoryName: z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'SPREADSHEET', 'ARCHIVE', 'OTHER']),
  sizeBytes: z.number().int().min(0),
  sizeFormatted: z.string(),
  checksumSha256: z.string(),
  visibility: z.number().int().min(1).max(3),
  visibilityName: z.enum(['PRIVATE', 'INTERNAL', 'PUBLIC']),
  status: z.number().int().min(1).max(6),
  statusName: z.enum(['ACTIVE', 'TRASHED', 'PURGED', 'MISSING', 'PENDING_SCAN', 'QUARANTINED']),
  uploadedByUserId: z.number().int().min(1).nullable(),
  uploadedByUser: fileUploaderSummarySchema.nullable(),
  organizationUnitId: z.number().int().min(1).nullable(),
  usageCount: z.number().int().min(0),
  usages: z.array(fileUsageItemResponseSchema).optional(),
  permissions: z.array(filePermissionItemResponseSchema).optional(),
  canDownload: z.boolean().optional(),
  canDelete: z.boolean(),
  trashedAt: z.string().nullable(),
  trashedByUserId: z.number().int().min(1).nullable(),
  purgeAfterAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  downloadUrl: z.string(),
  streamUrl: z.string(),
  publicUrl: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  scanStatus: z.enum(['CLEAN', 'PENDING', 'INFECTED']).optional(),
  threatName: z.string().nullable().optional(),
  duplicateOfFileId: z.number().int().min(1).nullable().optional(),
  imageDimensions: z
    .object({
      width: z.number().int().min(1),
      height: z.number().int().min(1),
    })
    .nullable()
    .optional(),
  optimizedSavedBytes: z.number().int().min(0).optional(),
  moduleName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export interface FileIntegrityVerificationResponse {
  readonly fileId: number;
  readonly expectedChecksumSha256: string;
  readonly actualChecksumSha256: string | null;
  readonly intact: boolean;
  readonly status: FileStatusCode;
  readonly statusName: FileStatusName;
  readonly duplicateFileIds: readonly number[];
  readonly verifiedAt: string;
}

export const fileIntegrityVerificationResponseSchema = z.object({
  fileId: z.number().int().min(1),
  expectedChecksumSha256: z.string(),
  actualChecksumSha256: z.string().nullable(),
  intact: z.boolean(),
  status: z.number().int().min(1).max(6),
  statusName: z.enum(['ACTIVE', 'TRASHED', 'PURGED', 'MISSING', 'PENDING_SCAN', 'QUARANTINED']),
  duplicateFileIds: z.array(z.number().int().min(1)),
  verifiedAt: z.string(),
});

export interface CleanupUnusedFilesResponse {
  readonly retentionDays: number;
  readonly action: 'trash' | 'purge';
  readonly cleanedCount: number;
  readonly cleanedIds: readonly number[];
}

export const cleanupUnusedFilesResponseSchema = z.object({
  retentionDays: z.number().min(0),
  action: z.enum(['trash', 'purge']),
  cleanedCount: z.number().int().min(0),
  cleanedIds: z.array(z.number().int().min(1)),
});

export interface ChunkedUploadInitResponse {
  readonly uploadId: string;
  readonly chunkSizeBytes: number;
  readonly totalChunks: number;
  readonly expiresAt: string;
}

export const chunkedUploadInitResponseSchema = z.object({
  uploadId: z.string().min(1),
  chunkSizeBytes: z.number().int().min(1),
  totalChunks: z.number().int().min(1),
  expiresAt: z.string(),
});

export interface ChunkedUploadPartResponse {
  readonly uploadId: string;
  readonly chunkIndex: number;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly progressPercent: number;
}

export const chunkedUploadPartResponseSchema = z.object({
  uploadId: z.string().min(1),
  chunkIndex: z.number().int().min(0),
  receivedBytes: z.number().int().min(0),
  totalBytes: z.number().int().min(1),
  progressPercent: z.number().min(0).max(100),
});

export interface FileStatsResponse {
  readonly totalActiveFiles: number;
  readonly totalActiveBytes: number;
  readonly totalActiveFormatted: string;
  readonly totalTrashedFiles: number;
  readonly totalTrashedBytes: number;
  readonly totalTrashedFormatted: string;
  readonly totalReferencedFiles: number;
  readonly totalFolders: number;
  readonly currentUserActiveBytes?: number;
  readonly currentUserActiveFormatted?: string;
  readonly byCategory: readonly {
    readonly category: FileCategoryCode;
    readonly categoryName: FileCategoryName;
    readonly count: number;
    readonly bytes: number;
    readonly bytesFormatted: string;
  }[];
  readonly settings: {
    readonly maxUploadSizeMb: number;
    readonly allowedExtensions: readonly string[];
    readonly trashRetentionDays: number;
    readonly maxBatchFiles?: number;
    readonly verifyMagicBytes?: boolean;
    readonly defaultVisibility?: FileVisibilityCode;
    readonly storageQuotaMb?: number;
    readonly userStorageQuotaMb?: number;
    readonly tempLinkDefaultTtlSec?: number;
    readonly tempLinkMaxTtlSec?: number;
    readonly reconcileOnList?: boolean;
    readonly storageKeyPrefix?: string;
    readonly categoryAllowedExtensions?: Readonly<Record<string, readonly string[]>>;
    readonly categoryMaxSizeMb?: Readonly<Record<string, number>>;
    readonly moduleMaxSizeMb?: Readonly<Record<string, number>>;
    readonly malwareScanEnabled?: boolean;
    readonly stageBeforePublish?: boolean;
    readonly duplicatePolicy?: 'ALLOW' | 'REJECT' | 'REUSE';
    readonly thumbnailEnabled?: boolean;
    readonly thumbnailMaxDim?: number;
    readonly optimizeImageEnabled?: boolean;
    readonly imageMaxWidth?: number;
    readonly imageMaxHeight?: number;
    readonly imageQuality?: number;
    readonly unusedRetentionDays?: number;
    readonly cdnBaseUrl?: string | null;
  };
}

export const fileStatsResponseSchema = z.object({
  totalActiveFiles: z.number().int().min(0),
  totalActiveBytes: z.number().int().min(0),
  totalActiveFormatted: z.string(),
  totalTrashedFiles: z.number().int().min(0),
  totalTrashedBytes: z.number().int().min(0),
  totalTrashedFormatted: z.string(),
  totalReferencedFiles: z.number().int().min(0),
  totalFolders: z.number().int().min(0),
  currentUserActiveBytes: z.number().int().min(0).optional(),
  currentUserActiveFormatted: z.string().optional(),
  byCategory: z.array(
    z.object({
      category: z.number().int().min(1).max(7),
      categoryName: z.string(),
      count: z.number().int().min(0),
      bytes: z.number().int().min(0),
      bytesFormatted: z.string(),
    }),
  ),
  settings: z.object({
    maxUploadSizeMb: z.number().min(1),
    allowedExtensions: z.array(z.string()),
    trashRetentionDays: z.number().int().min(1),
    maxBatchFiles: z.number().int().min(1).optional(),
    verifyMagicBytes: z.boolean().optional(),
    defaultVisibility: z.number().int().min(1).max(3).optional(),
    storageQuotaMb: z.number().int().min(0).optional(),
    userStorageQuotaMb: z.number().int().min(0).optional(),
    tempLinkDefaultTtlSec: z.number().int().min(1).optional(),
    tempLinkMaxTtlSec: z.number().int().min(1).optional(),
    reconcileOnList: z.boolean().optional(),
    storageKeyPrefix: z.string().optional(),
    categoryAllowedExtensions: z.record(z.string(), z.array(z.string())).optional(),
    categoryMaxSizeMb: z.record(z.string(), z.number()).optional(),
    moduleMaxSizeMb: z.record(z.string(), z.number()).optional(),
    malwareScanEnabled: z.boolean().optional(),
    stageBeforePublish: z.boolean().optional(),
    duplicatePolicy: z.enum(['ALLOW', 'REJECT', 'REUSE']).optional(),
    thumbnailEnabled: z.boolean().optional(),
    thumbnailMaxDim: z.number().int().min(1).optional(),
    optimizeImageEnabled: z.boolean().optional(),
    imageMaxWidth: z.number().int().min(1).optional(),
    imageMaxHeight: z.number().int().min(1).optional(),
    imageQuality: z.number().int().min(1).max(100).optional(),
    unusedRetentionDays: z.number().int().min(1).optional(),
    cdnBaseUrl: z.string().nullable().optional(),
  }),
});
