import React from 'react';
import {
  ChevronRight,
  Download,
  Folder,
  FolderPlus,
  Home,
  LayoutGrid,
  List,
  Search,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import { FILE_CATEGORY_FILTER_OPTIONS, UPLOAD_MODULE_OPTIONS } from '../enum/files.enum';
import { filesApi } from '../services/files.api';
import type { FileFolderItem, FileRecordItem, FileStatsItem } from '../types/files.types';

export interface FileManagerToolbarProps {
  readonly searchQuery: string;
  readonly uploadModuleName: string;
  readonly uploadStageForScan: boolean;
  readonly uploadOptimizeImage: boolean;
  readonly uploadEncrypt: boolean;
  readonly pickedFromModal: readonly FileRecordItem[];
  readonly viewMode: 'active' | 'trash';
  readonly activeFolderObj: FileFolderItem | null;
  readonly foldersCount: number;
  readonly totalFiles: number;
  readonly uploading: boolean;
  readonly uploadProgressPercent?: number;
  readonly uploadProgressText?: string | null;
  readonly cleaningUnused: boolean;
  readonly stats: FileStatsItem | null;
  readonly selectedFile: FileRecordItem | null;
  readonly categoryFilter: number | undefined;
  readonly sortBy: 'newest' | 'name' | 'size';
  readonly layoutMode: 'list' | 'grid';
  readonly onChangeSearchQuery: (value: string) => void;
  readonly onChangeUploadModuleName: (value: string) => void;
  readonly onChangeUploadStageForScan: (checked: boolean) => void;
  readonly onChangeUploadOptimizeAndThumb: (checked: boolean) => void;
  readonly onChangeUploadEncrypt: (checked: boolean) => void;
  readonly onClearPickedFromModal: () => void;
  readonly onResetRootFolder: () => void;
  readonly onTriggerUploadClick: () => void;
  readonly onOpenNewFolderInput: () => void;
  readonly onOpenPicker: () => void;
  readonly onCleanupUnusedFiles: () => void;
  readonly onChangeCategoryFilter: (category: number | undefined) => void;
  readonly onChangeSortBy: (sort: 'newest' | 'name' | 'size') => void;
  readonly onChangeLayoutMode: (mode: 'list' | 'grid') => void;
  readonly onShowError: (message: string) => void;
}

export const FileManagerToolbar: React.FC<FileManagerToolbarProps> = ({
  searchQuery,
  uploadModuleName,
  uploadStageForScan,
  uploadOptimizeImage,
  uploadEncrypt,
  pickedFromModal,
  viewMode,
  activeFolderObj,
  foldersCount,
  totalFiles,
  uploading,
  uploadProgressPercent = 0,
  uploadProgressText = null,
  cleaningUnused,
  stats,
  selectedFile,
  categoryFilter,
  sortBy,
  layoutMode,
  onChangeSearchQuery,
  onChangeUploadModuleName,
  onChangeUploadStageForScan,
  onChangeUploadOptimizeAndThumb,
  onChangeUploadEncrypt,
  onClearPickedFromModal,
  onResetRootFolder,
  onTriggerUploadClick,
  onOpenNewFolderInput,
  onOpenPicker,
  onCleanupUnusedFiles,
  onChangeCategoryFilter,
  onChangeSortBy,
  onChangeLayoutMode,
  onShowError,
}) => {
  return (
    <>
      {/* Thanh Tìm kiếm trên cùng + Tùy chọn tải lên */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '0.55rem 0.9rem',
            flex: 1,
            maxWidth: '520px',
            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
          }}
        >
          <Search size={16} color="#94a3b8" />
          <input
            type="text"
            placeholder="Tìm kiếm tệp, thư mục, nội dung..."
            value={searchQuery}
            onChange={(e) => onChangeSearchQuery(e.target.value)}
            style={{
              border: 'none',
              outline: 'none',
              width: '100%',
              background: 'transparent',
              color: '#0f172a',
              fontSize: '0.85rem',
            }}
          />
          <span
            style={{
              fontSize: '0.7rem',
              padding: '2px 6px',
              borderRadius: '5px',
              background: '#f1f5f9',
              color: '#64748b',
              fontWeight: 600,
            }}
          >
            ⌘K
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            value={uploadModuleName}
            onChange={(e) => onChangeUploadModuleName(e.target.value)}
            style={{
              padding: '0.38rem 0.6rem',
              borderRadius: '9px',
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              color: '#334155',
              fontSize: '0.75rem',
            }}
            title="Chọn module nghiệp vụ để áp dụng giới hạn dung lượng theo module (Mục 6.3.2)"
          >
            {UPLOAD_MODULE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.74rem',
              color: '#475569',
              background: '#ffffff',
              padding: '0.38rem 0.6rem',
              borderRadius: '9px',
              border: '1px solid #e2e8f0',
              cursor: 'pointer',
            }}
            title="Đưa file vào khu vực chờ kiểm duyệt (PENDING_SCAN) trước khi công bố (Mục 6.3.3)"
          >
            <input
              type="checkbox"
              checked={uploadStageForScan}
              onChange={(e) => onChangeUploadStageForScan(e.target.checked)}
            />
            <span>Chờ duyệt (Staging)</span>
          </label>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.74rem',
              color: '#475569',
              background: '#ffffff',
              padding: '0.38rem 0.6rem',
              borderRadius: '9px',
              border: '1px solid #e2e8f0',
              cursor: 'pointer',
            }}
            title="Tự động Resize, tối ưu ảnh & tạo ảnh nhỏ Thumbnail khi tải lên (Mục 6.3.5 & 6.3.6)"
          >
            <input
              type="checkbox"
              checked={uploadOptimizeImage}
              onChange={(e) => onChangeUploadOptimizeAndThumb(e.target.checked)}
            />
            <span>Tối ưu ảnh & Thumbnail</span>
          </label>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.74rem',
              color: '#475569',
              background: '#ffffff',
              padding: '0.38rem 0.6rem',
              borderRadius: '9px',
              border: '1px solid #e2e8f0',
              cursor: 'pointer',
            }}
            title="Tùy chọn mã hóa AES-256-GCM khi tải lên"
          >
            <input
              type="checkbox"
              checked={uploadEncrypt}
              onChange={(e) => onChangeUploadEncrypt(e.target.checked)}
            />
            <span>Mã hóa AES-256</span>
          </label>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.55rem',
              background: '#ffffff',
              padding: '0.35rem 0.75rem',
              borderRadius: '999px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '999px',
                background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                color: '#ffffff',
                fontSize: '0.74rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              QT
            </div>
            <div style={{ fontSize: '0.76rem', lineHeight: 1.2 }}>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>Quản trị viên</div>
              <div style={{ color: '#64748b', fontSize: '0.68rem' }}>admin@core.local</div>
            </div>
          </div>
        </div>
      </div>

      {/* Thông báo kết quả chọn từ Popup FilePickerModal */}
      {pickedFromModal.length > 0 && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '12px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.83rem',
            color: '#1e40af',
          }}
        >
          <div>
            <strong>Đã chọn từ Popup &lt;FilePickerModal /&gt;:</strong>{' '}
            {pickedFromModal.map((f) => `${f.displayName} (${f.sizeFormatted})`).join(', ')}
          </div>
          <button
            type="button"
            onClick={onClearPickedFromModal}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#1e40af',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Breadcrumb + Tiêu đề Thư mục hiện tại */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.78rem',
            color: '#64748b',
            marginBottom: '0.55rem',
          }}
        >
          <Home size={14} />
          <ChevronRight size={13} />
          <span style={{ cursor: 'pointer' }} onClick={onResetRootFolder}>
            Tệp của tôi
          </span>
          <ChevronRight size={13} />
          <span style={{ color: '#0f172a', fontWeight: 700 }}>
            {viewMode === 'trash'
              ? 'Thùng rác (Chờ xóa vĩnh viễn)'
              : activeFolderObj
                ? activeFolderObj.name
                : 'Kho Tài Nguyên Dự Án'}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: '#dbeafe',
                color: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Folder size={24} fill="#3b82f6" color="#2563eb" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#0f172a' }}>
                {viewMode === 'trash'
                  ? 'Thùng rác hệ thống'
                  : activeFolderObj
                    ? activeFolderObj.name
                    : 'Website & Học liệu số'}
              </h1>
              <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                {foldersCount} thư mục • {totalFiles} tệp tin
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center' }}>
            {['NM', 'TT', 'LH'].map((initials, i) => (
              <div
                key={initials}
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '999px',
                  background: i === 0 ? '#2563eb' : i === 1 ? '#059669' : '#d97706',
                  color: '#ffffff',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid #f8fafc',
                  marginLeft: i === 0 ? 0 : '-8px',
                }}
              >
                {initials}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Thanh Công Cụ Hành Động (Tải lên, Tạo thư mục, Chọn đính kèm, Bộ lọc) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={uploading}
            onClick={onTriggerUploadClick}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '10px',
              border: 'none',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '0.83rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
            }}
          >
            <Upload size={15} />
            <span>
              {uploading
                ? uploadProgressText
                  ? `Đang tải lên ${uploadProgressText}`
                  : `Đang tải lên (${uploadProgressPercent}%)...`
                : 'Tải lên'}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenNewFolderInput}
            style={{
              padding: '0.55rem 0.9rem',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              color: '#334155',
              fontWeight: 600,
              fontSize: '0.82rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              cursor: 'pointer',
            }}
          >
            <FolderPlus size={15} />
            <span>Tạo thư mục</span>
          </button>

          <button
            type="button"
            onClick={onOpenPicker}
            style={{
              padding: '0.55rem 0.9rem',
              borderRadius: '10px',
              border: '1px solid #bfdbfe',
              background: '#eff6ff',
              color: '#2563eb',
              fontWeight: 600,
              fontSize: '0.82rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              cursor: 'pointer',
            }}
          >
            <Share2 size={15} />
            <span>Chọn tệp đính kèm (Popup)</span>
          </button>

          <button
            type="button"
            disabled={cleaningUnused}
            onClick={onCleanupUnusedFiles}
            style={{
              padding: '0.55rem 0.85rem',
              borderRadius: '10px',
              border: '1px solid #fde68a',
              background: '#fffbeb',
              color: '#b45309',
              fontWeight: 600,
              fontSize: '0.8rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              cursor: 'pointer',
            }}
            title={`Dọn các file không có liên kết sử dụng (usageCount = 0) quá ${stats?.settings.unusedRetentionDays ?? 30} ngày an toàn (Mục 6.3.7)`}
          >
            <Trash2 size={14} />
            <span>
              {cleaningUnused
                ? 'Đang dọn...'
                : `Dọn file không dùng (> ${stats?.settings.unusedRetentionDays ?? 30} ngày)`}
            </span>
          </button>

          {selectedFile && selectedFile.status === 1 && (
            <button
              type="button"
              onClick={() =>
                void filesApi
                  .downloadFileWithAuth(selectedFile)
                  .catch((err: unknown) =>
                    onShowError(err instanceof Error ? err.message : 'Lỗi tải xuống'),
                  )
              }
              style={{
                padding: '0.55rem 0.9rem',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                background: '#ffffff',
                color: '#334155',
                fontWeight: 600,
                fontSize: '0.82rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                cursor: 'pointer',
              }}
            >
              <Download size={15} />
              <span>Tải xuống</span>
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <select
            value={categoryFilter ?? ''}
            onChange={(e) =>
              onChangeCategoryFilter(e.target.value ? Number(e.target.value) : undefined)
            }
            style={{
              padding: '0.45rem 0.7rem',
              borderRadius: '9px',
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              color: '#334155',
              fontSize: '0.8rem',
              fontWeight: 500,
            }}
          >
            {FILE_CATEGORY_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => onChangeSortBy(e.target.value as 'newest' | 'name' | 'size')}
            style={{
              padding: '0.45rem 0.7rem',
              borderRadius: '9px',
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              color: '#334155',
              fontSize: '0.8rem',
              fontWeight: 500,
            }}
          >
            <option value="newest">Sắp xếp: Mới nhất</option>
            <option value="name">Sắp xếp: Tên A-Z</option>
            <option value="size">Sắp xếp: Kích thước</option>
          </select>

          <div
            style={{
              display: 'inline-flex',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '9px',
              padding: '2px',
            }}
          >
            <button
              type="button"
              onClick={() => onChangeLayoutMode('grid')}
              style={{
                padding: '0.32rem 0.45rem',
                borderRadius: '6px',
                border: 'none',
                background: layoutMode === 'grid' ? '#eff6ff' : 'transparent',
                color: layoutMode === 'grid' ? '#2563eb' : '#64748b',
                cursor: 'pointer',
                display: 'flex',
              }}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              type="button"
              onClick={() => onChangeLayoutMode('list')}
              style={{
                padding: '0.32rem 0.45rem',
                borderRadius: '6px',
                border: 'none',
                background: layoutMode === 'list' ? '#eff6ff' : 'transparent',
                color: layoutMode === 'list' ? '#2563eb' : '#64748b',
                cursor: 'pointer',
                display: 'flex',
              }}
            >
              <List size={15} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
