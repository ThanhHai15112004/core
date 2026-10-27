import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  History,
  RefreshCw,
  Settings2,
  Upload,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import type {
  BulkImportUsersPayload,
  BulkImportUsersResult,
  ExportHistoryItem,
  ExportJobProgress,
  ImportDuplicateStrategy,
  ImportHistoryItem,
  ImportJobProgress,
  ImportUsersPreviewResponse,
} from '../types/users.types';

const SYSTEM_IMPORT_FIELDS: ReadonlyArray<{
  readonly field: string;
  readonly label: string;
  readonly required: boolean;
}> = [
  { field: 'username', label: 'Tên đăng nhập (username)', required: true },
  { field: 'email', label: 'Địa chỉ Email (email)', required: true },
  { field: 'fullName', label: 'Họ và tên (fullName)', required: false },
  { field: 'phone', label: 'Số điện thoại (phone)', required: false },
  { field: 'positionTitle', label: 'Chức danh (positionTitle)', required: false },
  { field: 'roleCodes', label: 'Mã vai trò (roleCodes)', required: false },
  { field: 'organizationCodes', label: 'Mã đơn vị (organizationCodes)', required: false },
];

export interface UsersBulkImportExportTabProps {
  readonly submitting: boolean;
  readonly lastImportResult: BulkImportUsersResult | null;
  readonly importPreview?: ImportUsersPreviewResponse | null;
  readonly importJobProgress?: ImportJobProgress | null;
  readonly importHistories?: readonly ImportHistoryItem[];
  readonly exportJobProgress?: ExportJobProgress | null;
  readonly exportHistories?: readonly ExportHistoryItem[];
  readonly onDownloadTemplate: (format: 'csv' | 'xlsx') => Promise<void>;
  readonly onExportUsers: (
    format: 'csv' | 'xlsx' | 'pdf',
    title?: string,
    options?: { async?: boolean; notifyOnComplete?: boolean; ttlSeconds?: number },
  ) => Promise<void>;
  readonly onBulkImport: (
    payload: BulkImportUsersPayload,
  ) => Promise<BulkImportUsersResult | null>;
  readonly onPreviewImport?: (
    payload: BulkImportUsersPayload,
  ) => Promise<ImportUsersPreviewResponse | null>;
  readonly onRefreshImportJobProgress?: (jobId: string) => Promise<void>;
  readonly onRefreshImportHistories?: () => Promise<void>;
  readonly onRefreshExportJobProgress?: (jobId: string) => Promise<void>;
  readonly onRefreshExportHistories?: () => Promise<void>;
  readonly onDownloadTemporaryExport?: (token: string) => Promise<void>;
}

export const UsersBulkImportExportTab: React.FC<UsersBulkImportExportTabProps> = ({
  submitting,
  lastImportResult,
  importPreview = null,
  importJobProgress = null,
  importHistories = [],
  exportJobProgress = null,
  exportHistories = [],
  onDownloadTemplate,
  onExportUsers,
  onBulkImport,
  onPreviewImport,
  onRefreshImportJobProgress,
  onRefreshImportHistories,
  onRefreshExportJobProgress,
  onRefreshExportHistories,
  onDownloadTemporaryExport,
}) => {
  const [defaultPassword, setDefaultPassword] = useState('CoreUser@2026');
  const [duplicateStrategy, setDuplicateStrategy] = useState<ImportDuplicateStrategy>('SKIP');
  const [runImportAsync, setRunImportAsync] = useState(false);
  const [csvContent, setCsvContent] = useState(
    'username,email,fullName,phone,positionTitle,roleCodes,organizationCodes\nnguyen.minh,minh.nguyen@company.vn,Nguyễn Hoàng Minh,0909888777,Chuyên viên,user,',
  );
  const [xlsxBase64, setXlsxBase64] = useState<string>('');
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [showColumnMapping, setShowColumnMapping] = useState(false);

  const [exportTitle, setExportTitle] = useState('BÁO CÁO DANH SÁCH NHÂN SỰ HỆ THỐNG');
  const [runExportAsync, setRunExportAsync] = useState(false);
  const [notifyOnExportComplete, setNotifyOnExportComplete] = useState(true);
  const [exportTtlSeconds, setExportTtlSeconds] = useState(3600);
  const [manualJobIdInput, setManualJobIdInput] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);

    if (file.name.toLowerCase().endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = () => {
        setCsvContent(typeof reader.result === 'string' ? reader.result : '');
        setXlsxBase64('');
      };
      reader.readAsText(file, 'utf-8');
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const resultStr = typeof reader.result === 'string' ? reader.result : '';
        const base64Part = resultStr.includes(',') ? resultStr.split(',')[1]! : resultStr;
        setXlsxBase64(base64Part);
      };
      reader.readAsDataURL(file);
    }
  };

  const buildCleanedColumnMapping = (): Record<string, string> | undefined => {
    const cleaned: Record<string, string> = {};
    for (const [field, header] of Object.entries(columnMapping)) {
      if (header && header.trim().length > 0) {
        cleaned[field] = header.trim();
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  };

  const buildCurrentImportPayload = (): BulkImportUsersPayload => {
    const activeMapping = buildCleanedColumnMapping();
    return {
      ...(selectedFileName ? { fileName: selectedFileName } : {}),
      ...(xlsxBase64 ? { xlsxBase64 } : { csvContent }),
      ...(activeMapping ? { columnMapping: activeMapping } : {}),
      defaultPassword,
      duplicateStrategy,
      skipDuplicates: duplicateStrategy === 'SKIP',
      async: runImportAsync,
    };
  };

  const handlePreview = async () => {
    if (!onPreviewImport) return;
    const res = await onPreviewImport(buildCurrentImportPayload());
    if (res && res.columnMatches.length > 0) {
      setShowColumnMapping(true);
    }
  };

  const handleRunImport = async (e: React.FormEvent) => {
    e.preventDefault();
    await onBulkImport(buildCurrentImportPayload());
  };

  const detectedHeaders = importPreview?.detectedHeaders ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
          gap: '18px',
        }}
      >
        {/* Left Card: Bulk Import CSV / XLSX (Mục 8.2.1 - 8.2.8) */}
        <form onSubmit={(e) => void handleRunImport(e)} style={authStyles.cardHighlighted}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              marginBottom: '12px',
            }}
          >
            <div>
              <h3 style={authStyles.sectionTitle}>
                <Upload size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                Nhập Nhân Sự Hàng Loạt (Mục 8.2 — Excel / CSV / Queue)
              </h3>
              <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
                Hỗ trợ ánh xạ cột động (8.2.3), xem trước dữ liệu & lỗi từng ô (8.2.4–8.2.5), xử lý
                dữ liệu trùng <code>SKIP / UPDATE / REJECT</code> (8.2.6) và chạy bằng Queue (8.2.7).
              </p>
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onDownloadTemplate('xlsx')}
                style={authStyles.btnSecondary}
              >
                <FileSpreadsheet size={14} /> Mẫu .XLSX
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onDownloadTemplate('csv')}
                style={authStyles.btnSecondary}
              >
                <Download size={14} /> Mẫu .CSV
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px',
              marginBottom: '12px',
            }}
          >
            <div>
              <label style={authStyles.label}>Chọn tệp Excel (.xlsx) hoặc CSV (.csv)</label>
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={handleFileChange}
                style={authStyles.input}
              />
              {selectedFileName && (
                <div style={{ fontSize: '11.5px', color: 'var(--primary)', marginTop: '4px' }}>
                  Đã nạp tệp: <strong>{selectedFileName}</strong>{' '}
                  {xlsxBase64 ? '(XLSX Base64)' : '(CSV Text)'}
                </div>
              )}
            </div>

            <div>
              <label style={authStyles.label}>Mật khẩu mặc định (khi dòng thiếu password)</label>
              <input
                type="text"
                minLength={8}
                value={defaultPassword}
                onChange={(e) => setDefaultPassword(e.target.value)}
                style={authStyles.monoInput}
              />
            </div>
          </div>

          {/* Mục 8.2.6: Chiến lược xử lý trùng & Mục 8.2.7: Chạy Queue */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.2fr 1fr',
              gap: '10px',
              marginBottom: '12px',
              alignItems: 'end',
            }}
          >
            <div>
              <label style={authStyles.label}>
                Chiến lược xử lý dữ liệu trùng (Mục 8.2.6)
              </label>
              <select
                value={duplicateStrategy}
                onChange={(e) => setDuplicateStrategy(e.target.value as ImportDuplicateStrategy)}
                style={authStyles.input}
              >
                <option value="SKIP">SKIP — Bỏ qua dòng trùng Username / Email</option>
                <option value="UPDATE">UPDATE — Cập nhật thông tin hồ sơ đã tồn tại</option>
                <option value="REJECT">REJECT — Từ chối và ghi nhận lỗi dòng trùng</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={runImportAsync}
                  onChange={(e) => setRunImportAsync(e.target.checked)}
                />
                Chạy Import qua Queue nền (Mục 8.2.7)
              </label>
              <button
                type="button"
                onClick={() => setShowColumnMapping((v) => !v)}
                style={{ ...authStyles.btnSecondary, padding: '6px 10px', fontSize: '12px' }}
              >
                <Settings2 size={13} />
                {showColumnMapping ? 'Ẩn cấu hình Ánh xạ cột' : 'Cấu hình Ánh xạ cột (Mục 8.2.3)'}
              </button>
            </div>
          </div>

          {/* Mục 8.2.3: Bảng Ánh xạ cột (Column Mapping) */}
          {showColumnMapping && (
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                  Ánh xạ cột trong file với trường hệ thống (Mục 8.2.3)
                </span>
                {Object.keys(columnMapping).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setColumnMapping({})}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--primary)',
                      fontSize: '11.5px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Đặt lại tự động (Auto-detect)
                  </button>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '8px',
                }}
              >
                {SYSTEM_IMPORT_FIELDS.map((item) => {
                  const matchedInfo = importPreview?.columnMatches.find(
                    (m) => m.field === item.field,
                  );
                  return (
                    <div key={item.field}>
                      <label style={{ ...authStyles.label, fontSize: '11.5px', marginBottom: '3px' }}>
                        {item.label}{' '}
                        {item.required && <span style={{ color: 'var(--status-danger)' }}>*</span>}
                      </label>
                      {detectedHeaders.length > 0 ? (
                        <select
                          value={columnMapping[item.field] ?? ''}
                          onChange={(e) =>
                            setColumnMapping((prev) => ({
                              ...prev,
                              [item.field]: e.target.value,
                            }))
                          }
                          style={{ ...authStyles.input, padding: '6px 8px', fontSize: '12px' }}
                        >
                          <option value="">
                            {matchedInfo?.matchedHeader
                              ? `Tự động: ${matchedInfo.matchedHeader} (${matchedInfo.matchedColumnLetter ?? ''})`
                              : '-- Tự động nhận diện --'}
                          </option>
                          {detectedHeaders.map((h) => (
                            <option key={h} value={h}>
                              Cột: {h}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder="Tên cột trong file (để trống = tự động)"
                          value={columnMapping[item.field] ?? ''}
                          onChange={(e) =>
                            setColumnMapping((prev) => ({
                              ...prev,
                              [item.field]: e.target.value,
                            }))
                          }
                          style={{ ...authStyles.input, padding: '6px 8px', fontSize: '12px' }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginBottom: '12px' }}>
            <label style={authStyles.label}>
              Hoặc chỉnh sửa / dán trực tiếp dữ liệu CSV bên dưới:
            </label>
            <textarea
              rows={5}
              value={csvContent}
              onChange={(e) => {
                setCsvContent(e.target.value);
                setXlsxBase64('');
              }}
              style={{
                ...authStyles.monoInput,
                resize: 'vertical',
                lineHeight: 1.5,
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {onPreviewImport && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handlePreview()}
                style={authStyles.btnSecondary}
              >
                <Eye size={15} /> Xem trước & Kiểm tra lỗi (Mục 8.2.4 & 8.2.5)
              </button>
            )}
            <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
              <Upload size={15} />
              {runImportAsync
                ? 'Đẩy vào Queue Nhập hàng loạt (8.2.7)'
                : 'Thực thi Nhập hàng loạt'}
            </button>
          </div>
        </form>

        {/* Right Card: Export Users Report (Mục 8.3.1 - 8.3.8) & Import Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>
              <FileSpreadsheet size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
              Xuất Danh Sách Nhân Sự (Mục 8.3 — XLSX / CSV / PDF / Queue)
            </h3>
            <p style={authStyles.sectionDesc}>
              Giữ nguyên bộ lọc & Data Scope hiện hành (8.3.1–8.3.3), hỗ trợ đẩy vào Queue cho dữ
              liệu lớn (8.3.4), thông báo kèm link tải tạm thời tự hết hạn (8.3.5 & 8.3.8).
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1fr',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              <div>
                <label style={authStyles.label}>Tiêu đề báo cáo trên đầu trang</label>
                <input
                  type="text"
                  value={exportTitle}
                  onChange={(e) => setExportTitle(e.target.value)}
                  style={authStyles.input}
                />
              </div>
              <div>
                <label style={authStyles.label}>Thời hạn file tạm (TTL giây — Mục 8.3.8)</label>
                <input
                  type="number"
                  min={60}
                  max={604800}
                  value={exportTtlSeconds}
                  onChange={(e) => setExportTtlSeconds(Number(e.target.value) || 3600)}
                  style={authStyles.monoInput}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '16px',
                flexWrap: 'wrap',
                marginBottom: '12px',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={runExportAsync}
                  onChange={(e) => setRunExportAsync(e.target.checked)}
                />
                Chạy Export lớn bằng Queue (8.3.4)
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={notifyOnExportComplete}
                  onChange={(e) => setNotifyOnExportComplete(e.target.checked)}
                />
                Gửi thông báo kèm đường dẫn tải tạm thời (8.3.5)
              </label>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={submitting}
                onClick={() =>
                  void onExportUsers('xlsx', exportTitle, {
                    async: runExportAsync,
                    notifyOnComplete: notifyOnExportComplete,
                    ttlSeconds: exportTtlSeconds,
                  })
                }
                style={authStyles.btnTeal}
              >
                <FileSpreadsheet size={15} /> Xuất Excel (.XLSX)
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() =>
                  void onExportUsers('csv', exportTitle, {
                    async: runExportAsync,
                    notifyOnComplete: notifyOnExportComplete,
                    ttlSeconds: exportTtlSeconds,
                  })
                }
                style={authStyles.btnSecondary}
              >
                <Download size={15} /> Xuất CSV (.CSV)
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() =>
                  void onExportUsers('pdf', exportTitle, {
                    async: runExportAsync,
                    notifyOnComplete: notifyOnExportComplete,
                    ttlSeconds: exportTtlSeconds,
                  })
                }
                style={authStyles.btnSecondary}
              >
                <FileText size={15} /> Xuất PDF qua Adapter (.PDF — 8.3.3)
              </button>
            </div>
          </div>

          {/* Import Result & Queue Job Progress Card (Mục 8.2.8 & 8.3.4) */}
          <div style={authStyles.card}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                marginBottom: '10px',
              }}
            >
              <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
                Kết quả & Tiến độ Công việc Import / Export (Mục 8.2.8 & 8.3.4)
              </h3>
              {(onRefreshImportJobProgress || onRefreshExportJobProgress) && (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Nhập Job ID để tra cứu..."
                    value={manualJobIdInput}
                    onChange={(e) => setManualJobIdInput(e.target.value)}
                    style={{ ...authStyles.monoInput, width: '190px', padding: '5px 8px', fontSize: '12px' }}
                  />
                  {onRefreshImportJobProgress && (
                    <button
                      type="button"
                      disabled={submitting || !(manualJobIdInput.trim() || lastImportResult?.jobId)}
                      onClick={() => {
                        const targetJobId = manualJobIdInput.trim() || lastImportResult?.jobId;
                        if (targetJobId) void onRefreshImportJobProgress(targetJobId);
                      }}
                      style={{ ...authStyles.btnSecondary, padding: '5px 10px', fontSize: '12px' }}
                    >
                      <RefreshCw size={12} /> Tiến độ Import
                    </button>
                  )}
                  {onRefreshExportJobProgress && manualJobIdInput.trim() && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void onRefreshExportJobProgress(manualJobIdInput.trim())}
                      style={{ ...authStyles.btnSecondary, padding: '5px 10px', fontSize: '12px' }}
                    >
                      <RefreshCw size={12} /> Tiến độ Export
                    </button>
                  )}
                </div>
              )}
            </div>

            {importJobProgress && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-color)',
                  marginBottom: '12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    fontWeight: 700,
                    marginBottom: '6px',
                  }}
                >
                  <span>
                    Tiến độ Import Job <code>{importJobProgress.jobId}</code> ({importJobProgress.status})
                  </span>
                  <span>
                    {importJobProgress.processedRows}/{importJobProgress.totalRows} dòng (Còn lại:{' '}
                    {importJobProgress.remainingRows}) — {importJobProgress.percent}%
                  </span>
                </div>
                <div
                  style={{
                    height: '8px',
                    borderRadius: '999px',
                    background: 'var(--bg-input)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, importJobProgress.percent))}%`,
                      height: '100%',
                      background: 'var(--primary)',
                    }}
                  />
                </div>
              </div>
            )}

            {exportJobProgress && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-color)',
                  marginBottom: '12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '12px',
                    fontWeight: 700,
                    marginBottom: '6px',
                  }}
                >
                  <span>
                    Tiến độ Export Job <code>{exportJobProgress.jobId}</code> ({exportJobProgress.status})
                  </span>
                  <span>
                    {exportJobProgress.processedRows}/{exportJobProgress.totalRows} dòng —{' '}
                    {exportJobProgress.percent}%
                  </span>
                </div>
                {exportJobProgress.downloadToken && onDownloadTemporaryExport && (
                  <button
                    type="button"
                    onClick={() => void onDownloadTemporaryExport(exportJobProgress.downloadToken!)}
                    style={{ ...authStyles.btnTeal, padding: '5px 10px', fontSize: '12px' }}
                  >
                    <Download size={13} /> Tải file Export tạm thời ({exportJobProgress.format.toUpperCase()})
                  </button>
                )}
              </div>
            )}

            {!lastImportResult ? (
              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)' }}>
                Chưa thực hiện phiên nhập hàng loạt nào trong phiên làm việc hiện tại.
              </p>
            ) : (
              <div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: '8px',
                    marginBottom: '12px',
                  }}
                >
                  <div
                    style={{
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-input)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Tổng số dòng</div>
                    <div style={{ fontSize: '17px', fontWeight: 800 }}>
                      {lastImportResult.totalRows}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--status-success-bg)',
                      color: 'var(--status-success)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '11px' }}>Tạo mới</div>
                    <div style={{ fontSize: '17px', fontWeight: 800 }}>
                      {lastImportResult.importedCount}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--primary-light)',
                      color: 'var(--primary)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '11px' }}>Cập nhật (UPDATE)</div>
                    <div style={{ fontSize: '17px', fontWeight: 800 }}>
                      {lastImportResult.updatedCount ?? 0}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--status-warning-bg)',
                      color: 'var(--status-warning)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '11px' }}>Bỏ qua (SKIP)</div>
                    <div style={{ fontSize: '17px', fontWeight: 800 }}>
                      {lastImportResult.skippedCount}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--status-danger-bg)',
                      color: 'var(--status-danger)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '11px' }}>Lỗi dòng</div>
                    <div style={{ fontSize: '17px', fontWeight: 800 }}>
                      {lastImportResult.failedCount}
                    </div>
                  </div>
                </div>

                {lastImportResult.jobId && (
                  <div style={{ fontSize: '12px', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                    Mã tiến trình Queue: <code>{lastImportResult.jobId}</code> — Trạng thái:{' '}
                    <strong>{lastImportResult.status ?? 'COMPLETED'}</strong>
                  </div>
                )}

                {lastImportResult.errors.length > 0 && (
                  <div style={{ maxHeight: '170px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={authStyles.tableHeaderCell}>Dòng / Ô</th>
                          <th style={authStyles.tableHeaderCell}>Trường / Định danh</th>
                          <th style={authStyles.tableHeaderCell}>Chi tiết lỗi (Mục 8.2.5)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastImportResult.errors.map((err, i) => (
                          <tr key={`${err.row}-${i}`}>
                            <td style={authStyles.tableCell}>
                              #{err.sheetRowNumber ?? err.row}
                              {err.columnLetter ? ` (Cột ${err.columnLetter})` : ''}
                            </td>
                            <td style={authStyles.tableCell}>
                              <code>{err.field || err.identifier}</code>
                            </td>
                            <td
                              style={{
                                ...authStyles.tableCell,
                                color: 'var(--status-danger)',
                                fontSize: '12px',
                              }}
                            >
                              {err.message}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview / Dry-Run Inspector Card (Mục 8.2.3, 8.2.4, 8.2.5) */}
      {importPreview && (
        <div style={authStyles.card}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              marginBottom: '12px',
            }}
          >
            <div>
              <h3 style={{ ...authStyles.sectionTitle, marginBottom: '4px' }}>
                <Eye size={16} /> Xem trước dữ liệu trước khi nhập & Kiểm tra lỗi từng dòng/cột
                (Mục 8.2.4 & 8.2.5)
              </h3>
              <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
                Chiến lược trùng: <code>{importPreview.duplicateStrategy}</code> — Hợp lệ:{' '}
                <strong>{importPreview.validRowsCount}</strong> | Sẽ tạo mới:{' '}
                <strong>{importPreview.willCreateCount}</strong> | Sẽ cập nhật:{' '}
                <strong>{importPreview.willUpdateCount}</strong> | Sẽ bỏ qua:{' '}
                <strong>{importPreview.willSkipCount}</strong> | Lỗi/Từ chối:{' '}
                <strong style={{ color: 'var(--status-danger)' }}>
                  {importPreview.invalidRowsCount}
                </strong>
              </p>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {importPreview.columnMatches.map((cm) => (
                <span
                  key={cm.field}
                  style={
                    cm.mappedBy === 'unmapped'
                      ? authStyles.badgeWarning
                      : authStyles.badgeSuccess
                  }
                >
                  {cm.field}: {cm.matchedHeader ? `${cm.matchedHeader} (${cm.matchedColumnLetter})` : 'Chưa khớp'}
                </span>
              ))}
            </div>
          </div>

          <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>Dòng Excel</th>
                  <th style={authStyles.tableHeaderCell}>Trạng thái dự kiến</th>
                  <th style={authStyles.tableHeaderCell}>Dữ liệu đã ánh xạ</th>
                  <th style={authStyles.tableHeaderCell}>Kiểm tra lỗi theo dòng & cột</th>
                </tr>
              </thead>
              <tbody>
                {importPreview.sampleRows.map((row) => (
                  <tr key={row.row}>
                    <td style={authStyles.tableCell}>Dòng #{row.sheetRowNumber}</td>
                    <td style={authStyles.tableCell}>
                      <span
                        style={
                          row.status === 'VALID'
                            ? authStyles.badgeSuccess
                            : row.status === 'DUPLICATE_UPDATE'
                              ? authStyles.badgePrimary
                              : row.status === 'DUPLICATE_SKIP'
                                ? authStyles.badgeWarning
                                : authStyles.badgeDanger
                        }
                      >
                        {row.status}
                        {row.existingRecordId ? ` (ID #${row.existingRecordId})` : ''}
                      </span>
                    </td>
                    <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                      <code>{JSON.stringify(row.parsedRow ?? row.rawValues)}</code>
                    </td>
                    <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                      {row.issues.length === 0 ? (
                        <span style={{ color: 'var(--status-success)', fontWeight: 600 }}>
                          <CheckCircle2 size={13} style={{ verticalAlign: 'middle' }} /> Hợp lệ
                        </span>
                      ) : (
                        row.issues.map((iss, idx) => (
                          <div key={idx} style={{ color: 'var(--status-danger)' }}>
                            • [Cột {iss.columnLetter || iss.column || iss.field}]: {iss.message}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Histories Grid: Import Histories (Mục 8.2.9) & Export Histories (Mục 8.3.7 & 8.3.8) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
          gap: '18px',
        }}
      >
        {/* Import History Card (Mục 8.2.9) */}
        <div style={authStyles.card}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
            }}
          >
            <div>
              <h3 style={{ ...authStyles.sectionTitle, marginBottom: '2px' }}>
                <History size={16} /> Lịch sử Import Nhân sự (Mục 8.2.9)
              </h3>
              <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
                Lưu vết tệp tin, người thực hiện, chiến lược trùng và kết quả chi tiết.
              </p>
            </div>
            {onRefreshImportHistories && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onRefreshImportHistories()}
                style={authStyles.btnSecondary}
              >
                <RefreshCw size={13} /> Làm mới
              </button>
            )}
          </div>

          {importHistories.length === 0 ? (
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)' }}>
              Chưa có bản ghi lịch sử Import nào.
            </p>
          ) : (
            <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={authStyles.tableHeaderCell}>ID / File</th>
                    <th style={authStyles.tableHeaderCell}>Chiến lược</th>
                    <th style={authStyles.tableHeaderCell}>Kết quả (Tạo/Sửa/Bỏ/Lỗi)</th>
                    <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {importHistories.map((h) => (
                    <tr key={h.id}>
                      <td style={authStyles.tableCell}>
                        <div style={{ fontWeight: 700 }}>
                          #{h.id} — {h.fileName}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Actor: {h.actorId ? `#${h.actorId}` : 'System'} •{' '}
                          {new Date(h.createdAt).toLocaleString('vi-VN')}
                        </div>
                      </td>
                      <td style={authStyles.tableCell}>
                        <span style={authStyles.badgePrimary}>{h.duplicateStrategy}</span>
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        <strong>{h.createdCount}</strong> tạo / <strong>{h.updatedCount}</strong> sửa /{' '}
                        {h.skippedCount} bỏ /{' '}
                        <span style={{ color: h.failedCount > 0 ? 'var(--status-danger)' : 'inherit' }}>
                          {h.failedCount} lỗi
                        </span>{' '}
                        (Tổng: {h.totalRows})
                      </td>
                      <td style={authStyles.tableCell}>
                        <span
                          style={
                            h.status === 'COMPLETED'
                              ? authStyles.badgeSuccess
                              : h.status === 'PARTIAL'
                                ? authStyles.badgeWarning
                                : h.status === 'FAILED'
                                  ? authStyles.badgeDanger
                                  : authStyles.badgePrimary
                          }
                        >
                          {h.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Export History Card (Mục 8.3.7 & 8.3.8) */}
        <div style={authStyles.card}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
            }}
          >
            <div>
              <h3 style={{ ...authStyles.sectionTitle, marginBottom: '2px' }}>
                <Clock size={16} /> Lịch sử Export & File tạm có thời hạn (Mục 8.3.7 & 8.3.8)
              </h3>
              <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
                Lưu vết người xuất, bộ lọc, số dòng, giới hạn áp dụng và tự động hết hạn file tạm.
              </p>
            </div>
            {onRefreshExportHistories && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onRefreshExportHistories()}
                style={authStyles.btnSecondary}
              >
                <RefreshCw size={13} /> Làm mới
              </button>
            )}
          </div>

          {exportHistories.length === 0 ? (
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)' }}>
              Chưa có bản ghi lịch sử Export nào.
            </p>
          ) : (
            <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={authStyles.tableHeaderCell}>ID / Tệp xuất</th>
                    <th style={authStyles.tableHeaderCell}>Số bản ghi</th>
                    <th style={authStyles.tableHeaderCell}>Thời hạn / Trạng thái</th>
                    <th style={authStyles.tableHeaderCell}>Tải file tạm</th>
                  </tr>
                </thead>
                <tbody>
                  {exportHistories.map((h) => (
                    <tr key={h.id}>
                      <td style={authStyles.tableCell}>
                        <div style={{ fontWeight: 700 }}>
                          #{h.id} — {h.fileName} ({h.format.toUpperCase()})
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Actor: {h.actorId ? `#${h.actorId}` : 'System'} • Bộ lọc:{' '}
                          <code>{JSON.stringify(h.filters)}</code>
                        </div>
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        <strong>{h.totalExported}</strong> dòng
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Giới hạn tối đa: {h.maxRowsApplied}
                        </div>
                      </td>
                      <td style={authStyles.tableCell}>
                        <span
                          style={
                            h.isExpired || h.status === 'EXPIRED'
                              ? authStyles.badgeWarning
                              : h.status === 'COMPLETED'
                                ? authStyles.badgeSuccess
                                : authStyles.badgePrimary
                          }
                        >
                          {h.isExpired ? 'EXPIRED (Đã hết hạn)' : h.status}
                        </span>
                        {h.expiresAt && (
                          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
                            Hết hạn: {new Date(h.expiresAt).toLocaleString('vi-VN')}
                          </div>
                        )}
                      </td>
                      <td style={authStyles.tableCell}>
                        {h.downloadToken && !h.isExpired && onDownloadTemporaryExport ? (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => void onDownloadTemporaryExport(h.downloadToken!)}
                            style={{ ...authStyles.btnSecondary, padding: '5px 10px', fontSize: '11.5px' }}
                          >
                            <Download size={12} /> Tải về
                          </button>
                        ) : (
                          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                            {h.isExpired ? 'Đã thu hồi' : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
