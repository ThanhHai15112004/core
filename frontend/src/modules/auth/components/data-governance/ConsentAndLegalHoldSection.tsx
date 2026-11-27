import React, { useState } from 'react';
import { authStyles } from '../auth-ui.styles';
import type {
  ConsentDefinitionItem,
  DataClassificationLevel,
  LegalHoldItem,
  LegalHoldScopeType,
  UserConsentItem,
} from '../../types/data-governance.types';

interface Props {
  readonly busy: boolean;
  readonly definitions: readonly ConsentDefinitionItem[];
  readonly records: readonly UserConsentItem[];
  readonly legalHolds: readonly LegalHoldItem[];
  readonly onUpsertDefinition: (payload: {
    purposeCode: string;
    policyVersion: string;
    title: string;
    description: string;
    classificationLevel: DataClassificationLevel;
    isMandatory: boolean;
    validityDays?: number | null;
  }) => Promise<void>;
  readonly onGrantConsent: (purposeCode: string, userId?: number) => Promise<void>;
  readonly onWithdrawConsent: (
    purposeCode: string,
    reason?: string,
    userId?: number,
  ) => Promise<void>;
  readonly onCreateLegalHold: (payload: {
    title: string;
    caseReference?: string;
    reason: string;
    scopeType: LegalHoldScopeType;
    targetUserId?: number | null;
    dataTypeCode?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
  }) => Promise<void>;
  readonly onReleaseLegalHold: (id: number, reason: string) => Promise<void>;
}

export const ConsentAndLegalHoldSection: React.FC<Props> = ({
  busy,
  definitions,
  records,
  legalHolds,
  onUpsertDefinition,
  onGrantConsent,
  onWithdrawConsent,
  onCreateLegalHold,
  onReleaseLegalHold,
}) => {
  const [purposeCode, setPurposeCode] = useState('');
  const [policyVersion, setPolicyVersion] = useState('1.0');
  const [consentTitle, setConsentTitle] = useState('');
  const [consentDesc, setConsentDesc] = useState('');
  const [isMandatory, setIsMandatory] = useState(false);

  const [holdTitle, setHoldTitle] = useState('');
  const [caseRef, setCaseRef] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [scopeType, setScopeType] = useState<LegalHoldScopeType>('USER');
  const [targetUserId, setTargetUserId] = useState('');
  const [dataTypeCode, setDataTypeCode] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [releaseReason, setReleaseReason] = useState('Đã hoàn tất rà soát pháp lý');

  const handleSaveConsentDef = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purposeCode.trim() || !consentTitle.trim() || !consentDesc.trim()) return;
    await onUpsertDefinition({
      purposeCode: purposeCode.trim(),
      policyVersion: policyVersion.trim() || '1.0',
      title: consentTitle.trim(),
      description: consentDesc.trim(),
      classificationLevel: 'INTERNAL',
      isMandatory,
    });
    setPurposeCode('');
    setConsentTitle('');
    setConsentDesc('');
  };

  const handleCreateHold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holdTitle.trim() || !holdReason.trim()) return;
    await onCreateLegalHold({
      title: holdTitle.trim(),
      caseReference: caseRef.trim() || undefined,
      reason: holdReason.trim(),
      scopeType,
      targetUserId: scopeType === 'USER' && targetUserId ? Number(targetUserId) : null,
      dataTypeCode: scopeType === 'DATA_TYPE' ? dataTypeCode.trim() : null,
      resourceType: scopeType === 'RESOURCE' ? resourceType.trim() : null,
      resourceId: scopeType === 'RESOURCE' && resourceId.trim() ? resourceId.trim() : null,
    });
    setHoldTitle('');
    setCaseRef('');
    setHoldReason('');
  };

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          Quản lý sự đồng ý của người dùng (Consent — Mục đích, Phiên bản & Thời gian)
        </h3>
        <p style={authStyles.sectionDesc}>
          Theo dõi đầy đủ mục đích xử lý dữ liệu, phiên bản chính sách và thời điểm cấp/rút đồng ý. Các mục bắt buộc duy trì dịch vụ không cho rút trực tiếp.
        </p>

        <form
          onSubmit={(e) => void handleSaveConsentDef(e)}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '10px',
            marginBottom: '16px',
          }}
        >
          <input
            style={authStyles.input}
            placeholder="Mã mục đích (vd: ai_training)"
            value={purposeCode}
            onChange={(e) => setPurposeCode(e.target.value)}
          />
          <input
            style={authStyles.input}
            placeholder="Phiên bản (vd: 1.0)"
            value={policyVersion}
            onChange={(e) => setPolicyVersion(e.target.value)}
          />
          <input
            style={authStyles.input}
            placeholder="Tiêu đề mục đích"
            value={consentTitle}
            onChange={(e) => setConsentTitle(e.target.value)}
          />
          <input
            style={authStyles.input}
            placeholder="Mô tả chi tiết"
            value={consentDesc}
            onChange={(e) => setConsentDesc(e.target.value)}
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
              checked={isMandatory}
              onChange={(e) => setIsMandatory(e.target.checked)}
            />
            Bắt buộc (Mandatory)
          </label>
          <button type="submit" style={authStyles.btnPrimary} disabled={busy}>
            Phát hành phiên bản Consent
          </button>
        </form>

        <div style={{ overflowX: 'auto', marginBottom: '14px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Mục đích & Phiên bản</th>
                <th style={authStyles.tableHeaderCell}>Loại</th>
                <th style={authStyles.tableHeaderCell}>Thao tác cho tài khoản hiện tại</th>
              </tr>
            </thead>
            <tbody>
              {definitions.map((d) => (
                <tr key={d.id}>
                  <td style={authStyles.tableCell}>
                    <strong>
                      {d.purposeCode} (v{d.policyVersion})
                    </strong>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{d.title}</div>
                  </td>
                  <td style={authStyles.tableCell}>
                    <span style={d.isMandatory ? authStyles.badgeWarning : authStyles.badgePrimary}>
                      {d.isMandatory ? 'Bắt buộc' : 'Tùy chọn'}
                    </span>
                  </td>
                  <td style={authStyles.tableCell}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        style={authStyles.btnTeal}
                        disabled={busy}
                        onClick={() => void onGrantConsent(d.purposeCode)}
                      >
                        Đồng ý (Grant)
                      </button>
                      <button
                        type="button"
                        style={authStyles.btnDanger}
                        disabled={busy}
                        onClick={() =>
                          void onWithdrawConsent(d.purposeCode, 'Người dùng chủ động rút đồng ý')
                        }
                      >
                        Rút lại (Withdraw)
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {records.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>User</th>
                  <th style={authStyles.tableHeaderCell}>Mục đích / Phiên bản</th>
                  <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                  <th style={authStyles.tableHeaderCell}>Thời gian cấp / Rút lại</th>
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 10).map((r) => (
                  <tr key={r.id}>
                    <td style={authStyles.tableCell}>#{r.userId}</td>
                    <td style={authStyles.tableCell}>
                      {r.purposeCode} · v{r.policyVersion}
                    </td>
                    <td style={authStyles.tableCell}>
                      <span
                        style={
                          r.consentStatus === 'GRANTED'
                            ? authStyles.badgeSuccess
                            : authStyles.badgeWarning
                        }
                      >
                        {r.consentStatus}
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>
                      {new Date(r.grantedAt).toLocaleString()}
                      {r.withdrawnAt ? ` → Rút: ${new Date(r.withdrawnAt).toLocaleString()}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          Tạm giữ dữ liệu không được xóa (Legal Hold)
        </h3>
        <p style={authStyles.sectionDesc}>
          Khi đang bật Legal Hold, mọi thao tác xóa dữ liệu cá nhân (DSAR Erasure), lưu trữ/khóa xóa tài khoản (Archive User) và dọn Retention tự động đều bị chặn tuyệt đối.
        </p>

        <form
          onSubmit={(e) => void handleCreateHold(e)}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
            gap: '10px',
            marginBottom: '14px',
          }}
        >
          <input
            style={authStyles.input}
            placeholder="Tiêu đề lệnh tạm giữ"
            value={holdTitle}
            onChange={(e) => setHoldTitle(e.target.value)}
          />
          <input
            style={authStyles.input}
            placeholder="Mã hồ sơ / Vụ việc (Case Ref)"
            value={caseRef}
            onChange={(e) => setCaseRef(e.target.value)}
          />
          <select
            style={authStyles.input}
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value as LegalHoldScopeType)}
          >
            <option value="USER">USER — Theo người dùng</option>
            <option value="DATA_TYPE">DATA_TYPE — Theo loại dữ liệu</option>
            <option value="RESOURCE">RESOURCE — Theo bản ghi cụ thể</option>
          </select>
          {scopeType === 'USER' && (
            <input
              type="number"
              min={1}
              style={authStyles.input}
              placeholder="Target User ID (vd: 2)"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
            />
          )}
          {scopeType === 'DATA_TYPE' && (
            <input
              style={authStyles.input}
              placeholder="Mã loại dữ liệu (vd: exports.artifacts)"
              value={dataTypeCode}
              onChange={(e) => setDataTypeCode(e.target.value)}
            />
          )}
          {scopeType === 'RESOURCE' && (
            <>
              <input
                style={authStyles.input}
                placeholder="Resource type (vd: files)"
                value={resourceType}
                onChange={(e) => setResourceType(e.target.value)}
              />
              <input
                style={authStyles.input}
                placeholder="Resource ID"
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
              />
            </>
          )}
          <input
            style={authStyles.input}
            placeholder="Lý do pháp lý"
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
          />
          <button type="submit" style={authStyles.btnDanger} disabled={busy}>
            Áp đặt Legal Hold
          </button>
        </form>

        <div style={{ marginBottom: '12px' }}>
          <input
            style={{ ...authStyles.input, maxWidth: '380px' }}
            placeholder="Lý do khi giải phóng Legal Hold..."
            value={releaseReason}
            onChange={(e) => setReleaseReason(e.target.value)}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Mã Hold</th>
                <th style={authStyles.tableHeaderCell}>Phạm vi & Đối tượng</th>
                <th style={authStyles.tableHeaderCell}>Lý do</th>
                <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                <th style={authStyles.tableHeaderCell}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {legalHolds.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...authStyles.tableCell, color: 'var(--text-muted)' }}>
                    Hiện không có lệnh tạm giữ pháp lý nào.
                  </td>
                </tr>
              ) : (
                legalHolds.map((h) => (
                  <tr key={h.id}>
                    <td style={authStyles.tableCell}>
                      <strong>{h.holdCode}</strong>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{h.title}</div>
                    </td>
                    <td style={authStyles.tableCell}>
                      {h.scopeType} ·{' '}
                      {h.scopeType === 'USER'
                        ? `User #${h.targetUserId}`
                        : h.scopeType === 'DATA_TYPE'
                          ? h.dataTypeCode
                          : `${h.resourceType}:${h.resourceId ?? '*'}`}
                    </td>
                    <td style={authStyles.tableCell}>{h.reason}</td>
                    <td style={authStyles.tableCell}>
                      <span
                        style={
                          h.holdStatusName === 'ACTIVE'
                            ? authStyles.badgeDanger
                            : authStyles.badgeSuccess
                        }
                      >
                        {h.holdStatusName}
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>
                      {h.holdStatusName === 'ACTIVE' && (
                        <button
                          type="button"
                          style={authStyles.btnSecondary}
                          disabled={busy}
                          onClick={() => void onReleaseLegalHold(h.id, releaseReason)}
                        >
                          Giải phóng Hold
                        </button>
                      )}
                    </td>
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
