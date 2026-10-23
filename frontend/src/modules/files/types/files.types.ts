export interface FileFolderItem {
  id: number;
  code: string;
  name: string;
  slug: string;
  parentId: number | null;
  folderPath: string;
  organizationUnitId: number | null;
  createdByUserId: number | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  children?: FileFolderItem[];
}

export interface FileUsageItem {
  id: number;
  fileId: number;
  moduleName: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  createdByUserId: number | null;
  note: string | null;
  createdAt: string;
}

export interface FilePermissionItem {
  id: number;
  fileId: number;
  subjectType: number;
  subjectTypeName: 'USER' | 'ROLE' | 'ORG_UNIT';
  subjectId: string;
  canView: boolean;
  canDownload: boolean;
  expiresAt: string | null;
  note: string | null;
  grantedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemporaryDownloadLinkItem {
  fileId: number;
  token: string;
  expiresInSeconds: number;
  expiresAt: string;
  disposition: 'attachment' | 'inline';
  downloadUrl: string;
}

export interface FileUploaderSummary {
  id: number;
  username: string;
  email: string;
  fullName: string | null;
}

export interface FileRecordItem {
  id: number;
  code: string;
  folderId: number | null;
  folderName?: string | null;
  displayName: string;
  originalName: string;
  storageDriver: string;
  storageKey: string;
  mimeType: string;
  extension: string;
  category: number;
  categoryName: 'DOCUMENT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'ARCHIVE' | 'SPREADSHEET' | 'OTHER';
  sizeBytes: number;
  sizeFormatted: string;
  checksumSha256: string;
  visibility: number;
  visibilityName: 'PRIVATE' | 'PUBLIC';
  status: number;
  statusName: 'ACTIVE' | 'TRASHED' | 'PURGED';
  uploadedByUserId: number | null;
  uploadedByUser?: FileUploaderSummary | null;
  organizationUnitId: number | null;
  usageCount: number;
  canDelete: boolean;
  trashedAt: string | null;
  trashedByUserId: number | null;
  purgeAfterAt: string | null;
  metadata: Record<string, unknown> | null;
  downloadUrl: string;
  streamUrl: string;
  createdAt: string;
  updatedAt: string;
  usages?: FileUsageItem[];
  permissions?: FilePermissionItem[];
  canDownload?: boolean;
}

export interface UploadSingleFilePayload {
  fileName: string;
  mimeType?: string;
  contentBase64?: string;
  textContent?: string;
  folderId?: number | null;
  visibility?: number;
  organizationUnitId?: number | null;
  description?: string | null;
  tags?: string[];
  encryptAtRest?: boolean;
}

export interface ListFilesFilterParams {
  page?: number;
  limit?: number;
  search?: string;
  folderId?: number | null;
  rootOnly?: boolean;
  category?: number;
  status?: number;
  visibility?: number;
  uploadedByUserId?: number;
  organizationUnitId?: number;
  extension?: string;
  onlyReferenced?: boolean;
  onlyUnused?: boolean;
  createdFrom?: string;
  createdTo?: string;
  sortBy?: 'createdAt' | 'displayName' | 'sizeBytes' | 'usageCount';
  sortOrder?: 'asc' | 'desc';
}
