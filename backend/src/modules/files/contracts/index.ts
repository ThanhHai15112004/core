import { defaultCodeRegistry } from '@packages/kernel/index.js';

export const FILE_STATUS = {
  ACTIVE: 1,
  TRASHED: 2,
  PURGED: 3,
  MISSING: 4,
} as const;

export type FileStatusCode = (typeof FILE_STATUS)[keyof typeof FILE_STATUS];
export type FileStatusName = keyof typeof FILE_STATUS;

export const FILE_CATEGORY = {
  IMAGE: 1,
  VIDEO: 2,
  AUDIO: 3,
  DOCUMENT: 4,
  SPREADSHEET: 5,
  ARCHIVE: 6,
  OTHER: 7,
} as const;

export type FileCategoryCode = (typeof FILE_CATEGORY)[keyof typeof FILE_CATEGORY];
export type FileCategoryName = keyof typeof FILE_CATEGORY;

export const FILE_VISIBILITY = {
  PRIVATE: 1,
  INTERNAL: 2,
  PUBLIC: 3,
} as const;

export type FileVisibilityCode = (typeof FILE_VISIBILITY)[keyof typeof FILE_VISIBILITY];
export type FileVisibilityName = keyof typeof FILE_VISIBILITY;

/** Phân giải trạng thái tệp tin thông qua CodeRegistryService (`files.status`) */
export function parseFileStatus(val: unknown): FileStatusCode {
  const resolved = defaultCodeRegistry.parseToNumericCode('files.status', val, FILE_STATUS.ACTIVE);
  if (
    resolved === FILE_STATUS.TRASHED ||
    resolved === FILE_STATUS.PURGED ||
    resolved === FILE_STATUS.MISSING
  ) {
    return resolved;
  }
  return FILE_STATUS.ACTIVE;
}

/** Tra cứu tên trạng thái tệp tin từ `files.status` */
export function getFileStatusName(code: number): FileStatusName {
  if (code === FILE_STATUS.MISSING) return 'MISSING';
  const name = defaultCodeRegistry.getCodeName('files.status', code, 'ACTIVE');
  if (name === 'TRASHED' || name === 'PURGED' || name === 'MISSING') {
    return name;
  }
  return 'ACTIVE';
}

/** Phân giải phân loại nhóm tệp tin qua CodeRegistryService (`files.category`) */
export function parseFileCategory(val: unknown): FileCategoryCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    'files.category',
    val,
    FILE_CATEGORY.OTHER,
  );
  if (resolved >= 1 && resolved <= 7) {
    return resolved as FileCategoryCode;
  }
  return FILE_CATEGORY.OTHER;
}

/** Tra cứu tên nhóm tệp tin từ `files.category` */
export function getFileCategoryName(code: number): FileCategoryName {
  const name = defaultCodeRegistry.getCodeName('files.category', code, 'OTHER');
  if (
    name === 'IMAGE' ||
    name === 'VIDEO' ||
    name === 'AUDIO' ||
    name === 'DOCUMENT' ||
    name === 'SPREADSHEET' ||
    name === 'ARCHIVE'
  ) {
    return name;
  }
  return 'OTHER';
}

/** Phân giải mức độ hiển thị tệp tin qua CodeRegistryService (`files.visibility`) */
export function parseFileVisibility(val: unknown): FileVisibilityCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    'files.visibility',
    val,
    FILE_VISIBILITY.PRIVATE,
  );
  if (resolved === FILE_VISIBILITY.INTERNAL || resolved === FILE_VISIBILITY.PUBLIC) {
    return resolved;
  }
  return FILE_VISIBILITY.PRIVATE;
}

/** Tra cứu tên mức độ hiển thị tệp tin từ `files.visibility` */
export function getFileVisibilityName(code: number): FileVisibilityName {
  const name = defaultCodeRegistry.getCodeName('files.visibility', code, 'PRIVATE');
  if (name === 'INTERNAL' || name === 'PUBLIC') {
    return name;
  }
  return 'PRIVATE';
}

export interface FileSummary {
  readonly id: number;
  readonly code: string;
  readonly displayName: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly extension: string;
  readonly category: FileCategoryCode;
  readonly categoryName: FileCategoryName;
  readonly sizeBytes: number;
  readonly sizeFormatted: string;
  readonly status: FileStatusCode;
  readonly statusName: FileStatusName;
  readonly visibility: FileVisibilityCode;
  readonly visibilityName: FileVisibilityName;
  readonly usageCount: number;
}

export interface AttachFileUsageInput {
  readonly fileId: number;
  readonly moduleName: string;
  readonly entityType: string;
  readonly entityId: string | number;
  readonly fieldName?: string;
  readonly note?: string | null;
  readonly actorId?: number | null;
}

export interface IFilesPublicService {
  findByIds(ids: readonly number[]): Promise<FileSummary[]>;
  ensureActiveFilesExist(ids: readonly number[]): Promise<FileSummary[]>;
  attachUsage(input: AttachFileUsageInput): Promise<void>;
  detachUsage(params: {
    readonly fileId: number;
    readonly moduleName: string;
    readonly entityType: string;
    readonly entityId: string | number;
    readonly fieldName?: string;
  }): Promise<void>;
  syncEntityFileUsages(params: {
    readonly moduleName: string;
    readonly entityType: string;
    readonly entityId: string | number;
    readonly fieldName?: string;
    readonly fileIds: readonly number[];
    readonly note?: string | null;
    readonly actorId?: number | null;
  }): Promise<void>;
}

export const FILES_PUBLIC_SERVICE = Symbol('FILES_PUBLIC_SERVICE');
