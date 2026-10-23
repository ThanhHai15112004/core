import React, { useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';
import {
  authBadgeStyle,
  authBtnPrimaryStyle,
  authBtnSecondaryStyle,
  authCardStyle,
  authInputStyle,
  authLabelStyle,
} from '../../auth/components/auth-ui.styles';
import type { BulkImportCodesResult, CodeTypeSummaryItem } from '../types/codes.types';

interface CodesBulkImportExportModalProps {
  selectedType: CodeTypeSummaryItem | null;
  submitting: boolean;
  importResult: BulkImportCodesResult | null;
  onClose: () => void;
  onExportCodes: (format: 'csv' | 'xlsx', onlyCurrentType: boolean) => Promise<void>;
  onDownloadTemplate: (format: 'csv' | 'xlsx') => Promise<void>;
  onBulkImport: (payload: {
    typeCode?: string;
    csvContent?: string;
    xlsxBase64?: string;
    skipDuplicates?: boolean;
  }) => Promise<BulkImportCodesResult | null>;
}

export const CodesBulkImportExportModal: React.FC<CodesBulkImportExportModalProps> = ({
  selectedType,
  submitting,
  importResult,
  onClose,
  onExportCodes,
  onDownloadTemplate,
  onBulkImport,
}) => {
  const [targetTypeCode, setTargetTypeCode] = useState(selectedType?.code ?? '');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [csvText, setCsvText] = useState('');
  const [xlsxBase64, setXlsxBase64] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);

    if (file.name.toLowerCase().endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = () => {
        setCsvText(String(reader.result ?? ''));
        setXlsxBase64(null);
      };
      reader.readAsText(file, 'utf-8');
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        setXlsxBase64(btoa(binary));
        setCsvText('');
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleRunImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvText.trim() && !xlsxBase64) return;
    await onBulkImport({
      typeCode: targetTypeCode.trim() || undefined,
      csvContent: csvText.trim() || undefined,
      xlsxBase64: xlsxBase64 || undefined,
      skipDuplicates,
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          ...authCardStyle,
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: '12px',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FileSpreadsheet size={20} color="var(--primary)" />
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--text-main)' }}>
              Nhập / Xuất Danh Mục Dùng Chung Hàng Loạt (CSV & Excel .XLSX)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Khu vực Xuất Master Data & Tải Template */}
        <div
          style={{
            padding: '16px',
            borderRadius: '10px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--text-main)' }}>
            1. Xuất Dữ Liệu Danh Mục (Export) & Tải File Mẫu (Import Template)
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onDownloadTemplate('xlsx')}
              style={authBtnSecondaryStyle}
            >
              <Download size={14} />
              <span>Tải Mẫu Import (.XLSX)</span>
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onDownloadTemplate('csv')}
              style={authBtnSecondaryStyle}
            >
              <Download size={14} />
              <span>Tải Mẫu Import (.CSV)</span>
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onExportCodes('xlsx', false)}
              style={authBtnPrimaryStyle}
            >
              <FileSpreadsheet size={14} />
              <span>Xuất Toàn Bộ Danh Mục (.XLSX)</span>
            </button>
            {selectedType && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onExportCodes('xlsx', true)}
                style={authBtnSecondaryStyle}
              >
                <FileSpreadsheet size={14} />
                <span>Chỉ Xuất Nhóm {selectedType.code}</span>
              </button>
            )}
          </div>
        </div>

        {/* Khu vực Nhập Hàng Loạt */}
        <form
          onSubmit={(e) => void handleRunImport(e)}
          style={{
            padding: '16px',
            borderRadius: '10px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--text-main)' }}>
            2. Nhập Danh Mục Từ File Excel (.XLSX) hoặc CSV
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={authLabelStyle}>Nhóm danh mục mặc định (nếu file không có cột Mã nhóm)</label>
              <input
                type="text"
                value={targetTypeCode}
                onChange={(e) => setTargetTypeCode(e.target.value)}
                placeholder="VD: crm.customer_tier"
                style={authInputStyle}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Chọn tệp .xlsx hoặc .csv</label>
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={handleFileChange}
                style={{ ...authInputStyle, padding: '7px 10px' }}
              />
              {selectedFileName && (
                <div style={{ fontSize: '11.5px', color: 'var(--primary)', marginTop: '4px' }}>
                  Đã nạp tệp: {selectedFileName}
                </div>
              )}
            </div>
          </div>

          <div>
            <label style={authLabelStyle}>Hoặc dán trực tiếp nội dung CSV:</label>
            <textarea
              rows={4}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setXlsxBase64(null);
              }}
              placeholder="Mã nhóm danh mục,Mã số,Mã mục,Tên hiển thị (VI),Tên tiếng Anh (EN)&#10;crm.customer_tier,1,GOLD,Hạng Vàng,Gold Tier"
              style={{ ...authInputStyle, fontFamily: 'monospace', fontSize: '12px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(e) => setSkipDuplicates(e.target.checked)}
              />
              <span>Tự động bỏ qua dòng trùng mã (skipDuplicates)</span>
            </label>

            <button
              type="submit"
              disabled={submitting || (!csvText.trim() && !xlsxBase64)}
              style={authBtnPrimaryStyle}
            >
              <Upload size={15} />
              <span>Thực Thi Import</span>
            </button>
          </div>
        </form>

        {/* Kết quả Import */}
        {importResult && (
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-surface)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={authBadgeStyle('var(--primary)', 'var(--primary-light)')}>
                Tổng dòng: {importResult.totalRows}
              </span>
              <span style={authBadgeStyle('#10B981', 'rgba(16, 185, 129, 0.14)')}>
                Thành công: {importResult.importedCount}
              </span>
              <span style={authBadgeStyle('#F59E0B', 'rgba(245, 158, 11, 0.14)')}>
                Bỏ qua: {importResult.skippedCount}
              </span>
              <span style={authBadgeStyle('#EF4444', 'rgba(239, 68, 68, 0.14)')}>
                Lỗi: {importResult.failedCount}
              </span>
            </div>
            {importResult.errors.length > 0 && (
              <div style={{ maxHeight: '140px', overflowY: 'auto', fontSize: '12px', color: '#EF4444' }}>
                {importResult.errors.map((err, i) => (
                  <div key={i}>
                    • Dòng {err.row} ({err.identifier}): {err.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

