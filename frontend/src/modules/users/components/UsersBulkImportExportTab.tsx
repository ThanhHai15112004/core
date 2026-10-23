import React, { useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import type { BulkImportUsersResult } from '../types/users.types';

interface UsersBulkImportExportTabProps {
  readonly submitting: boolean;
  readonly lastImportResult: BulkImportUsersResult | null;
  readonly onDownloadTemplate: (format: 'csv' | 'xlsx') => Promise<void>;
  readonly onExportUsers: (format: 'csv' | 'xlsx', title?: string) => Promise<void>;
  readonly onBulkImport: (payload: {
    xlsxBase64?: string;
    csvContent?: string;
    defaultPassword?: string;
    skipDuplicates?: boolean;
  }) => Promise<BulkImportUsersResult | null>;
}

export const UsersBulkImportExportTab: React.FC<UsersBulkImportExportTabProps> = ({
  submitting,
  lastImportResult,
  onDownloadTemplate,
  onExportUsers,
  onBulkImport,
}) => {
  const [defaultPassword, setDefaultPassword] = useState('CoreUser@2026');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [csvContent, setCsvContent] = useState(
    'username,email,fullName,phone,positionTitle,roleCodes,organizationCodes\nnguyen.minh,minh.nguyen@company.vn,Nguyễn Hoàng Minh,0909888777,Chuyên viên,user,',
  );
  const [xlsxBase64, setXlsxBase64] = useState<string>('');
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [exportTitle, setExportTitle] = useState('BÁO CÁO DANH SÁCH NHÂN SỰ HỆ THỐNG');

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

  const handleRunImport = async (e: React.FormEvent) => {
    e.preventDefault();
    await onBulkImport({
      ...(xlsxBase64 ? { xlsxBase64 } : { csvContent }),
      defaultPassword,
      skipDuplicates,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: '18px',
        }}
      >
        {/* Left Card: Bulk Import CSV / XLSX */}
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
                Nhập Nhân Sự Hàng Loạt (Bulk Import CSV / XLSX)
              </h3>
              <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
                Hỗ trợ chuẩn hóa cột tiếng Việt/tiếng Anh, tự động ánh xạ mã Vai trò (<code>roleCodes</code>) và mã Đơn vị (<code>organizationCodes</code>).
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
                  {xlsxBase64 ? '(Chế độ XLSX Base64)' : '(Chế độ CSV Text)'}
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

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12.5px',
              fontWeight: 600,
              marginBottom: '12px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={skipDuplicates}
              onChange={(e) => setSkipDuplicates(e.target.checked)}
            />
            Bỏ qua các dòng trùng Username / Email / SĐT (Skip Duplicates)
          </label>

          <div style={{ marginBottom: '12px' }}>
            <label style={authStyles.label}>
              Hoặc chỉnh sửa / dán trực tiếp dữ liệu CSV bên dưới:
            </label>
            <textarea
              rows={6}
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

          <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
            <Upload size={15} /> Thực thi Nhập hàng loạt
          </button>
        </form>

        {/* Right Card: Export Users Report & Import Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>
              <FileSpreadsheet size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
              Xuất Báo Cáo Danh Sách Nhân Sự (Export XLSX / CSV)
            </h3>
            <p style={authStyles.sectionDesc}>
              Xuất danh sách nhân sự theo bộ lọc hiện hành và phạm vi dữ liệu (Data Scope) kèm tiêu đề báo cáo.
            </p>

            <div style={{ marginBottom: '12px' }}>
              <label style={authStyles.label}>Tiêu đề báo cáo trên đầu trang Excel</label>
              <input
                type="text"
                value={exportTitle}
                onChange={(e) => setExportTitle(e.target.value)}
                style={authStyles.input}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onExportUsers('xlsx', exportTitle)}
                style={authStyles.btnTeal}
              >
                <FileSpreadsheet size={15} /> Xuất báo cáo Excel (.XLSX)
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => void onExportUsers('csv', exportTitle)}
                style={authStyles.btnSecondary}
              >
                <Download size={15} /> Xuất tệp chuẩn (.CSV)
              </button>
            </div>
          </div>

          {/* Import Result Summary Card */}
          <div style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>Kết quả Nhập hàng loạt gần nhất</h3>
            {!lastImportResult ? (
              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)' }}>
                Chưa thực hiện phiên nhập hàng loạt nào trong phiên làm việc hiện tại.
              </p>
            ) : (
              <div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '8px',
                    marginBottom: '12px',
                  }}
                >
                  <div
                    style={{
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-input)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Tổng số dòng</div>
                    <div style={{ fontSize: '18px', fontWeight: 800 }}>
                      {lastImportResult.totalRows}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--status-success-bg)',
                      color: 'var(--status-success)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '11px' }}>Thành công</div>
                    <div style={{ fontSize: '18px', fontWeight: 800 }}>
                      {lastImportResult.importedCount}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--status-warning-bg)',
                      color: 'var(--status-warning)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '11px' }}>Bỏ qua (Trùng)</div>
                    <div style={{ fontSize: '18px', fontWeight: 800 }}>
                      {lastImportResult.skippedCount}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--status-danger-bg)',
                      color: 'var(--status-danger)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '11px' }}>Lỗi dòng</div>
                    <div style={{ fontSize: '18px', fontWeight: 800 }}>
                      {lastImportResult.failedCount}
                    </div>
                  </div>
                </div>

                {lastImportResult.errors.length > 0 && (
                  <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={authStyles.tableHeaderCell}>Dòng</th>
                          <th style={authStyles.tableHeaderCell}>Định danh</th>
                          <th style={authStyles.tableHeaderCell}>Chi tiết lỗi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastImportResult.errors.map((err, i) => (
                          <tr key={`${err.row}-${i}`}>
                            <td style={authStyles.tableCell}>#{err.row}</td>
                            <td style={authStyles.tableCell}>
                              <code>{err.identifier}</code>
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
    </div>
  );
};

