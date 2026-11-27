import React, { useState } from 'react';
import { authStyles } from '../auth-ui.styles';
import type {
  DsarDownloadPayload,
  DsarExportFormat,
  DsarRequestItem,
  DsarRequestType,
} from '../../types/data-governance.types';

interface Props {
  readonly busy: boolean;
  readonly requests: readonly DsarRequestItem[];
  readonly lastExportPreview: DsarDownloadPayload | null;
  readonly onClearExportPreview: () => void;
  readonly onCreateRequest: (payload: {
    requestType: DsarRequestType;
    subjectUserId?: number;
    exportFormat?: DsarExportFormat;
    reason?: string;
    excludedDataTypeCodes?: string[];
  }) => Promise<void>;
  readonly onApprove: (id: number, comment?: string, excludedCodesCsv?: string) => Promise<void>;
  readonly onReject: (id: number, comment: string) => Promise<void>;
  readonly onDownloadExport: (downloadUrl: string) => Promise<void>;
}

export const DsarRequestsSection: React.FC<Props> = ({
  busy,
  requests,
  lastExportPreview,
  onClearExportPreview,
  onCreateRequest,
  onApprove,
  onReject,
  onDownloadExport,
}) => {
  const [requestType, setRequestType] = useState<DsarRequestType>('ACCESS');
  const [subjectUserId, setSubjectUserId] = useState('');
  const [exportFormat, setExportFormat] = useState<DsarExportFormat>('json');
  const [reason, setReason] = useState('');
  const [excludedCsv, setExcludedCsv] = useState('');
  const [selectedDsar, setSelectedDsar] = useState<DsarRequestItem | null>(null);
  const [approveExclusionCsv, setApproveExclusionCsv] = useState('');
  const [decisionNote, setDecisionNote] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const excludedDataTypeCodes = excludedCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await onCreateRequest({
      requestType,
      subjectUserId: subjectUserId.trim() ? Number(subjectUserId) : undefined,
      exportFormat: requestType === 'EXPORT' ? exportFormat : undefined,
      reason: reason.trim() || undefined,
      excludedDataTypeCodes: excludedDataTypeCodes.length > 0 ? excludedDataTypeCodes : undefined,
    });
    setReason('');
    setExcludedCsv('');
  };

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          Yêu cầu dữ liệu cá nhân DSAR (Xem tổng hợp · Xuất máy đọc JSON/CSV · Xóa có ngoại lệ & phê duyệt)
        </h3>
        <p style={authStyles.sectionDesc}>
          Tổng hợp dữ liệu cá nhân từ các module (<code>users</code>, <code>sessions</code>,{' '}
          <code>audit</code>, <code>custom-fields</code>, <code>exports</code>,{' '}
          <code>consents</code>). Yêu cầu xóa bắt buộc phê duyệt, tự động chặn nếu vướng Legal Hold và lưu danh sách ngoại lệ giữ lại.
        </p>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: '10px',
            marginBottom: '16px',
          }}
        >
          <select
            style={authStyles.input}
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as DsarRequestType)}
          >
            <option value="ACCESS">ACCESS — Xem dữ liệu cá nhân tổng hợp</option>
            <option value="EXPORT">EXPORT — Xuất gói dữ liệu máy đọc (JSON/CSV)</option>
            <option value="ERASURE">ERASURE — Yêu cầu xóa / ẩn danh (Có phê duyệt)</option>
          </select>
          <input
            type="number"
            min={1}
            style={authStyles.input}
            placeholder="User ID (trống = chính tôi)"
            value={subjectUserId}
            onChange={(e) => setSubjectUserId(e.target.value)}
          />
          {requestType === 'EXPORT' && (
            <select
              style={authStyles.input}
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as DsarExportFormat)}
            >
              <option value="json">JSON (Portable Machine-Readable)</option>
              <option value="csv">CSV (Bảng chuẩn hóa)</option>
            </select>
          )}
          {requestType === 'ERASURE' && (
            <input
              style={authStyles.input}
              placeholder="Ngoại lệ giữ lại (vd: exports.artifacts)"
              value={excludedCsv}
              onChange={(e) => setExcludedCsv(e.target.value)}
            />
          )}
          <input
            style={authStyles.input}
            placeholder="Lý do yêu cầu"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button type="submit" style={authStyles.btnPrimary} disabled={busy}>
            Tạo yêu cầu DSAR
          </button>
        </form>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <input
            style={{ ...authStyles.input, maxWidth: '320px' }}
            placeholder="Ghi chú phê duyệt / lý do từ chối..."
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
          />
          <input
            style={{ ...authStyles.input, maxWidth: '340px' }}
            placeholder="Mã loại dữ liệu ngoại lệ giữ lại khi duyệt xóa (phân cách dấu phẩy)"
            value={approveExclusionCsv}
            onChange={(e) => setApproveExclusionCsv(e.target.value)}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Mã yêu cầu</th>
                <th style={authStyles.tableHeaderCell}>Loại</th>
                <th style={authStyles.tableHeaderCell}>User ID</th>
                <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                <th style={authStyles.tableHeaderCell}>Ngoại lệ giữ lại</th>
                <th style={authStyles.tableHeaderCell}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...authStyles.tableCell, color: 'var(--text-muted)' }}>
                    Chưa có yêu cầu DSAR nào.
                  </td>
                </tr>
              ) : (
                requests.map((r) => (
                  <tr key={r.id}>
                    <td style={authStyles.tableCell}>
                      <strong>{r.requestCode}</strong>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        Hạn SLA: {new Date(r.dueAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgePrimary}>{r.requestType}</span>
                    </td>
                    <td style={authStyles.tableCell}>#{r.subjectUserId}</td>
                    <td style={authStyles.tableCell}>
                      <span
                        style={
                          r.statusName === 'COMPLETED'
                            ? authStyles.badgeSuccess
                            : r.statusName === 'PARTIALLY_COMPLETED' ||
                                r.statusName === 'PENDING_APPROVAL'
                              ? authStyles.badgeWarning
                              : r.statusName === 'BLOCKED_LEGAL_HOLD' || r.statusName === 'REJECTED'
                                ? authStyles.badgeDanger
                                : authStyles.badgePrimary
                        }
                      >
                        {r.statusName}
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>
                      {r.retainedExceptions.length > 0
                        ? `${r.retainedExceptions.length} mục ngoại lệ`
                        : 'Không'}
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          style={authStyles.btnSecondary}
                          onClick={() => setSelectedDsar(r)}
                        >
                          Chi tiết
                        </button>
                        {r.downloadUrl && (
                          <button
                            type="button"
                            style={authStyles.btnTeal}
                            disabled={busy}
                            onClick={() => void onDownloadExport(r.downloadUrl!)}
                          >
                            Tải {r.exportFormat?.toUpperCase() || 'JSON'}
                          </button>
                        )}
                        {(r.statusName === 'PENDING_APPROVAL' ||
                          r.statusName === 'BLOCKED_LEGAL_HOLD') && (
                          <>
                            <button
                              type="button"
                              style={authStyles.btnPrimary}
                              disabled={busy}
                              onClick={() =>
                                void onApprove(r.id, decisionNote, approveExclusionCsv)
                              }
                            >
                              Duyệt xóa
                            </button>
                            <button
                              type="button"
                              style={authStyles.btnDanger}
                              disabled={busy}
                              onClick={() =>
                                void onReject(r.id, decisionNote || 'Từ chối theo chính sách lưu trữ')
                              }
                            >
                              Từ chối
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedDsar && (
        <div style={authStyles.cardHighlighted}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
            <h4 style={authStyles.sectionTitle}>
              Chi tiết yêu cầu {selectedDsar.requestCode} ({selectedDsar.requestType})
            </h4>
            <button
              type="button"
              style={authStyles.btnSecondary}
              onClick={() => setSelectedDsar(null)}
            >
              Đóng
            </button>
          </div>
          {selectedDsar.retainedExceptions.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                Ngoại lệ giữ lại khi xóa:
              </strong>
              <ul style={{ margin: '6px 0', paddingLeft: '18px', fontSize: '12.5px' }}>
                {selectedDsar.retainedExceptions.map((ex, idx) => (
                  <li key={`${ex.dataTypeCode}-${idx}`}>
                    <code>{ex.dataTypeCode}</code> ({ex.reasonCode}): {ex.reason} ({ex.retainedCount}{' '}
                    bản ghi)
                  </li>
                ))}
              </ul>
            </div>
          )}
          <pre style={{ ...authStyles.codeBox, maxHeight: '260px', overflow: 'auto' }}>
            {JSON.stringify(selectedDsar.summary, null, 2)}
          </pre>
        </div>
      )}

      {lastExportPreview && (
        <div style={authStyles.cardHighlighted}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div>
              <h4 style={authStyles.sectionTitle}>
                Gói dữ liệu máy đọc được: {lastExportPreview.fileName}
              </h4>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                SHA-256: {lastExportPreview.checksumSha256}
              </div>
            </div>
            <button
              type="button"
              style={authStyles.btnSecondary}
              onClick={onClearExportPreview}
            >
              Ẩn bản xem trước
            </button>
          </div>
          <pre style={{ ...authStyles.codeBox, maxHeight: '260px', overflow: 'auto' }}>
            {lastExportPreview.content}
          </pre>
        </div>
      )}
    </div>
  );
};
