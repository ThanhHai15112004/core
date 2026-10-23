import React from 'react';
import { Folder, MoreHorizontal } from 'lucide-react';
import { FOLDER_CARD_PALETTE } from '../enum/files.enum';
import type { FileFolderItem } from '../types/files.types';

export interface FileFolderGridProps {
  readonly viewMode: 'active' | 'trash';
  readonly folders: readonly FileFolderItem[];
  readonly selectedFolderId: number | null;
  readonly editingFolder: FileFolderItem | null;
  readonly editFolderName: string;
  readonly editFolderParentId: number | null;
  readonly countFolderItems: (folderId: number) => number;
  readonly onSelectFolder: (folderId: number | null) => void;
  readonly onOpenEditFolder: (folder: FileFolderItem, e: React.MouseEvent) => void;
  readonly onChangeEditFolderName: (value: string) => void;
  readonly onChangeEditFolderParentId: (parentId: number | null) => void;
  readonly onUpdateFolder: (e: React.FormEvent) => void;
  readonly onDeleteFolder: (folder: FileFolderItem) => void;
  readonly onCloseEditFolder: () => void;
}

export const FileFolderGrid: React.FC<FileFolderGridProps> = ({
  viewMode,
  folders,
  selectedFolderId,
  editingFolder,
  editFolderName,
  editFolderParentId,
  countFolderItems,
  onSelectFolder,
  onOpenEditFolder,
  onChangeEditFolderName,
  onChangeEditFolderParentId,
  onUpdateFolder,
  onDeleteFolder,
  onCloseEditFolder,
}) => {
  if (viewMode !== 'active' || folders.length === 0) {
    return null;
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.65rem',
        }}
      >
        <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>Thư mục</span>
        {selectedFolderId !== null && (
          <button
            type="button"
            onClick={() => onSelectFolder(null)}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#2563eb',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Xem tất cả thư mục →
          </button>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))',
          gap: '0.85rem',
        }}
      >
        {folders.map((folder, idx) => {
          const palette =
            FOLDER_CARD_PALETTE[idx % FOLDER_CARD_PALETTE.length] ?? FOLDER_CARD_PALETTE[0]!;
          const isCurrent = selectedFolderId === folder.id;
          const count = countFolderItems(folder.id);
          return (
            <div
              key={folder.id}
              onClick={() => onSelectFolder(isCurrent ? null : folder.id)}
              style={{
                background: '#ffffff',
                borderRadius: '14px',
                padding: '0.9rem 1rem',
                border: isCurrent ? `2px solid ${palette.main}` : '1px solid #e2e8f0',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.55rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                }}
              >
                <div
                  style={{
                    width: '48px',
                    height: '38px',
                    borderRadius: '10px',
                    background: palette.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Folder size={28} fill={palette.main} color={palette.main} />
                </div>
                <button
                  type="button"
                  onClick={(e) => onOpenEditFolder(folder, e)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#64748b',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                  }}
                  title="Đổi tên, di chuyển hoặc xóa thư mục"
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>

              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    color: '#0f172a',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={folder.name}
                >
                  {folder.name}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.15rem' }}>
                  {count} mục • {folder.folderPath}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editingFolder && (
        <form
          onSubmit={onUpdateFolder}
          style={{
            marginTop: '0.75rem',
            padding: '0.85rem 1rem',
            borderRadius: '12px',
            background: '#ffffff',
            border: '1px solid #bfdbfe',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.6rem',
          }}
        >
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e40af' }}>
            Chỉnh sửa thư mục #{editingFolder.id}:
          </span>
          <input
            type="text"
            value={editFolderName}
            onChange={(e) => onChangeEditFolderName(e.target.value)}
            placeholder="Tên thư mục"
            style={{
              padding: '0.38rem 0.6rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.8rem',
              minWidth: '180px',
            }}
          />
          <select
            value={editFolderParentId ?? ''}
            onChange={(e) =>
              onChangeEditFolderParentId(e.target.value ? Number(e.target.value) : null)
            }
            style={{
              padding: '0.38rem 0.6rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.8rem',
            }}
          >
            <option value="">Thư mục gốc (Root)</option>
            {folders
              .filter((f) => f.id !== editingFolder.id)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  Cha: {f.name} ({f.folderPath})
                </option>
              ))}
          </select>
          <button
            type="submit"
            style={{
              padding: '0.38rem 0.75rem',
              borderRadius: '8px',
              border: 'none',
              background: '#2563eb',
              color: '#ffffff',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Lưu & Cập nhật đường dẫn
          </button>
          <button
            type="button"
            onClick={() => onDeleteFolder(editingFolder)}
            style={{
              padding: '0.38rem 0.7rem',
              borderRadius: '8px',
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#dc2626',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Xóa thư mục trống
          </button>
          <button
            type="button"
            onClick={onCloseEditFolder}
            style={{
              padding: '0.38rem 0.6rem',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              color: '#475569',
              fontSize: '0.78rem',
              cursor: 'pointer',
            }}
          >
            Đóng
          </button>
        </form>
      )}
    </div>
  );
};
