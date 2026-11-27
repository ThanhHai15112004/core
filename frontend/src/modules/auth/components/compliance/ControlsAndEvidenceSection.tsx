import React, { useState } from 'react';
import { ClipboardList, FileCheck2, History } from 'lucide-react';
import { authStyles } from '../auth-ui.styles';
import type {
  ComplianceCheckHistoryItem,
  ComplianceControlItem,
  ComplianceEvidenceItem,
  ControlCheckResult,
  ControlFrequency,
  EvidenceType,
} from '../../types/compliance.types';

interface Props {
  readonly busy: boolean;
  readonly controls: readonly ComplianceControlItem[];
  readonly evidences: readonly ComplianceEvidenceItem[];
  readonly checkHistories: readonly ComplianceCheckHistoryItem[];
  readonly onCreateControl: (payload: {
    title: string;
    description?: string;
    domain: string;
    frameworkTags: string[];
    ownerUserId?: number | null;
    frequency: ControlFrequency;
  }) => Promise<void>;
  readonly onRecordCheck: (
    controlId: number,
    payload: {
      result: ControlCheckResult;
      score?: number | null;
      findings?: string;
      remediationPlan?: string;
    },
  ) => Promise<void>;
  readonly onCreateEvidence: (payload: {
    controlId: number;
    evidenceType: EvidenceType;
    title: string;
    description?: string;
    fileId?: number | null;
    auditLogId?: number | null;
    logReference?: string;
    reportCode?: string;
    externalUrl?: string;
  }) => Promise<void>;
}

export const ControlsAndEvidenceSection: React.FC<Props> = ({
  busy,
  controls,
  evidences,
  checkHistories,
  onCreateControl,
  onRecordCheck,
  onCreateEvidence,
}) => {
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState('SECURITY');
  const [frameworkTagsCsv, setFrameworkTagsCsv] = useState('ISO27001:A.8, SOC2:CC6, INTERNAL');
  const [frequency, setFrequency] = useState<ControlFrequency>('QUARTERLY');
  const [ownerIdStr, setOwnerIdStr] = useState('1');

  const [checkControlId, setCheckControlId] = useState<number>(controls[0]?.id ?? 0);
  const [checkResult, setCheckResult] = useState<ControlCheckResult>('PASS');
  const [checkScore, setCheckScore] = useState('100');
  const [checkFindings, setCheckFindings] = useState('');

  const [evControlId, setEvControlId] = useState<number>(controls[0]?.id ?? 0);
  const [evType, setEvType] = useState<EvidenceType>('LOG');
  const [evTitle, setEvTitle] = useState('');
  const [evRef, setEvRef] = useState('');

  const resolvedCheckCtrlId = checkControlId || controls[0]?.id || 0;
  const resolvedEvCtrlId = evControlId || controls[0]?.id || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Create Control + Record Check */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '16px',
        }}
      >
        <div style={authStyles.card}>
          <h4 style={authStyles.sectionTitle}>
            <ClipboardList size={16} /> Tạo yêu cầu kiểm soát (Control)
          </h4>
          <p style={authStyles.sectionDesc}>
            Khai báo Control, người phụ trách, tần suất và gắn nhãn framework tự do (không khóa 1
            tiêu chuẩn).
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input
              style={authStyles.input}
              placeholder="Tên yêu cầu kiểm soát..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <input
                style={authStyles.input}
                placeholder="Lĩnh vực (ACCESS, VENDOR...)"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
              <select
                style={authStyles.input}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as ControlFrequency)}
              >
                <option value="DAILY">DAILY</option>
                <option value="WEEKLY">WEEKLY</option>
                <option value="MONTHLY">MONTHLY</option>
                <option value="QUARTERLY">QUARTERLY</option>
                <option value="SEMI_ANNUAL">SEMI_ANNUAL</option>
                <option value="ANNUAL">ANNUAL</option>
                <option value="AD_HOC">AD_HOC</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px' }}>
              <input
                style={authStyles.input}
                placeholder="Framework tags (phân cách dấu phẩy)"
                value={frameworkTagsCsv}
                onChange={(e) => setFrameworkTagsCsv(e.target.value)}
              />
              <input
                style={authStyles.input}
                type="number"
                placeholder="Owner ID"
                value={ownerIdStr}
                onChange={(e) => setOwnerIdStr(e.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={busy || !title.trim()}
              style={authStyles.btnPrimary}
              onClick={() => {
                const tags = frameworkTagsCsv
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
                const ownerNum = Number(ownerIdStr);
                void onCreateControl({
                  title: title.trim(),
                  domain: domain.trim() || 'GENERAL',
                  frameworkTags: tags,
                  ownerUserId: Number.isInteger(ownerNum) && ownerNum > 0 ? ownerNum : null,
                  frequency,
                }).then(() => setTitle(''));
              }}
            >
              Thêm Control
            </button>
          </div>
        </div>

        <div style={authStyles.card}>
          <h4 style={authStyles.sectionTitle}>
            <History size={16} /> Ghi nhận kiểm tra & Lưu bằng chứng
          </h4>
          <p style={authStyles.sectionDesc}>
            Ghi kết quả kiểm tra (người kiểm tra tự động là tài khoản hiện tại) hoặc đính kèm bằng
            chứng File / Log / Report / Link.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px' }}>
              <select
                style={authStyles.input}
                value={resolvedCheckCtrlId}
                onChange={(e) => setCheckControlId(Number(e.target.value))}
              >
                {controls.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.controlCode} — {c.title}
                  </option>
                ))}
              </select>
              <select
                style={authStyles.input}
                value={checkResult}
                onChange={(e) => setCheckResult(e.target.value as ControlCheckResult)}
              >
                <option value="PASS">PASS</option>
                <option value="PARTIAL">PARTIAL</option>
                <option value="FAIL">FAIL</option>
                <option value="NOT_APPLICABLE">N/A</option>
              </select>
              <input
                style={authStyles.input}
                type="number"
                placeholder="Điểm"
                value={checkScore}
                onChange={(e) => setCheckScore(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                style={authStyles.input}
                placeholder="Nhận xét / phát hiện kiểm tra..."
                value={checkFindings}
                onChange={(e) => setCheckFindings(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || !resolvedCheckCtrlId}
                style={authStyles.btnTeal}
                onClick={() => {
                  const scoreNum = Number(checkScore);
                  void onRecordCheck(resolvedCheckCtrlId, {
                    result: checkResult,
                    score: Number.isFinite(scoreNum) ? scoreNum : null,
                    findings: checkFindings.trim() || undefined,
                  }).then(() => setCheckFindings(''));
                }}
              >
                Ghi nhận
              </button>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '2px 0' }} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr', gap: '8px' }}>
              <select
                style={authStyles.input}
                value={resolvedEvCtrlId}
                onChange={(e) => setEvControlId(Number(e.target.value))}
              >
                {controls.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.controlCode}
                  </option>
                ))}
              </select>
              <select
                style={authStyles.input}
                value={evType}
                onChange={(e) => setEvType(e.target.value as EvidenceType)}
              >
                <option value="LOG">LOG</option>
                <option value="FILE">FILE</option>
                <option value="REPORT">REPORT</option>
                <option value="LINK">LINK</option>
              </select>
              <input
                style={authStyles.input}
                placeholder="Tiêu đề bằng chứng..."
                value={evTitle}
                onChange={(e) => setEvTitle(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                style={authStyles.input}
                placeholder={
                  evType === 'FILE'
                    ? 'File ID (số nguyên)'
                    : evType === 'LOG'
                      ? 'Log reference hoặc Audit Log ID'
                      : evType === 'REPORT'
                        ? 'Mã báo cáo (VD: users.security_compliance)'
                        : 'URL bằng chứng (https://...)'
                }
                value={evRef}
                onChange={(e) => setEvRef(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || !resolvedEvCtrlId || !evTitle.trim() || !evRef.trim()}
                style={authStyles.btnSecondary}
                onClick={() => {
                  const ref = evRef.trim();
                  const numericRef = Number(ref);
                  void onCreateEvidence({
                    controlId: resolvedEvCtrlId,
                    evidenceType: evType,
                    title: evTitle.trim(),
                    ...(evType === 'FILE' && Number.isInteger(numericRef)
                      ? { fileId: numericRef }
                      : {}),
                    ...(evType === 'LOG'
                      ? Number.isInteger(numericRef) && numericRef > 0
                        ? { auditLogId: numericRef }
                        : { logReference: ref }
                      : {}),
                    ...(evType === 'REPORT' ? { reportCode: ref } : {}),
                    ...(evType === 'LINK' ? { externalUrl: ref } : {}),
                  }).then(() => {
                    setEvTitle('');
                    setEvRef('');
                  });
                }}
              >
                <FileCheck2 size={14} /> Lưu bằng chứng
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Controls table */}
      <div style={authStyles.card}>
        <h4 style={authStyles.sectionTitle}>Danh sách Controls ({controls.length})</h4>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Mã</th>
                <th style={authStyles.tableHeaderCell}>Tên Control</th>
                <th style={authStyles.tableHeaderCell}>Lĩnh vực / Tags</th>
                <th style={authStyles.tableHeaderCell}>Tần suất</th>
                <th style={authStyles.tableHeaderCell}>Kết quả gần nhất</th>
                <th style={authStyles.tableHeaderCell}>Hạn tiếp theo</th>
              </tr>
            </thead>
            <tbody>
              {controls.map((c) => (
                <tr key={c.id}>
                  <td style={authStyles.tableCell}>
                    <code>{c.controlCode}</code>
                  </td>
                  <td style={authStyles.tableCell}>
                    <strong>{c.title}</strong>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Owner #{c.ownerUserId ?? '—'}
                    </div>
                  </td>
                  <td style={authStyles.tableCell}>
                    <span style={authStyles.badgePrimary}>{c.domain}</span>{' '}
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {c.frameworkTags.join(', ')}
                    </span>
                  </td>
                  <td style={authStyles.tableCell}>{c.frequency}</td>
                  <td style={authStyles.tableCell}>
                    <span
                      style={
                        c.lastCheckResult === 'PASS'
                          ? authStyles.badgeSuccess
                          : c.lastCheckResult === 'FAIL'
                            ? authStyles.badgeDanger
                            : authStyles.badgeWarning
                      }
                    >
                      {c.lastCheckResult ?? 'UNCHECKED'}
                    </span>
                  </td>
                  <td style={authStyles.tableCell}>
                    {c.nextCheckDueAt ? c.nextCheckDueAt.slice(0, 10) : '—'}{' '}
                    <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      ({c.dueStatus})
                    </span>
                  </td>
                </tr>
              ))}
              {controls.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center' }}>
                    Chưa có yêu cầu kiểm soát nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Evidences & Check Histories */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '16px',
        }}
      >
        <div style={authStyles.card}>
          <h4 style={authStyles.sectionTitle}>Bằng chứng kiểm soát ({evidences.length})</h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>Loại</th>
                  <th style={authStyles.tableHeaderCell}>Tiêu đề</th>
                  <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {evidences.slice(0, 15).map((ev) => (
                  <tr key={ev.id}>
                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgePrimary}>{ev.evidenceType}</span>
                    </td>
                    <td style={authStyles.tableCell}>
                      <div>{ev.title}</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        Control #{ev.controlId} •{' '}
                        {ev.fileId
                          ? `File #${ev.fileId}`
                          : ev.auditLogId
                            ? `Audit #${ev.auditLogId}`
                            : ev.logReference || ev.reportCode || ev.externalUrl || '—'}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span
                        style={
                          ev.status === 'VALID' ? authStyles.badgeSuccess : authStyles.badgeDanger
                        }
                      >
                        {ev.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={authStyles.card}>
          <h4 style={authStyles.sectionTitle}>Lịch sử kiểm tra ({checkHistories.length})</h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>Control</th>
                  <th style={authStyles.tableHeaderCell}>Người kiểm</th>
                  <th style={authStyles.tableHeaderCell}>Kết quả</th>
                  <th style={authStyles.tableHeaderCell}>Ngày</th>
                </tr>
              </thead>
              <tbody>
                {checkHistories.slice(0, 15).map((ch) => (
                  <tr key={ch.id}>
                    <td style={authStyles.tableCell}>{ch.controlCode ?? `#${ch.controlId}`}</td>
                    <td style={authStyles.tableCell}>User #{ch.checkedByUserId}</td>
                    <td style={authStyles.tableCell}>
                      <span
                        style={
                          ch.result === 'PASS'
                            ? authStyles.badgeSuccess
                            : ch.result === 'FAIL'
                              ? authStyles.badgeDanger
                              : authStyles.badgeWarning
                        }
                      >
                        {ch.result}
                        {ch.score !== null ? ` (${ch.score})` : ''}
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>{ch.checkedAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
