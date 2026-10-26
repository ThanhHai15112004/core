import React, { useState } from 'react';
import { Download, FileSpreadsheet, FolderTree, ListFilter, Upload, X } from 'lucide-react';
import {
  authBadgeStyle,
  authBtnPrimaryStyle,
  authBtnSecondaryStyle,
  authCardStyle,
  authInputStyle,
  authLabelStyle,
} from '../../auth/components/auth-ui.styles';
import type {
  BulkImportOrganizationsPayload,
  BulkImportOrganizationsResult,
} from '../types/organizations.types';

interface OrgImportExportModalProps {
  submitting: boolean;
  importResult: BulkImportOrganizationsResult | null;
  onClose: () => void;
  onExportUnits: (format: 'csv' | 'xlsx', mode: 'tree' | 'list') => Promise<void>;
  onDownloadTemplate: (format: 'csv' | 'xlsx') => Promise<void>;
  onBulkImport: (
    payload: BulkImportOrganizationsPayload,
  ) => Promise<BulkImportOrganizationsResult | null>;
}

export const OrgImportExportModal: React.FC<OrgImportExportModalProps> = ({
  submitting,
  importResult,
  onClose,
  onExportUnits,
  onDownloadTemplate,
  onBulkImport,
}) => {
  const [exportMode, setExportMode] = useState<'tree' | 'list'>('tree');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [updateExisting, setUpdateExisting] = useState(false);
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
          binary += String.fromCharCode(bytes[i]!);
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
      csvContent: csvText.trim() || undefined,
      xlsxBase64: xlsxBase64 || undefined,
      skipDuplicates,
      updateExisting,
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
          maxWidth: '760px',
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
              Import & Export Sơ Đồ Cây Tổ Chức (Excel .XLSX & CSV)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Khu vực 1: Export danh sách tổ chức theo dạng cây hoặc danh sách */}
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
            1. Xuất Danh Sách Tổ Chức (Theo Dạng Cây Phân Cấp hoặc Danh Sách Phẳng)
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Chế độ kết xuất:
            </span>
            <button
              type="button"
              onClick={() => setExportMode('tree')}
              style={exportMode === 'tree' ? authBtnPrimaryStyle : authBtnSecondaryStyle}
            >
              <FolderTree size={14} />
              <span>Theo Dạng Cây Phân Cấp (Tree)</span>
            </button>
            <button
              type="button"
              onClick={() => setExportMode('list')}
              style={exportMode === 'list' ? authBtnPrimaryStyle : authBtnSecondaryStyle}
            >
              <ListFilter size={14} />
              <span>Theo Danh Sách Phẳng (List)</span>
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onExportUnits('xlsx', exportMode)}
              style={authBtnPrimaryStyle}
            >
              <FileSpreadsheet size={14} />
              <span>
                Xuất Excel .XLSX ({exportMode === 'tree' ? 'Dạng Cây' : 'Danh Sách'})
              </span>
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onExportUnits('csv', exportMode)}
              style={authBtnSecondaryStyle}
            >
              <Download size={14} />
              <span>
                Xuất CSV ({exportMode === 'tree' ? 'Dạng Cây' : 'Danh Sách'})
              </span>
            </button>
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
          </div>
        </div>

        {/* Khu vực 2: Import cây tổ chức */}
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
            2. Nhập Cây Tổ Chức Từ File (.XLSX / .CSV) — Tự Động Kiểm Tra Đơn Vị Cha & Mã Trùng
          </div>

          <div>
            <label style={authLabelStyle}>Chọn tệp bảng tính (.xlsx hoặc .csv)</label>
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

          <div>
            <label style={authLabelStyle}>
              Hoặc dán trực tiếp nội dung CSV (Hỗ trợ tự động sắp xếp thứ tự Cha → Con):
            </label>
            <textarea
              rows={5}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setXlsxBase64(null);
              }}
              placeholder={
                'Mã đơn vị,Tên đơn vị,Loại đơn vị,Mã đơn vị cấp trên,Người phụ trách,Trạng thái,Mô tả\nBRANCH_DANANG,Chi nhánh Đà Nẵng,BRANCH,HQ_HCM,director_hcm,ACTIVE,Chi nhánh Miền Trung\nDEPT_AI_DN,Phòng AI Đà Nẵng,DEPARTMENT,BRANCH_DANANG,manager_eng,ACTIVE,Phòng R&D AI'
              }
              style={{ ...authInputStyle, fontFamily: 'monospace', fontSize: '12px' }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12.5px',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                />
                <span>Bỏ qua mã trùng (skipDuplicates)</span>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12.5px',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={updateExisting}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                />
                <span>Cập nhật nếu mã đã tồn tại (updateExisting)</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting || (!csvText.trim() && !xlsxBase64)}
              style={authBtnPrimaryStyle}
            >
              <Upload size={15} />
              <span>Thực Thi Import Cây Tổ Chức</span>
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
                Tạo mới: {importResult.importedCount}
              </span>
              <span style={authBadgeStyle('#3B82F6', 'rgba(59, 130, 246, 0.14)')}>
                Cập nhật: {importResult.updatedCount}
              </span>
              <span style={authBadgeStyle('#F59E0B', 'rgba(245, 158, 11, 0.14)')}>
                Bỏ qua: {importResult.skippedCount}
              </span>
              <span style={authBadgeStyle('#EF4444', 'rgba(239, 68, 68, 0.14)')}>
                Lỗi: {importResult.failedCount}
              </span>
            </div>
            {importResult.errors.length > 0 && (
              <div
                style={{
                  maxHeight: '140px',
                  overflowY: 'auto',
                  fontSize: '12px',
                  color: '#EF4444',
                }}
              >
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
