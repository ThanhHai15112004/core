import React, { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { complianceApi } from '../../services/compliance.api';
import { authStyles } from '../auth-ui.styles';
import type { ComplianceReportResultItem, VendorCategory } from '../../types/compliance.types';

interface Props {
  readonly accessToken: string;
  readonly busy: boolean;
  readonly reportResult: ComplianceReportResultItem | null;
  readonly onGenerateReport: (payload: {
    frameworkTag?: string;
    domain?: string;
    vendorCategory?: VendorCategory;
    format: 'json' | 'csv' | 'xlsx' | 'pdf';
  }) => Promise<void>;
}

export const ComplianceReportSection: React.FC<Props> = ({
  accessToken,
  busy,
  reportResult,
  onGenerateReport,
}) => {
  const [frameworkTag, setFrameworkTag] = useState('');
  const [domain, setDomain] = useState('');
  const [vendorCategory, setVendorCategory] = useState<string>('');
  const [format, setFormat] = useState<'json' | 'csv' | 'xlsx' | 'pdf'>('xlsx');

  const handleDownload = async () => {
    if (!reportResult?.downloadToken) return;
    const data = await complianceApi.downloadReportArtifact(
      accessToken,
      reportResult.downloadToken,
    );
    let blob: Blob | null = null;
    if (data.csvContent) {
      blob = new Blob([data.csvContent], { type: data.contentType });
    } else if (data.xlsxBase64 || data.pdfBase64) {
      const b64 = data.xlsxBase64 ?? data.pdfBase64 ?? '';
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      blob = new Blob([bytes], { type: data.contentType });
    }
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={authStyles.card}>
        <h4 style={authStyles.sectionTitle}>
          <FileSpreadsheet size={16} /> Tạo báo cáo Compliance (Trung lập đa tiêu chuẩn)
        </h4>
        <p style={authStyles.sectionDesc}>
          Tổng hợp Controls, Bằng chứng, Lịch sử kiểm tra, Nhà cung cấp, Đánh giá dữ liệu & Phương
          án dự phòng — có thể lọc theo bất kỳ framework tag nào (ISO27001, SOC2, GDPR, INTERNAL)
          hoặc để trống để xem toàn bộ.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '10px',
            marginBottom: '12px',
          }}
        >
          <input
            style={authStyles.input}
            placeholder="Framework tag (tùy chọn)"
            value={frameworkTag}
            onChange={(e) => setFrameworkTag(e.target.value)}
          />
          <input
            style={authStyles.input}
            placeholder="Domain (tùy chọn)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <select
            style={authStyles.input}
            value={vendorCategory}
            onChange={(e) => setVendorCategory(e.target.value)}
          >
            <option value="">Tất cả loại Vendor</option>
            <option value="EMAIL">EMAIL</option>
            <option value="SMS">SMS</option>
            <option value="CLOUD">CLOUD</option>
            <option value="PAYMENT">PAYMENT</option>
            <option value="AI">AI</option>
            <option value="OTHER">OTHER</option>
          </select>
          <select
            style={authStyles.input}
            value={format}
            onChange={(e) => setFormat(e.target.value as 'json' | 'csv' | 'xlsx' | 'pdf')}
          >
            <option value="xlsx">XLSX</option>
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
            <option value="json">JSON</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={busy}
            style={authStyles.btnPrimary}
            onClick={() => {
              void onGenerateReport({
                frameworkTag: frameworkTag.trim() || undefined,
                domain: domain.trim() || undefined,
                vendorCategory: vendorCategory ? (vendorCategory as VendorCategory) : undefined,
                format,
              });
            }}
          >
            Tạo báo cáo Compliance
          </button>
          {reportResult?.downloadToken && (
            <button
              type="button"
              style={authStyles.btnTeal}
              onClick={() => void handleDownload()}
            >
              <Download size={14} /> Tải file ({reportResult.fileName})
            </button>
          )}
        </div>
      </div>

      {reportResult && (
        <div style={authStyles.card}>
          <h4 style={authStyles.sectionTitle}>Kết quả tổng hợp ({reportResult.reportCode})</h4>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: '10px',
              marginBottom: '14px',
            }}
          >
            <div style={authStyles.codeBox}>
              <div>Tỷ lệ đạt Control</div>
              <strong>{reportResult.summary.passRatePercent}%</strong>
            </div>
            <div style={authStyles.codeBox}>
              <div>Controls quá hạn</div>
              <strong>{reportResult.summary.overdueControls}</strong>
            </div>
            <div style={authStyles.codeBox}>
              <div>Thiếu bằng chứng hợp lệ</div>
              <strong>{reportResult.summary.controlsWithoutValidEvidence}</strong>
            </div>
            <div style={authStyles.codeBox}>
              <div>Vendor thiếu Fallback</div>
              <strong>{reportResult.summary.vendorsMissingFallback}</strong>
            </div>
            <div style={authStyles.codeBox}>
              <div>HĐ sắp/đã hết hạn</div>
              <strong>{reportResult.summary.expiringOrExpiredContracts}</strong>
            </div>
            <div style={authStyles.codeBox}>
              <div>Đánh giá rủi ro cao</div>
              <strong>{reportResult.summary.highOrCriticalAssessments}</strong>
            </div>
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
            Tổng dòng dữ liệu xuất: {reportResult.rows.length} • Thời điểm:{' '}
            {reportResult.generatedAt}
          </div>
        </div>
      )}
    </div>
  );
};
