import { z } from 'zod';
import type {
  FileCategoryCode,
  FileCategoryName,
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
  readonly canDelete: boolean;
  readonly trashedAt: string | null;
  readonly trashedByUserId: number | null;
  readonly purgeAfterAt: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly downloadUrl: string;
  readonly streamUrl: string;
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
  status: z.number().int().min(1).max(4),
  statusName: z.enum(['ACTIVE', 'TRASHED', 'PURGED', 'MISSING']),
  uploadedByUserId: z.number().int().min(1).nullable(),
  uploadedByUser: fileUploaderSummarySchema.nullable(),
  organizationUnitId: z.number().int().min(1).nullable(),
  usageCount: z.number().int().min(0),
  usages: z.array(fileUsageItemResponseSchema).optional(),
  canDelete: z.boolean(),
  trashedAt: z.string().nullable(),
  trashedByUserId: z.number().int().min(1).nullable(),
  purgeAfterAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  downloadUrl: z.string(),
  streamUrl: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
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
  }),
});
