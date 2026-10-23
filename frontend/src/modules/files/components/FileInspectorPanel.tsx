import React from 'react';
import { Download, Edit3, Eye, Globe, Lock, Unlink, X } from 'lucide-react';
import { renderFileTypeIconBox } from '../helpers/file-ui.helper';
import { filesApi } from '../services/files.api';
import type {
  FileFolderItem,
  FileIntegrityVerificationItem,
  FileRecordItem,
  FileStatsItem,
} from '../types/files.types';

export interface FileInspectorPanelProps {
  readonly selectedFile: FileRecordItem | null;
  readonly folders: readonly FileFolderItem[];
  readonly stats: FileStatsItem | null;
  readonly showRenameBox: boolean;
  readonly renameValue: string;
  readonly moveFolderValue: number | null;
  readonly verifyingIntegrity: boolean;
  readonly integrityResult: FileIntegrityVerificationItem | null;
  readonly showAddUsageForm: boolean;
  readonly usageModule: string;
  readonly usageEntityType: string;
  readonly usageEntityId: string;
  readonly usageNote: string;
  readonly showAddPermissionForm: boolean;
  readonly permSubjectType: 'USER' | 'ROLE' | 'ORG_UNIT';
  readonly permSubjectId: string;
  readonly permCanDownload: boolean;
  readonly tempLinkUrl: string | null;
  readonly tempLinkExpiresAt: string | null;
  readonly onCloseInspector: () => void;
  readonly onToggleRenameBox: () => void;
  readonly onChangeRenameValue: (value: string) => void;
  readonly onChangeMoveFolderValue: (folderId: number | null) => void;
  readonly onSubmitRenameOrMove: (e: React.FormEvent) => void;
  readonly onVerifyIntegrity: (fileId: number) => void;
  readonly onPublishStagedFile: (fileId: number) => void;
  readonly onQuarantineFile: (fileId: number) => void;
  readonly onToggleAddUsageForm: () => void;
  readonly onChangeUsageModule: (value: string) => void;
  readonly onChangeUsageEntityType: (value: string) => void;
  readonly onChangeUsageEntityId: (value: string) => void;
  readonly onChangeUsageNote: (value: string) => void;
  readonly onSubmitAttachUsage: (e: React.FormEvent) => void;
  readonly onDetachUsage: (
    fileId: number,
    usageId: number,
    moduleName: string,
    entityType: string,
    entityId: string,
  ) => void;
  readonly onCreateTempDownloadLink: (fileId: number) => void;
  readonly onToggleAddPermissionForm: () => void;
  readonly onChangePermSubjectType: (type: 'USER' | 'ROLE' | 'ORG_UNIT') => void;
  readonly onChangePermSubjectId: (value: string) => void;
  readonly onChangePermCanDownload: (checked: boolean) => void;
  readonly onSubmitGrantPermission: (e: React.FormEvent) => void;
  readonly onRevokePermission: (fileId: number, permissionId: number) => void;
  readonly onShowError: (message: string) => void;
}

export const FileInspectorPanel: React.FC<FileInspectorPanelProps> = ({
  selectedFile,
  folders,
  stats,
  showRenameBox,
  renameValue,
  moveFolderValue,
  verifyingIntegrity,
  integrityResult,
  showAddUsageForm,
  usageModule,
  usageEntityType,
  usageEntityId,
  usageNote,
  showAddPermissionForm,
  permSubjectType,
  permSubjectId,
  permCanDownload,
  tempLinkUrl,
  tempLinkExpiresAt,
  onCloseInspector,
  onToggleRenameBox,
  onChangeRenameValue,
  onChangeMoveFolderValue,
  onSubmitRenameOrMove,
  onVerifyIntegrity,
  onPublishStagedFile,
  onQuarantineFile,
  onToggleAddUsageForm,
  onChangeUsageModule,
  onChangeUsageEntityType,
  onChangeUsageEntityId,
  onChangeUsageNote,
  onSubmitAttachUsage,
  onDetachUsage,
  onCreateTempDownloadLink,
  onToggleAddPermissionForm,
  onChangePermSubjectType,
  onChangePermSubjectId,
  onChangePermCanDownload,
  onSubmitGrantPermission,
  onRevokePermission,
  onShowError,
}) => {
  return (
    <aside
      style={{
        background: '#ffffff',
        borderLeft: '1px solid #e2e8f0',
        padding: '1.25rem 1.15rem',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.1rem',
      }}
    >
      {!selectedFile ? (
        <div
          style={{
            padding: '3rem 1rem',
            textAlign: 'center',
            color: '#64748b',
            fontSize: '0.85rem',
          }}
        >
          Chọn một tệp ở danh sách giữa để xem trước nội dung, đổi tên (bất biến đường dẫn lưu trữ)
          và kiểm tra liên kết sử dụng.
        </div>
      ) : (
        <>
          {/* Header File đang chọn */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '0.6rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                overflow: 'hidden',
              }}
            >
              {renderFileTypeIconBox(selectedFile, 'md')}
              <div style={{ overflow: 'hidden' }}>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: '0.96rem',
                    color: '#0f172a',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={selectedFile.displayName}
                >
                  {selectedFile.displayName}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {selectedFile.categoryName} • {selectedFile.sizeFormatted}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onCloseInspector}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '2px',
              }}
            >
              <X size={17} />
            </button>
          </div>

          {/* Hộp Preview trực quan */}
          {selectedFile.status === 1 && selectedFile.category === 2 ? (
            <div
              style={{
                borderRadius: '14px',
                overflow: 'hidden',
                background: '#0f172a',
                border: '1px solid #cbd5e1',
              }}
            >
              <video
                controls
                preload="metadata"
                src={filesApi.getStreamUrl(selectedFile.id)}
                style={{ width: '100%', maxHeight: '185px', display: 'block' }}
              />
              <div
                style={{
                  padding: '0.4rem 0.7rem',
                  fontSize: '0.7rem',
                  color: '#bae6fd',
                  background: '#020617',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>🎬 Phát & Tua trực tiếp (HTTP 206 Partial Content)</span>
                <span>Byte-Range</span>
              </div>
            </div>
          ) : selectedFile.category === 1 && selectedFile.thumbnailUrl ? (
            <div
              style={{
                borderRadius: '14px',
                overflow: 'hidden',
                background: '#f8fafc',
                border: '1px solid #bfdbfe',
              }}
            >
              <div
                style={{
                  height: '145px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#eff6ff',
                  padding: '0.5rem',
                }}
              >
                <img
                  src={filesApi.getThumbnailUrl(selectedFile.id)}
                  alt={selectedFile.displayName}
                  style={{
                    maxHeight: '130px',
                    maxWidth: '100%',
                    objectFit: 'contain',
                    borderRadius: '8px',
                  }}
                />
              </div>
              <div
                style={{
                  padding: '0.4rem 0.7rem',
                  fontSize: '0.7rem',
                  color: '#1e40af',
                  background: '#dbeafe',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>🖼️ Thumbnail hiển thị nhanh (Mục 6.3.5)</span>
                <span>
                  {selectedFile.imageDimensions
                    ? `${selectedFile.imageDimensions.width}×${selectedFile.imageDimensions.height}px`
                    : 'Optimized'}
                </span>
              </div>
            </div>
          ) : (
            <div
              style={{
                height: '165px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #dbeafe 0%, #eff6ff 45%, #e0e7ff 100%)',
                border: '1px solid #bfdbfe',
                padding: '1.1rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: '999px',
                    background: '#ffffff',
                    color: '#2563eb',
                  }}
                >
                  {selectedFile.code}
                </span>
                <div
                  style={{
                    fontSize: '1.02rem',
                    fontWeight: 800,
                    color: '#0f172a',
                    marginTop: '0.55rem',
                    lineHeight: 1.3,
                  }}
                >
                  Kết nối ý tưởng
                  <br />
                  Kiến tạo tương lai
                </div>
                <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '0.25rem' }}>
                  {selectedFile.originalName}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: '999px',
                    background: '#2563eb',
                    color: '#ffffff',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                  }}
                >
                  Magic Bytes Verified
                </span>
              </div>
            </div>
          )}

          {selectedFile.status === 4 && (
            <div
              style={{
                padding: '0.65rem 0.8rem',
                borderRadius: '10px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                fontSize: '0.76rem',
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              ⚠️ File vật lý trên đĩa không còn tồn tại ({selectedFile.storageKey}). Hệ thống đã tự
              động đánh dấu trạng thái <strong>MISSING (Mất file vật lý)</strong> trong Database.
            </div>
          )}

          {/* Hàng Nút Thao Tác Nhanh: Mở | Tải xuống | Đổi tên */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem' }}>
            <a
              href={filesApi.getStreamUrl(selectedFile.id)}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '0.5rem 0.65rem',
                borderRadius: '9px',
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                color: '#2563eb',
                fontWeight: 600,
                fontSize: '0.8rem',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
              }}
            >
              <Eye size={14} />
              <span>Mở</span>
            </a>

            <button
              type="button"
              onClick={() =>
                void filesApi
                  .downloadFileWithAuth(selectedFile)
                  .catch((err: unknown) =>
                    onShowError(err instanceof Error ? err.message : 'Lỗi tải file'),
                  )
              }
              style={{
                padding: '0.5rem 0.65rem',
                borderRadius: '9px',
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                color: '#0f172a',
                fontWeight: 600,
                fontSize: '0.8rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
              }}
            >
              <Download size={14} />
              <span>Tải xuống</span>
            </button>

            <button
              type="button"
              onClick={onToggleRenameBox}
              style={{
                padding: '0.5rem 0.65rem',
                borderRadius: '9px',
                border: '1px solid #e2e8f0',
                background: showRenameBox ? '#eff6ff' : '#f8fafc',
                color: '#334155',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
              }}
              title="Đổi tên hiển thị & Di chuyển thư mục (Không đổi Storage Key gốc)"
            >
              <Edit3 size={14} />
            </button>
          </div>

          {/* Hộp Đổi tên & Chuyển thư mục ảo (Mục 6.1.4) */}
          {showRenameBox && (
            <form
              onSubmit={onSubmitRenameOrMove}
              style={{
                padding: '0.75rem',
                borderRadius: '12px',
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#0f172a' }}>
                Đổi tên hiển thị (Giữ nguyên Storage Key vật lý)
              </div>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => onChangeRenameValue(e.target.value)}
                style={{
                  padding: '0.4rem 0.6rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.8rem',
                }}
              />
              <select
                value={moveFolderValue ?? ''}
                onChange={(e) =>
                  onChangeMoveFolderValue(e.target.value ? Number(e.target.value) : null)
                }
                style={{
                  padding: '0.4rem 0.6rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.8rem',
                }}
              >
                <option value="">Thư mục gốc (Root)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                style={{
                  padding: '0.45rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                }}
              >
                Lưu thay đổi
              </button>
            </form>
          )}

          {/* Thông tin chi tiết (Mục 6.1.2) */}
          <div>
            <div
              style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                color: '#0f172a',
                marginBottom: '0.65rem',
              }}
            >
              Thông tin chi tiết
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '98px 1fr',
                rowGap: '0.55rem',
                columnGap: '0.5rem',
                fontSize: '0.78rem',
              }}
            >
              <span style={{ color: '#64748b' }}>Tên tệp</span>
              <strong style={{ color: '#0f172a', wordBreak: 'break-word' }}>
                {selectedFile.displayName}
              </strong>

              <span style={{ color: '#64748b' }}>Loại tệp</span>
              <span style={{ color: '#0f172a', fontWeight: 500 }}>
                {selectedFile.categoryName} ({selectedFile.extension.toUpperCase()})
              </span>

              <span style={{ color: '#64748b' }}>Kích thước</span>
              <span style={{ color: '#0f172a' }}>
                {selectedFile.sizeFormatted} ({selectedFile.sizeBytes.toLocaleString()} bytes)
              </span>

              <span style={{ color: '#64748b' }}>Vị trí</span>
              <span style={{ color: '#2563eb', fontWeight: 600 }}>
                Tệp của tôi / {selectedFile.folderName ?? 'Kho chung'}
              </span>

              <span style={{ color: '#64748b' }}>Storage Key</span>
              <code
                style={{
                  fontSize: '0.7rem',
                  color: '#0284c7',
                  background: '#f0f9ff',
                  padding: '2px 5px',
                  borderRadius: '5px',
                  wordBreak: 'break-all',
                }}
              >
                {selectedFile.storageKey}
              </code>

              <span style={{ color: '#64748b' }}>Chủ sở hữu</span>
              <span style={{ color: '#0f172a', fontWeight: 600 }}>
                {selectedFile.uploadedByUser?.fullName ?? 'Nguyễn Văn Minh'}
              </span>

              <span style={{ color: '#64748b' }}>Đã sửa đổi</span>
              <span style={{ color: '#334155' }}>
                {new Date(selectedFile.updatedAt).toLocaleString('vi-VN')}
              </span>

              <span style={{ color: '#64748b' }}>Đã tạo</span>
              <span style={{ color: '#334155' }}>
                {new Date(selectedFile.createdAt).toLocaleString('vi-VN')}
              </span>

              <span style={{ color: '#64748b' }}>SHA-256</span>
              <code
                style={{
                  fontSize: '0.67rem',
                  color: '#334155',
                  background: '#f1f5f9',
                  padding: '2px 5px',
                  borderRadius: '5px',
                  wordBreak: 'break-all',
                }}
              >
                {selectedFile.checksumSha256}
              </code>

              {selectedFile.imageDimensions && (
                <>
                  <span style={{ color: '#64748b' }}>Kích thước ảnh</span>
                  <span style={{ color: '#0f172a', fontWeight: 600 }}>
                    {selectedFile.imageDimensions.width} × {selectedFile.imageDimensions.height} px
                    {selectedFile.optimizedSavedBytes
                      ? ` (Tiết kiệm ${selectedFile.optimizedSavedBytes.toLocaleString()} B)`
                      : ''}
                  </span>
                </>
              )}

              {selectedFile.moduleName && (
                <>
                  <span style={{ color: '#64748b' }}>Module</span>
                  <span style={{ color: '#2563eb', fontWeight: 600 }}>
                    {selectedFile.moduleName}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Kiểm tra mã độc, Khu vực chờ & Toàn vẹn Checksum (Mục 6.3) */}
          <div
            style={{
              paddingTop: '0.85rem',
              borderTop: '1px solid #f1f5f9',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.5rem',
              }}
            >
              <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>
                Kiểm tra & Xử lý file (Mục 6.3)
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '0.69rem',
                  fontWeight: 700,
                  background:
                    selectedFile.scanStatus === 'INFECTED' || selectedFile.status === 6
                      ? '#fef2f2'
                      : selectedFile.scanStatus === 'PENDING' || selectedFile.status === 5
                        ? '#fffbeb'
                        : '#ecfdf5',
                  color:
                    selectedFile.scanStatus === 'INFECTED' || selectedFile.status === 6
                      ? '#dc2626'
                      : selectedFile.scanStatus === 'PENDING' || selectedFile.status === 5
                        ? '#b45309'
                        : '#059669',
                }}
              >
                {selectedFile.scanStatus === 'INFECTED' || selectedFile.status === 6
                  ? `☣️ Nhiễm mã độc (${selectedFile.threatName ?? 'Quarantined'})`
                  : selectedFile.scanStatus === 'PENDING' || selectedFile.status === 5
                    ? '⏳ Đang ở khu vực chờ (Staging)'
                    : '🛡️ Quét mã độc: Sạch (CLEAN)'}
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              <button
                type="button"
                disabled={verifyingIntegrity}
                onClick={() => onVerifyIntegrity(selectedFile.id)}
                style={{
                  padding: '0.36rem 0.65rem',
                  borderRadius: '8px',
                  border: '1px solid #bfdbfe',
                  background: '#eff6ff',
                  color: '#1d4ed8',
                  fontSize: '0.73rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {verifyingIntegrity ? 'Đang đối chiếu...' : '🔍 Kiểm tra toàn vẹn SHA-256'}
              </button>

              {selectedFile.status === 5 && (
                <button
                  type="button"
                  onClick={() => onPublishStagedFile(selectedFile.id)}
                  style={{
                    padding: '0.36rem 0.65rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#059669',
                    color: '#ffffff',
                    fontSize: '0.73rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ✓ Duyệt & Công bố file
                </button>
              )}

              {selectedFile.status !== 6 && (
                <button
                  type="button"
                  onClick={() => onQuarantineFile(selectedFile.id)}
                  style={{
                    padding: '0.36rem 0.65rem',
                    borderRadius: '8px',
                    border: '1px solid #fecaca',
                    background: '#fef2f2',
                    color: '#dc2626',
                    fontSize: '0.73rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🛡️ Cách ly file
                </button>
              )}
            </div>

            {integrityResult && integrityResult.fileId === selectedFile.id && (
              <div
                style={{
                  marginTop: '0.5rem',
                  padding: '0.5rem 0.65rem',
                  borderRadius: '8px',
                  background: integrityResult.intact ? '#f0fdf4' : '#fef2f2',
                  border: integrityResult.intact ? '1px solid #bbf7d0' : '1px solid #fecaca',
                  fontSize: '0.72rem',
                  color: integrityResult.intact ? '#166534' : '#991b1b',
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {integrityResult.intact
                    ? '✓ File vật lý nguyên vẹn 100% khớp Checksum SHA-256'
                    : '⚠️ Phát hiện file vật lý bị thay đổi hoặc mất trên đĩa!'}
                </div>
                <div style={{ fontSize: '0.68rem', marginTop: '2px' }}>
                  Số bản ghi trùng lặp SHA-256: {integrityResult.duplicateFileIds.length}
                </div>
              </div>
            )}

            {stats?.settings.categoryAllowedExtensions && (
              <div
                style={{
                  marginTop: '0.55rem',
                  padding: '0.45rem 0.6rem',
                  borderRadius: '8px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  fontSize: '0.69rem',
                  color: '#475569',
                  lineHeight: 1.4,
                }}
              >
                <strong style={{ color: '#0f172a' }}>
                  Định dạng cho phép theo loại (Setting 6.3.1):
                </strong>{' '}
                IMAGE ({stats.settings.categoryAllowedExtensions.IMAGE?.join(', ')}) • AUDIO (
                {stats.settings.categoryAllowedExtensions.AUDIO?.join(', ')}) • VIDEO (
                {stats.settings.categoryAllowedExtensions.VIDEO?.join(', ')})
              </div>
            )}
          </div>

          {/* Thẻ & Liên kết sử dụng dữ liệu (Mục 6.1.8) */}
          <div
            style={{
              paddingTop: '0.85rem',
              borderTop: '1px solid #f1f5f9',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.55rem',
              }}
            >
              <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>
                Thẻ & Liên kết sử dụng ({selectedFile.usageCount})
              </span>
              <button
                type="button"
                onClick={onToggleAddUsageForm}
                style={{
                  padding: '0.25rem 0.6rem',
                  borderRadius: '999px',
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  color: '#334155',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Thêm liên kết
              </button>
            </div>

            <div
              style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}
            >
              <span
                style={{
                  padding: '3px 9px',
                  borderRadius: '999px',
                  background: '#dbeafe',
                  color: '#1d4ed8',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                }}
              >
                {selectedFile.categoryName.toLowerCase()}
              </span>
              <span
                style={{
                  padding: '3px 9px',
                  borderRadius: '999px',
                  background: '#f3e8ff',
                  color: '#7c3aed',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                }}
              >
                {selectedFile.visibility === 2 ? 'dùng-chung' : 'nội-bộ'}
              </span>
              <span
                style={{
                  padding: '3px 9px',
                  borderRadius: '999px',
                  background: selectedFile.usageCount > 0 ? '#dcfce7' : '#f1f5f9',
                  color: selectedFile.usageCount > 0 ? '#15803d' : '#64748b',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                }}
              >
                {selectedFile.usageCount > 0 ? '🔒 đang-khóa-xóa' : 'có-thể-xóa'}
              </span>
            </div>

            {selectedFile.usages && selectedFile.usages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {selectedFile.usages.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      padding: '0.45rem 0.6rem',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      fontSize: '0.74rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <strong style={{ color: '#0f172a' }}>
                        {u.moduleName}.{u.entityType} #{u.entityId}
                      </strong>
                      {u.note && (
                        <div style={{ color: '#64748b', fontSize: '0.69rem' }}>{u.note}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onDetachUsage(selectedFile.id, u.id, u.moduleName, u.entityType, u.entityId)
                      }
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#dc2626',
                        cursor: 'pointer',
                      }}
                      title="Gỡ liên kết này"
                    >
                      <Unlink size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showAddUsageForm && (
              <form
                onSubmit={onSubmitAttachUsage}
                style={{
                  marginTop: '0.5rem',
                  padding: '0.6rem',
                  borderRadius: '10px',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.4rem',
                }}
              >
                <input
                  type="text"
                  value={usageModule}
                  onChange={(e) => onChangeUsageModule(e.target.value)}
                  placeholder="Module"
                  style={{
                    padding: '0.35rem 0.5rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.75rem',
                  }}
                />
                <input
                  type="text"
                  value={usageEntityType}
                  onChange={(e) => onChangeUsageEntityType(e.target.value)}
                  placeholder="Entity"
                  style={{
                    padding: '0.35rem 0.5rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.75rem',
                  }}
                />
                <input
                  type="text"
                  value={usageEntityId}
                  onChange={(e) => onChangeUsageEntityId(e.target.value)}
                  placeholder="ID"
                  style={{
                    padding: '0.35rem 0.5rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.75rem',
                  }}
                />
                <input
                  type="text"
                  value={usageNote}
                  onChange={(e) => onChangeUsageNote(e.target.value)}
                  placeholder="Ghi chú"
                  style={{
                    padding: '0.35rem 0.5rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.75rem',
                  }}
                />
                <button
                  type="submit"
                  style={{
                    gridColumn: 'span 2',
                    padding: '0.4rem',
                    borderRadius: '7px',
                    border: 'none',
                    background: '#2563eb',
                    color: '#ffffff',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Gắn liên kết bảo vệ file
                </button>
              </form>
            )}
          </div>

          {/* Quyền truy cập & Link tải tạm thời ở đáy Cột 3 (Mục 6.2) */}
          <div
            style={{
              paddingTop: '0.85rem',
              borderTop: '1px solid #f1f5f9',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.5rem',
              }}
            >
              <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>
                Quyền truy cập & Link tạm thời
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <button
                  type="button"
                  onClick={() => onCreateTempDownloadLink(selectedFile.id)}
                  style={{
                    padding: '0.22rem 0.55rem',
                    borderRadius: '999px',
                    border: '1px solid #bfdbfe',
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Link tạm thời
                </button>
                <button
                  type="button"
                  onClick={onToggleAddPermissionForm}
                  style={{
                    padding: '0.22rem 0.55rem',
                    borderRadius: '999px',
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    color: '#334155',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Phân quyền
                </button>
              </div>
            </div>

            {tempLinkUrl && (
              <div
                style={{
                  marginBottom: '0.5rem',
                  padding: '0.45rem 0.6rem',
                  borderRadius: '8px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  fontSize: '0.72rem',
                }}
              >
                <div style={{ fontWeight: 600, color: '#166534' }}>
                  Link tải tạm thời (Hết hạn:{' '}
                  {tempLinkExpiresAt
                    ? new Date(tempLinkExpiresAt).toLocaleTimeString('vi-VN')
                    : ''}
                  )
                </div>
                <code style={{ wordBreak: 'break-all', color: '#15803d', fontSize: '0.68rem' }}>
                  {tempLinkUrl}
                </code>
              </div>
            )}

            {selectedFile.permissions && selectedFile.permissions.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.3rem',
                  marginBottom: '0.5rem',
                }}
              >
                {selectedFile.permissions.map((perm) => (
                  <div
                    key={perm.id}
                    style={{
                      padding: '0.38rem 0.55rem',
                      borderRadius: '7px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      fontSize: '0.72rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>
                      <strong>
                        {perm.subjectTypeName}: {perm.subjectId}
                      </strong>{' '}
                      ({perm.canDownload ? 'Xem & Tải' : 'Chỉ xem'})
                    </span>
                    <button
                      type="button"
                      onClick={() => onRevokePermission(selectedFile.id, perm.id)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#dc2626',
                        cursor: 'pointer',
                      }}
                      title="Thu hồi quyền"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showAddPermissionForm && (
              <form
                onSubmit={onSubmitGrantPermission}
                style={{
                  marginBottom: '0.5rem',
                  padding: '0.55rem',
                  borderRadius: '9px',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                  fontSize: '0.74rem',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
                  <select
                    value={permSubjectType}
                    onChange={(e) =>
                      onChangePermSubjectType(e.target.value as 'USER' | 'ROLE' | 'ORG_UNIT')
                    }
                    style={{
                      padding: '0.32rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.74rem',
                    }}
                  >
                    <option value="USER">Người dùng (USER)</option>
                    <option value="ROLE">Vai trò (ROLE)</option>
                    <option value="ORG_UNIT">Đơn vị (ORG_UNIT)</option>
                  </select>
                  <input
                    type="text"
                    value={permSubjectId}
                    onChange={(e) => onChangePermSubjectId(e.target.value)}
                    placeholder="ID hoặc mã Role"
                    style={{
                      padding: '0.32rem 0.45rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.74rem',
                    }}
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="checkbox"
                    checked={permCanDownload}
                    onChange={(e) => onChangePermCanDownload(e.target.checked)}
                  />
                  <span>Cho phép tải file xuống (bỏ chọn = chỉ xem thông tin)</span>
                </label>
                <button
                  type="submit"
                  style={{
                    padding: '0.35rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#2563eb',
                    color: '#ffffff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Lưu phân quyền
                </button>
              </form>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ display: 'flex' }}>
                {['NM', 'TT', 'LH'].map((init, idx) => (
                  <div
                    key={init}
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '999px',
                      background: idx === 0 ? '#2563eb' : idx === 1 ? '#059669' : '#7c3aed',
                      color: '#ffffff',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid #ffffff',
                      marginLeft: idx === 0 ? 0 : '-6px',
                    }}
                  >
                    {init}
                  </div>
                ))}
              </div>
              <span
                style={{
                  fontSize: '0.74rem',
                  color: '#64748b',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                {selectedFile.visibility === 2 ? <Globe size={13} /> : <Lock size={13} />}
                Mức hiển thị: {selectedFile.visibilityName}
              </span>
            </div>
          </div>
        </>
      )}
    </aside>
  );
};
