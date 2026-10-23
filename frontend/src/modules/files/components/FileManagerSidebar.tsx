import React from 'react';
import {
  AlertCircle,
  Clock,
  Cloud,
  Folder,
  Home,
  Link2,
  Plus,
  Share2,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { FOLDER_CARD_PALETTE, type FileManagerNavSection } from '../enum/files.enum';
import type { FileFolderItem, FileStatsItem } from '../types/files.types';

export interface FileManagerSidebarProps {
  readonly navSection: FileManagerNavSection;
  readonly selectedFolderId: number | null;
  readonly viewMode: 'active' | 'trash';
  readonly folders: readonly FileFolderItem[];
  readonly totalFiles: number;
  readonly stats: FileStatsItem | null;
  readonly showNewFolderInput: boolean;
  readonly newFolderName: string;
  readonly creatingFolder: boolean;
  readonly onSelectNavSection: (section: FileManagerNavSection) => void;
  readonly onSelectFolder: (folderId: number) => void;
  readonly onToggleNewFolderInput: () => void;
  readonly onChangeNewFolderName: (value: string) => void;
  readonly onCreateFolder: (e: React.FormEvent) => void;
  readonly countFolderItems: (folderId: number) => number;
  readonly onOpenPicker: () => void;
}

const SIDEBAR_NAV_ITEMS: ReadonlyArray<{
  readonly id: FileManagerNavSection;
  readonly label: string;
  readonly icon: React.ReactNode;
}> = [
  { id: 'overview', label: 'Tổng quan', icon: <Home size={16} /> },
  { id: 'my_files', label: 'Tệp của tôi', icon: <Folder size={16} /> },
  { id: 'recent', label: 'Gần đây', icon: <Clock size={16} /> },
  { id: 'shared', label: 'Đã chia sẻ / Liên kết', icon: <Share2 size={16} /> },
  { id: 'starred', label: 'Yêu thích', icon: <Star size={16} /> },
  { id: 'pending_scan', label: 'Chờ kiểm duyệt (Staging)', icon: <Clock size={16} /> },
  { id: 'quarantined', label: 'Cách ly mã độc', icon: <AlertCircle size={16} /> },
  { id: 'missing', label: 'Mất file vật lý', icon: <AlertCircle size={16} /> },
  { id: 'trash', label: 'Thùng rác', icon: <Trash2 size={16} /> },
];

export const FileManagerSidebar: React.FC<FileManagerSidebarProps> = ({
  navSection,
  selectedFolderId,
  viewMode,
  folders,
  totalFiles,
  stats,
  showNewFolderInput,
  newFolderName,
  creatingFolder,
  onSelectNavSection,
  onSelectFolder,
  onToggleNewFolderInput,
  onChangeNewFolderName,
  onCreateFolder,
  countFolderItems,
  onOpenPicker,
}) => {
  const quotaMb = stats?.settings.storageQuotaMb ?? 51200;
  const quotaBytes = quotaMb > 0 ? quotaMb * 1024 * 1024 : 0;
  const usedBytes = stats?.totalActiveBytes ?? 0;
  const percent =
    quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 25;
  const usedLabel = stats ? stats.totalActiveFormatted : '12.6 GB';
  const quotaLabel =
    quotaMb >= 1024 ? `${(quotaMb / 1024).toFixed(0)} GB` : `${quotaMb} MB`;
  const userQuotaMb = stats?.settings.userStorageQuotaMb ?? 0;

  return (
    <aside
      style={{
        background: '#ffffff',
        borderRight: '1px solid #e2e8f0',
        padding: '1.25rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div>
        {/* Logo CloudBox */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            padding: '0 0.4rem 1.15rem',
          }}
        >
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 10px rgba(37, 99, 235, 0.28)',
            }}
          >
            <Cloud size={19} />
          </div>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
              CloudBox
            </div>
            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
              Shared Media & Storage
            </div>
          </div>
        </div>

        {/* Menu điều hướng chính */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {SIDEBAR_NAV_ITEMS.map((nav) => {
            const active = navSection === nav.id && selectedFolderId === null;
            return (
              <button
                key={nav.id}
                type="button"
                onClick={() => onSelectNavSection(nav.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: active ? '#eff6ff' : 'transparent',
                  color: active ? '#2563eb' : '#475569',
                  fontWeight: active ? 700 : 500,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {nav.icon}
                <span>{nav.label}</span>
              </button>
            );
          })}
        </div>

        {/* Danh sách Thư mục ảo */}
        <div
          style={{
            marginTop: '1.25rem',
            paddingTop: '1rem',
            borderTop: '1px solid #f1f5f9',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 0.5rem',
              marginBottom: '0.5rem',
              fontSize: '0.76rem',
              fontWeight: 700,
              color: '#64748b',
            }}
          >
            <span>Thư mục</span>
            <button
              type="button"
              onClick={onToggleNewFolderInput}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#475569',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
              }}
              title="Tạo thư mục mới"
            >
              <Plus size={15} />
            </button>
          </div>

          {showNewFolderInput && (
            <form
              onSubmit={onCreateFolder}
              style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.55rem' }}
            >
              <input
                type="text"
                placeholder="Tên thư mục mới..."
                value={newFolderName}
                onChange={(e) => onChangeNewFolderName(e.target.value)}
                style={{
                  flex: 1,
                  padding: '0.38rem 0.55rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.78rem',
                  color: '#0f172a',
                }}
              />
              <button
                type="submit"
                disabled={creatingFolder}
                style={{
                  padding: '0.38rem 0.6rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Tạo
              </button>
            </form>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {folders.map((folder, index) => {
              const palette =
                FOLDER_CARD_PALETTE[index % FOLDER_CARD_PALETTE.length] ??
                FOLDER_CARD_PALETTE[0]!;
              const active = selectedFolderId === folder.id && viewMode === 'active';
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => onSelectFolder(folder.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '0.48rem 0.65rem',
                    borderRadius: '9px',
                    border: 'none',
                    background: active ? '#eff6ff' : 'transparent',
                    color: active ? '#2563eb' : '#334155',
                    fontWeight: active ? 600 : 500,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.55rem',
                      overflow: 'hidden',
                    }}
                  >
                    <Folder
                      size={16}
                      fill={palette.main}
                      color={palette.main}
                      style={{ flexShrink: 0 }}
                    />
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {folder.name}
                    </span>
                  </span>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>
                    {countFolderItems(folder.id)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Khối Dung lượng lưu trữ & Hoạt động gần đây ở đáy Sidebar trái */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
        <div
          style={{
            padding: '0.9rem',
            borderRadius: '14px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a' }}>
            Dung lượng lưu trữ
          </div>
          <div
            style={{
              width: '100%',
              height: '6px',
              borderRadius: '999px',
              background: '#e2e8f0',
              margin: '0.55rem 0',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.max(4, percent)}%`,
                height: '100%',
                borderRadius: '999px',
                background: 'linear-gradient(90deg, #2563eb, #38bdf8)',
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.73rem',
              color: '#64748b',
              marginBottom: userQuotaMb > 0 ? '0.25rem' : '0.65rem',
            }}
          >
            <span>
              <strong style={{ color: '#2563eb' }}>{usedLabel}</strong> /{' '}
              {quotaMb > 0 ? quotaLabel : 'Không giới hạn'}
            </span>
            <span>{quotaMb > 0 ? `${percent}%` : '∞'}</span>
          </div>
          {userQuotaMb > 0 && (
            <div
              style={{
                fontSize: '0.69rem',
                color: '#475569',
                marginBottom: '0.55rem',
              }}
            >
              Cá nhân: <strong>{stats?.currentUserActiveFormatted ?? '0 B'}</strong> /{' '}
              {userQuotaMb} MB
            </div>
          )}
          <button
            type="button"
            onClick={onOpenPicker}
            style={{
              width: '100%',
              padding: '0.48rem 0.65rem',
              borderRadius: '9px',
              border: '1px solid #bfdbfe',
              background: '#eff6ff',
              color: '#2563eb',
              fontSize: '0.76rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              cursor: 'pointer',
            }}
          >
            <Sparkles size={14} />
            <span>Mở Popup Chọn File</span>
          </button>
        </div>

        {/* Hoạt động gần đây */}
        <div>
          <div
            style={{
              fontSize: '0.76rem',
              fontWeight: 700,
              color: '#0f172a',
              marginBottom: '0.55rem',
              padding: '0 0.25rem',
            }}
          >
            Hoạt động gần đây
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
              <div
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '999px',
                  background: '#eff6ff',
                  color: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Upload size={13} />
              </div>
              <div style={{ fontSize: '0.72rem', lineHeight: 1.3 }}>
                <div style={{ fontWeight: 600, color: '#1e293b' }}>
                  Đã đồng bộ {totalFiles} tệp
                </div>
                <div style={{ color: '#94a3b8' }}>Vừa xong</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
              <div
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '999px',
                  background: '#fef3c7',
                  color: '#d97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Link2 size={13} />
              </div>
              <div style={{ fontSize: '0.72rem', lineHeight: 1.3 }}>
                <div style={{ fontWeight: 600, color: '#1e293b' }}>
                  4 liên kết bảo vệ chống xóa
                </div>
                <div style={{ color: '#94a3b8' }}>Đang hoạt động</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
