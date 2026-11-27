import React, { useState } from 'react';
import { authStyles } from '../auth-ui.styles';
import type {
  DataClassificationItem,
  DataClassificationLevel,
  RetentionAction,
  SensitiveFieldItem,
  SensitiveMaskStrategy,
} from '../../types/data-governance.types';

interface Props {
  readonly busy: boolean;
  readonly classifications: readonly DataClassificationItem[];
  readonly sensitiveFields: readonly SensitiveFieldItem[];
  readonly onUpsertClassification: (payload: {
    dataTypeCode: string;
    displayName: string;
    moduleName: string;
    classificationLevel: DataClassificationLevel;
    containsPii: boolean;
    retentionDays: number;
    retentionAction: RetentionAction;
    legalBasis?: string;
  }) => Promise<void>;
  readonly onUpsertSensitiveField: (payload: {
    resourceType: string;
    fieldPath: string;
    displayName: string;
    classificationLevel: DataClassificationLevel;
    maskStrategy: SensitiveMaskStrategy;
    redactInLog: boolean;
    maskInExport: boolean;
    requiredPermission?: string;
  }) => Promise<void>;
  readonly onRunRetentionSweep: (dryRun: boolean) => Promise<void>;
}

function levelBadge(level: DataClassificationLevel): React.CSSProperties {
  switch (level) {
    case 'PUBLIC':
      return authStyles.badgeSuccess;
    case 'INTERNAL':
      return authStyles.badgePrimary;
    case 'CONFIDENTIAL':
      return authStyles.badgeWarning;
    case 'RESTRICTED':
      return authStyles.badgeDanger;
  }
}

export const ClassificationAndSensitiveSection: React.FC<Props> = ({
  busy,
  classifications,
  sensitiveFields,
  onUpsertClassification,
  onUpsertSensitiveField,
  onRunRetentionSweep,
}) => {
  const [dataTypeCode, setDataTypeCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [moduleName, setModuleName] = useState('users');
  const [classificationLevel, setClassificationLevel] =
    useState<DataClassificationLevel>('CONFIDENTIAL');
  const [containsPii, setContainsPii] = useState(true);
  const [retentionDays, setRetentionDays] = useState(365);
  const [retentionAction, setRetentionAction] = useState<RetentionAction>('ANONYMIZE');

  const [resourceType, setResourceType] = useState('users');
  const [fieldPath, setFieldPath] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldLevel, setFieldLevel] = useState<DataClassificationLevel>('CONFIDENTIAL');
  const [maskStrategy, setMaskStrategy] = useState<SensitiveMaskStrategy>('PARTIAL');
  const [redactInLog, setRedactInLog] = useState(true);
  const [maskInExport, setMaskInExport] = useState(true);
  const [requiredPermission, setRequiredPermission] = useState('data-governance.sensitive.read');

  const handleSaveClassification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dataTypeCode.trim() || !displayName.trim()) return;
    await onUpsertClassification({
      dataTypeCode: dataTypeCode.trim(),
      displayName: displayName.trim(),
      moduleName: moduleName.trim(),
      classificationLevel,
      containsPii,
      retentionDays: Number(retentionDays),
      retentionAction,
    });
    setDataTypeCode('');
    setDisplayName('');
  };

  const handleSaveSensitiveField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resourceType.trim() || !fieldPath.trim() || !fieldLabel.trim()) return;
    await onUpsertSensitiveField({
      resourceType: resourceType.trim(),
      fieldPath: fieldPath.trim(),
      displayName: fieldLabel.trim(),
      classificationLevel: fieldLevel,
      maskStrategy,
      redactInLog,
      maskInExport,
      requiredPermission: requiredPermission.trim() || undefined,
    });
    setFieldPath('');
    setFieldLabel('');
  };

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <div style={authStyles.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            marginBottom: '12px',
          }}
        >
          <div>
            <h3 style={authStyles.sectionTitle}>
              Phân loại dữ liệu (Public / Internal / Confidential / Restricted) & Thời gian lưu (Retention)
            </h3>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Thiết lập cấp độ bảo mật và chính sách lưu trữ theo từng loại dữ liệu (tự động bỏ qua bản ghi đang bị Legal Hold).
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              style={authStyles.btnSecondary}
              disabled={busy}
              onClick={() => void onRunRetentionSweep(true)}
            >
              Chạy thử Retention (Dry-run)
            </button>
            <button
              type="button"
              style={authStyles.btnTeal}
              disabled={busy}
              onClick={() => void onRunRetentionSweep(false)}
            >
              Thực thi Retention ngay
            </button>
          </div>
        </div>

        <form
          onSubmit={(e) => void handleSaveClassification(e)}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '10px',
            marginBottom: '16px',
          }}
        >
          <input
            style={authStyles.input}
            placeholder="Mã loại dữ liệu (vd: hr.contracts)"
            value={dataTypeCode}
            onChange={(e) => setDataTypeCode(e.target.value)}
          />
          <input
            style={authStyles.input}
            placeholder="Tên hiển thị"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <input
            style={authStyles.input}
            placeholder="Module (vd: users)"
            value={moduleName}
            onChange={(e) => setModuleName(e.target.value)}
          />
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
          <input
            type="number"
            min={0}
            style={authStyles.input}
            placeholder="Số ngày lưu (0 = giữ lâu dài)"
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
          />
          <select
            style={authStyles.input}
            value={retentionAction}
            onChange={(e) => setRetentionAction(e.target.value as RetentionAction)}
          >
            <option value="PURGE">PURGE (Xóa)</option>
            <option value="ANONYMIZE">ANONYMIZE (Ẩn danh)</option>
            <option value="ARCHIVE">ARCHIVE (Lưu trữ)</option>
            <option value="RETAIN_LEGAL">RETAIN_LEGAL (Giữ theo luật)</option>
          </select>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: 'var(--text-main)',
            }}
          >
            <input
              type="checkbox"
              checked={containsPii}
              onChange={(e) => setContainsPii(e.target.checked)}
            />
            Chứa dữ liệu cá nhân (PII)
          </label>
          <button type="submit" style={authStyles.btnPrimary} disabled={busy}>
            Lưu phân loại & Retention
          </button>
        </form>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Loại dữ liệu</th>
                <th style={authStyles.tableHeaderCell}>Module</th>
                <th style={authStyles.tableHeaderCell}>Phân loại</th>
                <th style={authStyles.tableHeaderCell}>PII</th>
                <th style={authStyles.tableHeaderCell}>Thời gian lưu</th>
                <th style={authStyles.tableHeaderCell}>Hành động hết hạn</th>
              </tr>
            </thead>
            <tbody>
              {classifications.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...authStyles.tableCell, color: 'var(--text-muted)' }}>
                    Chưa có danh mục phân loại dữ liệu.
                  </td>
                </tr>
              ) : (
                classifications.map((c) => (
                  <tr key={c.id}>
                    <td style={authStyles.tableCell}>
                      <strong>{c.dataTypeCode}</strong>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {c.displayName}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>{c.moduleName}</td>
                    <td style={authStyles.tableCell}>
                      <span style={levelBadge(c.classificationLevel)}>{c.classificationLevel}</span>
                    </td>
                    <td style={authStyles.tableCell}>{c.containsPii ? 'Có' : 'Không'}</td>
                    <td style={authStyles.tableCell}>
                      {c.retentionDays === 0 ? 'Không giới hạn' : `${c.retentionDays} ngày`}
                    </td>
                    <td style={authStyles.tableCell}>{c.retentionAction}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          Đánh dấu trường dữ liệu nhạy cảm (Áp dụng cho Log, Export & Phân quyền)
        </h3>
        <p style={authStyles.sectionDesc}>
          Các trường bật <code>redactInLog</code> được đồng bộ trực tiếp vào bộ lọc Log; các trường bật{' '}
          <code>maskInExport</code> tự động che trong tệp CSV xuất ra nếu thiếu quyền đọc nhạy cảm.
        </p>

        <form
          onSubmit={(e) => void handleSaveSensitiveField(e)}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '10px',
            marginBottom: '16px',
          }}
        >
          <input
            style={authStyles.input}
            placeholder="Resource (vd: users hoặc *)"
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
          />
          <input
            style={authStyles.input}
            placeholder="Tên trường (vd: identityNumber)"
            value={fieldPath}
            onChange={(e) => setFieldPath(e.target.value)}
          />
          <input
            style={authStyles.input}
            placeholder="Nhãn hiển thị"
            value={fieldLabel}
            onChange={(e) => setFieldLabel(e.target.value)}
          />
          <select
            style={authStyles.input}
            value={fieldLevel}
            onChange={(e) => setFieldLevel(e.target.value as DataClassificationLevel)}
          >
            <option value="CONFIDENTIAL">CONFIDENTIAL</option>
            <option value="RESTRICTED">RESTRICTED</option>
            <option value="INTERNAL">INTERNAL</option>
          </select>
          <select
            style={authStyles.input}
            value={maskStrategy}
            onChange={(e) => setMaskStrategy(e.target.value as SensitiveMaskStrategy)}
          >
            <option value="FULL">FULL (••••••••)</option>
            <option value="PARTIAL">PARTIAL (Giữ đầu/cuối)</option>
            <option value="EMAIL">EMAIL (u***@domain)</option>
            <option value="PHONE">PHONE (Che số giữa)</option>
            <option value="HASH">HASH (SHA-256)</option>
          </select>
          <input
            style={authStyles.input}
            placeholder="Quyền xem gốc (requiredPermission)"
            value={requiredPermission}
            onChange={(e) => setRequiredPermission(e.target.value)}
          />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: 'var(--text-main)',
            }}
          >
            <input
              type="checkbox"
              checked={redactInLog}
              onChange={(e) => setRedactInLog(e.target.checked)}
            />
            Che trong Log
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: 'var(--text-main)',
            }}
          >
            <input
              type="checkbox"
              checked={maskInExport}
              onChange={(e) => setMaskInExport(e.target.checked)}
            />
            Che khi Export
          </label>
          <button type="submit" style={authStyles.btnPrimary} disabled={busy}>
            Đánh dấu trường nhạy cảm
          </button>
        </form>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Tài nguyên / Trường</th>
                <th style={authStyles.tableHeaderCell}>Mức độ</th>
                <th style={authStyles.tableHeaderCell}>Kiểu che</th>
                <th style={authStyles.tableHeaderCell}>Log / Export</th>
                <th style={authStyles.tableHeaderCell}>Quyền xem đầy đủ</th>
              </tr>
            </thead>
            <tbody>
              {sensitiveFields.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...authStyles.tableCell, color: 'var(--text-muted)' }}>
                    Chưa có trường dữ liệu nhạy cảm nào.
                  </td>
                </tr>
              ) : (
                sensitiveFields.map((f) => (
                  <tr key={f.id}>
                    <td style={authStyles.tableCell}>
                      <strong>
                        {f.resourceType}.{f.fieldPath}
                      </strong>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {f.displayName}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={levelBadge(f.classificationLevel)}>{f.classificationLevel}</span>
                    </td>
                    <td style={authStyles.tableCell}>{f.maskStrategy}</td>
                    <td style={authStyles.tableCell}>
                      {f.redactInLog ? 'Log: Có' : 'Log: Không'} ·{' '}
                      {f.maskInExport ? 'Export: Có' : 'Export: Không'}
                    </td>
                    <td style={authStyles.tableCell}>{f.requiredPermission || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
