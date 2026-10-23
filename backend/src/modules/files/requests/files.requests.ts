import { z } from 'zod';
import { booleanQueryParam, optionalQueryParam } from '@packages/http/index.js';
import {
  FILE_STATUS,
  type FileCategoryCode,
  type FilePermissionSubjectCode,
  type FileStatusCode,
  type FileVisibilityCode,
  parseFileCategory,
  parseFilePermissionSubjectType,
  parseFileStatus,
  parseFileVisibility,
} from '../contracts/index.js';

const fileStatusSchema = z
  .preprocess(
    (val) => (val === undefined || val === '' ? undefined : parseFileStatus(val)),
    z.union([
      z.literal(FILE_STATUS.ACTIVE),
      z.literal(FILE_STATUS.TRASHED),
      z.literal(FILE_STATUS.PURGED),
      z.literal(FILE_STATUS.MISSING),
      z.literal(FILE_STATUS.PENDING_SCAN),
      z.literal(FILE_STATUS.QUARANTINED),
    ]),
  )
  .optional();

const fileCategorySchema = z
  .preprocess(
    (val) => (val === undefined || val === '' ? undefined : parseFileCategory(val)),
    z.number().int().min(1).max(7),
  )
  .optional();

const fileVisibilitySchema = z
  .preprocess(
    (val) => (val === undefined || val === '' ? undefined : parseFileVisibility(val)),
    z.number().int().min(1).max(3),
  )
  .optional();

const coerceOptionalIntId = z
  .preprocess((val) => {
    if (val === undefined || val === null || val === '') return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : val;
  }, z.number().int().min(1).nullable())
  .optional();

export const createFileFolderSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentId: coerceOptionalIntId,
  organizationUnitId: coerceOptionalIntId,
  description: z.string().trim().max(500).nullable().optional(),
});

export interface CreateFileFolderRequest {
  readonly name: string;
  readonly parentId?: number | null | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly description?: string | null | undefined;
}

export const updateFileFolderSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  parentId: coerceOptionalIntId,
  description: z.string().trim().max(500).nullable().optional(),
});

export interface UpdateFileFolderRequest {
  readonly name?: string | undefined;
  readonly parentId?: number | null | undefined;
  readonly description?: string | null | undefined;
}

export const uploadSingleFileSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  displayName: z.string().trim().min(1).max(255).optional(),
  mimeType: z.string().trim().max(150).optional(),
  contentBase64: z.string().optional(),
  textContent: z.string().optional(),
  folderId: coerceOptionalIntId,
  visibility: fileVisibilitySchema,
  organizationUnitId: coerceOptionalIntId,
  moduleName: z.string().trim().max(100).optional(),
  expectedCategory: fileCategorySchema,
  stageForScan: z.boolean().optional(),
  quarantineOnThreat: z.boolean().optional(),
  rejectDuplicate: z.boolean().optional(),
  reuseDuplicate: z.boolean().optional(),
  optimizeImage: z.boolean().optional(),
  generateThumbnail: z.boolean().optional(),
  maxWidth: z.coerce.number().int().min(16).max(8192).optional(),
  maxHeight: z.coerce.number().int().min(16).max(8192).optional(),
  quality: z.coerce.number().int().min(10).max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export interface UploadSingleFileRequest {
  readonly fileName: string;
  readonly displayName?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly contentBase64?: string | undefined;
  readonly textContent?: string | undefined;
  readonly folderId?: number | null | undefined;
  readonly visibility?: FileVisibilityCode | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly moduleName?: string | undefined;
  readonly expectedCategory?: FileCategoryCode | undefined;
  readonly stageForScan?: boolean | undefined;
  readonly quarantineOnThreat?: boolean | undefined;
  readonly rejectDuplicate?: boolean | undefined;
  readonly reuseDuplicate?: boolean | undefined;
  readonly optimizeImage?: boolean | undefined;
  readonly generateThumbnail?: boolean | undefined;
  readonly maxWidth?: number | undefined;
  readonly maxHeight?: number | undefined;
  readonly quality?: number | undefined;
  readonly metadata?: Record<string, unknown> | null | undefined;
}

export const uploadBatchFilesSchema = z.object({
  files: z.array(uploadSingleFileSchema).min(1),
  folderId: coerceOptionalIntId,
  visibility: fileVisibilitySchema,
  organizationUnitId: coerceOptionalIntId,
  moduleName: z.string().trim().max(100).optional(),
  stageForScan: z.boolean().optional(),
  quarantineOnThreat: z.boolean().optional(),
  rejectDuplicate: z.boolean().optional(),
  reuseDuplicate: z.boolean().optional(),
  optimizeImage: z.boolean().optional(),
  generateThumbnail: z.boolean().optional(),
});

export interface UploadBatchFilesRequest {
  readonly files: readonly UploadSingleFileRequest[];
  readonly folderId?: number | null | undefined;
  readonly visibility?: FileVisibilityCode | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly moduleName?: string | undefined;
  readonly stageForScan?: boolean | undefined;
  readonly quarantineOnThreat?: boolean | undefined;
  readonly rejectDuplicate?: boolean | undefined;
  readonly reuseDuplicate?: boolean | undefined;
  readonly optimizeImage?: boolean | undefined;
  readonly generateThumbnail?: boolean | undefined;
}

export const updateFileMetadataSchema = z.object({
  displayName: z.string().trim().min(1).max(255).optional(),
  folderId: coerceOptionalIntId,
  visibility: fileVisibilitySchema,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export interface UpdateFileMetadataRequest {
  readonly displayName?: string | undefined;
  readonly folderId?: number | null | undefined;
  readonly visibility?: FileVisibilityCode | undefined;
  readonly metadata?: Record<string, unknown> | null | undefined;
}

export const attachFileUsageSchema = z.object({
  moduleName: z.string().trim().min(1).max(100),
  entityType: z.string().trim().min(1).max(100),
  entityId: z.union([z.string().trim().min(1).max(100), z.number().int().min(1)]),
  fieldName: z.string().trim().min(1).max(100).default('default'),
  note: z.string().trim().max(255).nullable().optional(),
});

export interface AttachFileUsageRequest {
  readonly moduleName: string;
  readonly entityType: string;
  readonly entityId: string | number;
  readonly fieldName?: string | undefined;
  readonly note?: string | null | undefined;
}

const filePermissionSubjectTypeSchema = z.preprocess(
  (val) => parseFilePermissionSubjectType(val),
  z.number().int().min(1).max(3),
);

export const grantFilePermissionSchema = z.object({
  subjectType: filePermissionSubjectTypeSchema,
  subjectId: z.union([z.string().trim().min(1).max(100), z.number().int().min(1)]),
  canView: z.boolean().optional().default(true),
  canDownload: z.boolean().optional().default(false),
  expiresAt: z.string().trim().max(64).nullable().optional(),
  note: z.string().trim().max(255).nullable().optional(),
});

export interface GrantFilePermissionRequest {
  readonly subjectType: FilePermissionSubjectCode;
  readonly subjectId: string | number;
  readonly canView?: boolean | undefined;
  readonly canDownload?: boolean | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly note?: string | null | undefined;
}

export const createTemporaryDownloadLinkSchema = z.object({
  expiresInSeconds: z.coerce.number().int().min(10).optional(),
  disposition: z.enum(['attachment', 'inline']).optional().default('attachment'),
});

export interface CreateTemporaryDownloadLinkRequest {
  readonly expiresInSeconds?: number | undefined;
  readonly disposition?: 'attachment' | 'inline' | undefined;
}

export const quarantineFileSchema = z.object({
  reason: z.string().trim().min(1).max(255).optional(),
});

export interface QuarantineFileRequest {
  readonly reason?: string | undefined;
}

export const cleanupUnusedFilesSchema = z.object({
  olderThanDays: z.coerce.number().min(0).max(3650).optional(),
  action: z.enum(['trash', 'purge']).optional().default('trash'),
  organizationUnitId: coerceOptionalIntId,
});

export interface CleanupUnusedFilesRequest {
  readonly olderThanDays?: number | undefined;
  readonly action?: 'trash' | 'purge' | undefined;
  readonly organizationUnitId?: number | null | undefined;
}

export const listFilesQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(1000)),
  search: optionalQueryParam(z.string().trim().max(200)),
  folderId: optionalQueryParam(z.coerce.number().int().min(0)),
  category: fileCategorySchema,
  status: fileStatusSchema,
  visibility: fileVisibilitySchema,
  extension: optionalQueryParam(z.string().trim().max(32)),
  mimeType: optionalQueryParam(z.string().trim().max(150)),
  uploadedByUserId: optionalQueryParam(z.coerce.number().int().min(1)),
  organizationUnitId: optionalQueryParam(z.coerce.number().int().min(1)),
  createdFrom: optionalQueryParam(z.string().trim().max(64)),
  createdTo: optionalQueryParam(z.string().trim().max(64)),
  minSizeBytes: optionalQueryParam(z.coerce.number().int().min(0)),
  maxSizeBytes: optionalQueryParam(z.coerce.number().int().min(0)),
  onlyReferenced: booleanQueryParam().optional(),
  onlyUnused: booleanQueryParam().optional(),
});

export interface ListFilesQuery {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly search?: string | undefined;
  readonly folderId?: number | undefined;
  readonly category?: FileCategoryCode | undefined;
  readonly status?: FileStatusCode | undefined;
  readonly visibility?: FileVisibilityCode | undefined;
  readonly extension?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly uploadedByUserId?: number | undefined;
  readonly organizationUnitId?: number | undefined;
  readonly createdFrom?: string | undefined;
  readonly createdTo?: string | undefined;
  readonly minSizeBytes?: number | undefined;
  readonly maxSizeBytes?: number | undefined;
  readonly onlyReferenced?: boolean | undefined;
  readonly onlyUnused?: boolean | undefined;
}
