import React, { useState } from 'react';
import { Building2, ShieldAlert } from 'lucide-react';
import { authStyles } from '../auth-ui.styles';
import type {
  AssessmentApprovalStatus,
  ComplianceRiskLevel,
  ComplianceVendorItem,
  ControlFrequency,
  DataFlowDirection,
  VendorCategory,
  VendorDataAssessmentItem,
} from '../../types/compliance.types';
import type { DataClassificationLevel } from '../../types/data-governance.types';

interface Props {
  readonly busy: boolean;
  readonly vendors: readonly ComplianceVendorItem[];
  readonly selectedVendorId: number | null;
  readonly assessments: readonly VendorDataAssessmentItem[];
  readonly onSelectVendor: (vendorId: number) => Promise<void>;
  readonly onCreateVendor: (payload: {
    name: string;
    category: VendorCategory;
    criticality: ComplianceRiskLevel;
    contractEndDate?: string | null;
    reviewFrequency: ControlFrequency;
    dpaSigned: boolean;
    fallbackVendorName?: string;
    fallbackStrategy?: string;
    migrationRunbook?: string;
    rtoHours?: number | null;
  }) => Promise<void>;
  readonly onCreateAssessment: (
    vendorId: number,
    payload: {
      dataCategory: string;
      classificationLevel: DataClassificationLevel;
      allowedDataFields: string[];
      prohibitedDataFields: string[];
      processingPurpose: string;
      dataFlowDirection: DataFlowDirection;
      storageRegions: string[];
      crossBorderTransfer: boolean;
      transferMechanism?: string;
      riskLevel: ComplianceRiskLevel;
      approvalStatus: AssessmentApprovalStatus;
    },
  ) => Promise<void>;
}

export const VendorsAndAssessmentsSection: React.FC<Props> = ({
  busy,
  vendors,
  selectedVendorId,
  assessments,
  onSelectVendor,
  onCreateVendor,
  onCreateAssessment,
}) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<VendorCategory>('AI');
  const [criticality, setCriticality] = useState<ComplianceRiskLevel>('HIGH');
  const [contractEnd, setContractEnd] = useState('');
  const [reviewFreq, setReviewFreq] = useState<ControlFrequency>('QUARTERLY');
  const [dpaSigned, setDpaSigned] = useState(true);
  const [fallbackName, setFallbackName] = useState('');
  const [fallbackStrategy, setFallbackStrategy] = useState('');

  const [dataCategory, setDataCategory] = useState('');
  const [classificationLevel, setClassificationLevel] =
    useState<DataClassificationLevel>('CONFIDENTIAL');
  const [allowedFieldsCsv, setAllowedFieldsCsv] = useState('email, fullName');
  const [prohibitedFieldsCsv, setProhibitedFieldsCsv] = useState('passwordHash, identityNumber');
  const [purpose, setPurpose] = useState('');
  const [regionsCsv, setRegionsCsv] = useState('ap-southeast-1');
  const [crossBorder, setCrossBorder] = useState(true);
  const [riskLevel, setRiskLevel] = useState<ComplianceRiskLevel>('MEDIUM');

  const activeVendorId = selectedVendorId ?? vendors[0]?.id ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
          gap: '16px',
        }}
      >
        <div style={authStyles.card}>
          <h4 style={authStyles.sectionTitle}>
            <Building2 size={16} /> Thêm nhà cung cấp & Phương án dự phòng
          </h4>
          <p style={authStyles.sectionDesc}>
            Quản lý nhà cung cấp (Email, SMS, Cloud, Payment, AI), thời hạn hợp đồng, rà soát định
            kỳ và phương án thay thế.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input
              style={authStyles.input}
              placeholder="Tên nhà cung cấp (VD: OpenAI Enterprise)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              <select
                style={authStyles.input}
                value={category}
                onChange={(e) => setCategory(e.target.value as VendorCategory)}
              >
                <option value="EMAIL">EMAIL</option>
                <option value="SMS">SMS</option>
                <option value="CLOUD">CLOUD</option>
                <option value="PAYMENT">PAYMENT</option>
                <option value="AI">AI</option>
                <option value="OTHER">OTHER</option>
              </select>
              <select
                style={authStyles.input}
                value={criticality}
                onChange={(e) => setCriticality(e.target.value as ComplianceRiskLevel)}
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
              <select
                style={authStyles.input}
                value={reviewFreq}
                onChange={(e) => setReviewFreq(e.target.value as ControlFrequency)}
              >
                <option value="MONTHLY">MONTHLY</option>
                <option value="QUARTERLY">QUARTERLY</option>
                <option value="SEMI_ANNUAL">SEMI_ANNUAL</option>
                <option value="ANNUAL">ANNUAL</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <input
                style={authStyles.input}
                type="date"
                title="Ngày hết hạn hợp đồng"
                value={contractEnd}
                onChange={(e) => setContractEnd(e.target.value)}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={dpaSigned}
                  onChange={(e) => setDpaSigned(e.target.checked)}
                />
                Đã ký DPA bảo vệ dữ liệu
              </label>
            </div>
            <input
              style={authStyles.input}
              placeholder="Nhà cung cấp dự phòng / thay thế..."
              value={fallbackName}
              onChange={(e) => setFallbackName(e.target.value)}
            />
            <input
              style={authStyles.input}
              placeholder="Phương án chuyển đổi dự phòng..."
              value={fallbackStrategy}
              onChange={(e) => setFallbackStrategy(e.target.value)}
            />
            <button
              type="button"
              disabled={busy || !name.trim()}
              style={authStyles.btnPrimary}
              onClick={() => {
                void onCreateVendor({
                  name: name.trim(),
                  category,
                  criticality,
                  contractEndDate: contractEnd ? new Date(contractEnd).toISOString() : null,
                  reviewFrequency: reviewFreq,
                  dpaSigned,
                  fallbackVendorName: fallbackName.trim() || undefined,
                  fallbackStrategy: fallbackStrategy.trim() || undefined,
                }).then(() => {
                  setName('');
                  setFallbackName('');
                  setFallbackStrategy('');
                });
              }}
            >
              Thêm nhà cung cấp
            </button>
          </div>
        </div>

        <div style={authStyles.card}>
          <h4 style={authStyles.sectionTitle}>
            <ShieldAlert size={16} /> Đánh giá dữ liệu nhà cung cấp được phép xử lý
          </h4>
          <p style={authStyles.sectionDesc}>
            Xác định dữ liệu nào được gửi đi đâu, vùng lưu trữ, chuyển xuyên biên giới và trường bị
            cấm chia sẻ.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <select
              style={authStyles.input}
              value={activeVendorId ?? ''}
              onChange={(e) => {
                const id = Number(e.target.value);
                if (id > 0) void onSelectVendor(id);
              }}
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vendorCode} — {v.name} ({v.category})
                </option>
              ))}
            </select>
            <input
              style={authStyles.input}
              placeholder="Nhóm dữ liệu (VD: User Contact PII)"
              value={dataCategory}
              onChange={(e) => setDataCategory(e.target.value)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <select
                style={authStyles.input}
                value={classificationLevel}
                onChange={(e) => setClassificationLevel(e.target.value as DataClassificationLevel)}
              >
                <option value="PUBLIC">PUBLIC</option>
                <option value="INTERNAL">INTERNAL</option>
                <option value="CONFIDENTIAL">CONFIDENTIAL</option>
                <option value="RESTRICTED">RESTRICTED</option>
              </select>
              <select
                style={authStyles.input}
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as ComplianceRiskLevel)}
              >
                <option value="LOW">Risk: LOW</option>
                <option value="MEDIUM">Risk: MEDIUM</option>
                <option value="HIGH">Risk: HIGH</option>
                <option value="CRITICAL">Risk: CRITICAL</option>
              </select>
            </div>
            <input
              style={authStyles.input}
              placeholder="Trường được phép (cách nhau dấu phẩy)"
              value={allowedFieldsCsv}
              onChange={(e) => setAllowedFieldsCsv(e.target.value)}
            />
            <input
              style={authStyles.input}
              placeholder="Trường CẤM gửi (cách nhau dấu phẩy)"
              value={prohibitedFieldsCsv}
              onChange={(e) => setProhibitedFieldsCsv(e.target.value)}
            />
            <input
              style={authStyles.input}
              placeholder="Mục đích xử lý dữ liệu..."
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <input
                style={authStyles.input}
                placeholder="Vùng lưu trữ (ap-southeast-1)"
                value={regionsCsv}
                onChange={(e) => setRegionsCsv(e.target.value)}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={crossBorder}
                  onChange={(e) => setCrossBorder(e.target.checked)}
                />
                Chuyển dữ liệu xuyên biên giới
              </label>
            </div>
            <button
              type="button"
              disabled={busy || !activeVendorId || !dataCategory.trim() || !purpose.trim()}
              style={authStyles.btnTeal}
              onClick={() => {
                if (!activeVendorId) return;
                void onCreateAssessment(activeVendorId, {
                  dataCategory: dataCategory.trim(),
                  classificationLevel,
                  allowedDataFields: allowedFieldsCsv
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  prohibitedDataFields: prohibitedFieldsCsv
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  processingPurpose: purpose.trim(),
                  dataFlowDirection: 'OUTBOUND',
                  storageRegions: regionsCsv
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  crossBorderTransfer: crossBorder,
                  riskLevel,
                  approvalStatus: 'APPROVED',
                }).then(() => {
                  setDataCategory('');
                  setPurpose('');
                });
              }}
            >
              Lưu đánh giá dữ liệu
            </button>
          </div>
        </div>
      </div>

      {/* Vendors Table */}
      <div style={authStyles.card}>
        <h4 style={authStyles.sectionTitle}>Danh sách nhà cung cấp ({vendors.length})</h4>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Mã / Tên</th>
                <th style={authStyles.tableHeaderCell}>Nhóm</th>
                <th style={authStyles.tableHeaderCell}>Hợp đồng & Rà soát</th>
                <th style={authStyles.tableHeaderCell}>DPA</th>
                <th style={authStyles.tableHeaderCell}>Phương án dự phòng / Thay thế</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => void onSelectVendor(v.id)}
                  style={{
                    cursor: 'pointer',
                    background:
                      activeVendorId === v.id ? 'var(--bg-light-blue)' : 'transparent',
                  }}
                >
                  <td style={authStyles.tableCell}>
                    <strong>{v.name}</strong>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {v.vendorCode} • {v.criticality}
                    </div>
                  </td>
                  <td style={authStyles.tableCell}>
                    <span style={authStyles.badgePrimary}>{v.category}</span>
                  </td>
                  <td style={authStyles.tableCell}>
                    <div>
                      HĐ:{' '}
                      {v.contractEndDate ? v.contractEndDate.slice(0, 10) : '—'}{' '}
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        ({v.contractDueStatus})
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Rà soát: {v.nextReviewDueAt ? v.nextReviewDueAt.slice(0, 10) : '—'} (
                      {v.reviewDueStatus})
                    </div>
                  </td>
                  <td style={authStyles.tableCell}>
                    <span style={v.dpaSigned ? authStyles.badgeSuccess : authStyles.badgeWarning}>
                      {v.dpaSigned ? 'Đã ký DPA' : 'Chưa DPA'}
                    </span>
                  </td>
                  <td style={authStyles.tableCell}>
                    {v.hasFallbackPlan ? (
                      <div>
                        <strong>{v.fallbackVendorName ?? 'Có phương án'}</strong>
                        {v.rtoHours !== null && (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {' '}
                            (RTO {v.rtoHours}h)
                          </span>
                        )}
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {v.fallbackStrategy}
                        </div>
                      </div>
                    ) : (
                      <span style={authStyles.badgeDanger}>Thiếu phương án dự phòng</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Data assessments for selected vendor */}
      <div style={authStyles.card}>
        <h4 style={authStyles.sectionTitle}>
          Đánh giá dữ liệu của nhà cung cấp đang chọn ({assessments.length})
        </h4>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Nhóm dữ liệu</th>
                <th style={authStyles.tableHeaderCell}>Phân loại</th>
                <th style={authStyles.tableHeaderCell}>Được phép / Cấm</th>
                <th style={authStyles.tableHeaderCell}>Vùng & Xuyên biên giới</th>
                <th style={authStyles.tableHeaderCell}>Rủi ro / Duyệt</th>
              </tr>
            </thead>
            <tbody>
              {assessments.map((a) => (
                <tr key={a.id}>
                  <td style={authStyles.tableCell}>
                    <strong>{a.dataCategory}</strong>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {a.processingPurpose}
                    </div>
                  </td>
                  <td style={authStyles.tableCell}>
                    <span style={authStyles.badgeWarning}>{a.classificationLevel}</span>
                  </td>
                  <td style={authStyles.tableCell}>
                    <div style={{ fontSize: '12px' }}>
                      <strong>Cho phép:</strong> {a.allowedDataFields.join(', ') || '—'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--status-danger)' }}>
                      <strong>Cấm:</strong> {a.prohibitedDataFields.join(', ') || '—'}
                    </div>
                  </td>
                  <td style={authStyles.tableCell}>
                    {a.storageRegions.join(', ') || '—'}{' '}
                    {a.crossBorderTransfer ? '(Cross-border)' : '(Nội địa)'}
                  </td>
                  <td style={authStyles.tableCell}>
                    <span
                      style={
                        a.riskLevel === 'HIGH' || a.riskLevel === 'CRITICAL'
                          ? authStyles.badgeDanger
                          : authStyles.badgeSuccess
                      }
                    >
                      {a.riskLevel}
                    </span>{' '}
                    <span style={authStyles.badgePrimary}>{a.approvalStatus}</span>
                  </td>
                </tr>
              ))}
              {assessments.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...authStyles.tableCell, textAlign: 'center' }}>
                    Chưa có đánh giá dữ liệu cho nhà cung cấp này.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
