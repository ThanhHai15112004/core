import React from 'react';
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { renderFileTypeIconBox } from '../helpers/file-ui.helper';
import { filesApi } from '../services/files.api';
import type { FileRecordItem } from '../types/files.types';

export interface FileRecordTableProps {
  readonly files: readonly FileRecordItem[];
  readonly selectedFileId: number | null;
  readonly loading: boolean;
  readonly viewMode: 'active' | 'trash';
  readonly page: number;
  readonly totalPages: number;
  readonly onSelectFileDetail: (fileId: number) => void;
  readonly onMoveToTrash: (file: FileRecordItem) => void;
  readonly onRestoreFromTrash: (file: FileRecordItem) => void;
  readonly onPurgeFile: (file: FileRecordItem) => void;
  readonly onPurgeExpiredTrash: () => void;
  readonly onChangePage: (nextPage: number) => void;
  readonly onShowError: (message: string) => void;
}

export const FileRecordTable: React.FC<FileRecordTableProps> = ({
  files,
  selectedFileId,
  loading,
  viewMode,
  page,
  totalPages,
  onSelectFileDetail,
  onMoveToTrash,
  onRestoreFromTrash,
  onPurgeFile,
  onPurgeExpiredTrash,
  onChangePage,
  onShowError,
}) => {
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
        <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>
          Tệp ({files.length})
        </span>
        {viewMode === 'trash' && (
          <button
            type="button"
            onClick={onPurgeExpiredTrash}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#dc2626',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Dọn các file hết hạn chờ
          </button>
        )}
      </div>

      <div
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)',
        }}
      >
        {loading ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
            Đang tải danh sách tệp...
          </div>
        ) : files.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
            Chưa có tệp nào trong danh mục này. Nhấn nút <strong>Tải lên</strong> để thêm tệp mới.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid #f1f5f9',
                  color: '#64748b',
                  fontSize: '0.76rem',
                  textAlign: 'left',
                }}
              >
                <th style={{ padding: '0.7rem 0.85rem', width: '32px' }}>
                  <input type="checkbox" readOnly checked={false} />
                </th>
                <th style={{ padding: '0.7rem 0.5rem' }}>Tên</th>
                <th style={{ padding: '0.7rem 0.5rem' }}>Chủ sở hữu</th>
                <th style={{ padding: '0.7rem 0.5rem' }}>Cập nhật gần nhất ↓</th>
                <th style={{ padding: '0.7rem 0.5rem' }}>Kích thước</th>
                <th style={{ padding: '0.7rem 0.85rem', textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {files.map((item) => {
                const isSelected = selectedFileId === item.id;
                const ownerName =
                  item.uploadedByUser?.fullName ??
                  item.uploadedByUser?.username ??
                  'Nguyễn Văn Minh';
                return (
                  <tr
                    key={item.id}
                    onClick={() => onSelectFileDetail(item.id)}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      background: isSelected ? '#eff6ff' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'background 0.12s ease',
                    }}
                  >
                    <td style={{ padding: '0.68rem 0.85rem' }}>
                      <input type="checkbox" readOnly checked={isSelected} />
                    </td>
                    <td style={{ padding: '0.68rem 0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        {renderFileTypeIconBox(item, 'sm')}
                        <div>
                          <div
                            style={{
                              fontWeight: 700,
                              color: '#0f172a',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.45rem',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span>{item.displayName}</span>
                            {item.status === 4 && (
                              <span
                                style={{
                                  padding: '2px 7px',
                                  borderRadius: '999px',
                                  background: '#fef2f2',
                                  border: '1px solid #fecaca',
                                  color: '#dc2626',
                                  fontSize: '0.67rem',
                                  fontWeight: 700,
                                }}
                              >
                                ⚠️ Mất file vật lý
                              </span>
                            )}
                            {item.status === 5 && (
                              <span
                                style={{
                                  padding: '2px 7px',
                                  borderRadius: '999px',
                                  background: '#fffbeb',
                                  border: '1px solid #fde68a',
                                  color: '#b45309',
                                  fontSize: '0.67rem',
                                  fontWeight: 700,
                                }}
                              >
                                ⏳ Chờ kiểm duyệt
                              </span>
                            )}
                            {item.status === 6 && (
                              <span
                                style={{
                                  padding: '2px 7px',
                                  borderRadius: '999px',
                                  background: '#fef2f2',
                                  border: '1px solid #fca5a5',
                                  color: '#b91c1c',
                                  fontSize: '0.67rem',
                                  fontWeight: 700,
                                }}
                              >
                                🛡️ Đã cách ly ({item.threatName ?? 'Mã độc'})
                              </span>
                            )}
                            {item.duplicateOfFileId && (
                              <span
                                style={{
                                  padding: '2px 7px',
                                  borderRadius: '999px',
                                  background: '#f3e8ff',
                                  border: '1px solid #d8b4fe',
                                  color: '#7c3aed',
                                  fontSize: '0.67rem',
                                  fontWeight: 700,
                                }}
                              >
                                Bản trùng #{item.duplicateOfFileId}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.71rem', color: '#64748b' }}>
                            {item.code} • {item.folderName ?? 'Thư mục gốc'}
                            {item.usageCount > 0 ? ` • 🔒 ${item.usageCount} liên kết` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '0.68rem 0.5rem' }}>
                      <div
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
                      >
                        <div
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '999px',
                            background: '#dbeafe',
                            color: '#1d4ed8',
                            fontSize: '0.66rem',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {ownerName.slice(0, 2).toUpperCase()}
                        </div>
                        <span style={{ color: '#334155', fontWeight: 500 }}>{ownerName}</span>
                      </div>
                    </td>
                    <td style={{ padding: '0.68rem 0.5rem', color: '#64748b' }}>
                      {new Date(item.updatedAt).toLocaleString('vi-VN')}
                    </td>
                    <td style={{ padding: '0.68rem 0.5rem', color: '#334155', fontWeight: 600 }}>
                      {item.sizeFormatted}
                    </td>
                    <td
                      style={{ padding: '0.68rem 0.85rem', textAlign: 'right' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                        {item.status === 1 ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                void filesApi
                                  .downloadFileWithAuth(item)
                                  .catch((err: unknown) =>
                                    onShowError(
                                      err instanceof Error ? err.message : 'Lỗi tải file',
                                    ),
                                  )
                              }
                              style={{
                                padding: '0.32rem 0.5rem',
                                borderRadius: '7px',
                                border: '1px solid #e2e8f0',
                                background: '#ffffff',
                                color: '#475569',
                                cursor: 'pointer',
                              }}
                              title="Tải xuống"
                            >
                              <Download size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => onMoveToTrash(item)}
                              style={{
                                padding: '0.32rem 0.5rem',
                                borderRadius: '7px',
                                border: '1px solid #e2e8f0',
                                background: '#ffffff',
                                color: item.usageCount > 0 ? '#94a3b8' : '#dc2626',
                                cursor: 'pointer',
                              }}
                              title={
                                item.usageCount > 0
                                  ? 'Đang có liên kết dữ liệu — bấm để kiểm tra chặn xóa'
                                  : 'Đưa vào thùng rác'
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onRestoreFromTrash(item)}
                              style={{
                                padding: '0.32rem 0.55rem',
                                borderRadius: '7px',
                                border: '1px solid #bfdbfe',
                                background: '#eff6ff',
                                color: '#2563eb',
                                cursor: 'pointer',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                              }}
                            >
                              <RotateCcw size={13} />
                              <span>Khôi phục</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onPurgeFile(item)}
                              style={{
                                padding: '0.32rem 0.55rem',
                                borderRadius: '7px',
                                border: '1px solid #fecaca',
                                background: '#fef2f2',
                                color: '#dc2626',
                                cursor: 'pointer',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                              }}
                            >
                              Xóa hẳn
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.5rem',
            marginTop: '0.75rem',
          }}
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onChangePage(Math.max(1, page - 1))}
            style={{
              padding: '0.38rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              cursor: 'pointer',
            }}
          >
            Trước
          </button>
          <span style={{ alignSelf: 'center', fontSize: '0.8rem', color: '#475569' }}>
            Trang {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onChangePage(Math.min(totalPages, page + 1))}
            style={{
              padding: '0.38rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              cursor: 'pointer',
            }}
          >
            Sau
          </button>
        </div>
      )}
    </div>
  );
};
