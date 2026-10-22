import { frontendConfig } from '../../../config/index';
import { fetchApi, fetchApiWithMeta, IAM_ACCESS_TOKEN_KEY, type PaginationMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  FileFolderItem,
  FileRecordItem,
  FileUsageItem,
  ListFilesFilterParams,
  UploadSingleFilePayload,
} from '../types/files.types';

function buildQueryString(params: ListFilesFilterParams): string {
  const sp = new URLSearchParams();
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  if (params.search) sp.set('search', params.search);
  if (params.folderId !== undefined && params.folderId !== null) sp.set('folderId', String(params.folderId));
  if (params.rootOnly) sp.set('rootOnly', 'true');
  if (params.category !== undefined) sp.set('category', String(params.category));
  if (params.status !== undefined) sp.set('status', String(params.status));
  if (params.visibility !== undefined) sp.set('visibility', String(params.visibility));
  if (params.uploadedByUserId !== undefined) sp.set('uploadedByUserId', String(params.uploadedByUserId));
  if (params.organizationUnitId !== undefined) sp.set('organizationUnitId', String(params.organizationUnitId));
  if (params.extension) sp.set('extension', params.extension);
  if (params.onlyReferenced) sp.set('onlyReferenced', 'true');
  if (params.onlyUnused) sp.set('onlyUnused', 'true');
  if (params.createdFrom) sp.set('createdFrom', params.createdFrom);
  if (params.createdTo) sp.set('createdTo', params.createdTo);
  if (params.sortBy) sp.set('sortBy', params.sortBy);
  if (params.sortOrder) sp.set('sortOrder', params.sortOrder);
  return sp.toString();
}

export const filesApi = {
  /** Lấy danh sách thư mục ảo (phẳng hoặc cây) */
  listFolders: (tree = false, organizationUnitId?: number) => {
    const sp = new URLSearchParams();
    if (tree) sp.set('tree', 'true');
    if (organizationUnitId !== undefined) sp.set('organizationUnitId', String(organizationUnitId));
    return fetchApi<FileFolderItem[]>(API_ROUTES.FILES.FOLDERS(sp.toString()));
  },

  /** Tạo thư mục ảo mới */
  createFolder: (payload: {
    name: string;
    parentId?: number | null;
    description?: string | null;
    organizationUnitId?: number | null;
  }) =>
    fetchApi<FileFolderItem>(API_ROUTES.FILES.FOLDERS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Đổi tên hoặc di chuyển thư mục ảo */
  updateFolder: (
    id: number,
    payload: { name?: string; parentId?: number | null; description?: string | null },
  ) =>
    fetchApi<FileFolderItem>(API_ROUTES.FILES.FOLDER_BY_ID(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  /** Xóa thư mục ảo rỗng */
  deleteFolder: (id: number) =>
    fetchApi<{ deleted: boolean; id: number }>(API_ROUTES.FILES.FOLDER_BY_ID(id), {
      method: 'DELETE',
    }),

  /** Tìm kiếm và lọc danh sách file có phân trang */
  listFiles: (params: ListFilesFilterParams = {}): Promise<{ data: FileRecordItem[]; meta?: PaginationMeta }> =>
    fetchApiWithMeta<FileRecordItem[]>(API_ROUTES.FILES.LIST(buildQueryString(params))),

  /** Xem chi tiết thông tin file kèm người tải và danh sách nơi sử dụng */
  getFileById: (id: number) => fetchApi<FileRecordItem>(API_ROUTES.FILES.DETAIL(id)),

  /** Tải 1 file lên hệ thống */
  uploadSingle: (payload: UploadSingleFilePayload) =>
    fetchApi<FileRecordItem>(API_ROUTES.FILES.UPLOAD, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Tải nhiều file lên hệ thống cùng lúc */
  uploadBatch: (payload: {
    files: UploadSingleFilePayload[];
    folderId?: number | null;
    visibility?: number;
    organizationUnitId?: number | null;
    encryptAtRest?: boolean;
  }) =>
    fetchApi<{ uploadedCount: number; items: FileRecordItem[] }>(API_ROUTES.FILES.UPLOAD_BATCH, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Đổi tên hiển thị hoặc di chuyển thư mục (không đổi storageKey vật lý) */
  updateFile: (
    id: number,
    payload: {
      displayName?: string;
      folderId?: number | null;
      visibility?: number;
      description?: string | null;
      tags?: string[];
    },
  ) =>
    fetchApi<FileRecordItem>(API_ROUTES.FILES.UPDATE(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  /** Đưa file vào thùng rác */
  moveToTrash: (id: number) =>
    fetchApi<FileRecordItem>(API_ROUTES.FILES.TRASH(id), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** Khôi phục file từ thùng rác */
  restoreFromTrash: (id: number) =>
    fetchApi<FileRecordItem>(API_ROUTES.FILES.RESTORE(id), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** Xóa vĩnh viễn file khỏi DB và Storage */
  purgeFile: (id: number) =>
    fetchApi<{ purged: boolean; id: number; storageKey: string }>(API_ROUTES.FILES.PURGE(id), {
      method: 'DELETE',
    }),

  /** Dọn dẹp toàn bộ file quá hạn trong thùng rác */
  purgeExpiredTrash: () =>
    fetchApi<{ purgedCount: number; purgedIds: number[] }>(API_ROUTES.FILES.TRASH_PURGE_EXPIRED, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** Lấy danh sách chức năng đang sử dụng file */
  listUsages: (id: number) => fetchApi<FileUsageItem[]>(API_ROUTES.FILES.USAGES(id)),

  /** Gắn liên kết sử dụng file */
  attachUsage: (
    id: number,
    payload: {
      moduleName: string;
      entityType: string;
      entityId: string | number;
      fieldName?: string | null;
      note?: string | null;
    },
  ) =>
    fetchApi<FileUsageItem>(API_ROUTES.FILES.USAGES(id), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Gỡ liên kết sử dụng file */
  detachUsage: (
    id: number,
    payload: {
      moduleName: string;
      entityType: string;
      entityId: string | number;
      fieldName?: string | null;
    },
  ) =>
    fetchApi<{ detached: boolean; usageCount: number }>(API_ROUTES.FILES.USAGES_DETACH(id), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Lấy URL tải file trực tiếp hoặc tải qua fetch có kèm Bearer token */
  downloadFileWithAuth: async (file: FileRecordItem): Promise<void> => {
    const token =
      typeof window !== 'undefined' ? window.localStorage.getItem(IAM_ACCESS_TOKEN_KEY) : null;
    const res = await fetch(`${frontendConfig.apiBaseUrl}${API_ROUTES.FILES.DOWNLOAD(file.id)}`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(errBody?.error?.message ?? `Tải file thất bại (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.displayName || file.originalName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Tạo URL stream media/video (hỗ trợ HTTP Range 206 Partial Content) */
  getStreamUrl: (fileId: number): string => {
    return `${frontendConfig.apiBaseUrl}${API_ROUTES.FILES.STREAM(fileId)}`;
  },
};

/** Helper đọc đối tượng File của trình duyệt sang Base64 */
export function readBrowserFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Không thể đọc tệp ${file.name}`));
    reader.readAsDataURL(file);
  });
}
