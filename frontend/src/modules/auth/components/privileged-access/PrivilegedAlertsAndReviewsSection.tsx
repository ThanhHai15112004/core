import React, { useState } from 'react';
import { authStyles } from '../auth-ui.styles';
import type {
  PrivilegedReviewCampaignDetail,
  PrivilegedReviewCampaignItem,
  PrivilegedUsageAlertItem,
} from '../../types/privileged-access.types';

interface Props {
  readonly busy: boolean;
  readonly alerts: readonly PrivilegedUsageAlertItem[];
  readonly reviews: readonly PrivilegedReviewCampaignItem[];
  readonly selectedReview: PrivilegedReviewCampaignDetail | null;
  readonly onAcknowledgeAlert: (id: number, note?: string) => Promise<void>;
  readonly onCreateReview: (payload: {
    title: string;
    description?: string;
    dueDays?: number;
  }) => Promise<void>;
  readonly onLoadReviewDetail: (id: number) => Promise<void>;
  readonly onDecideReviewItem: (
    reviewId: number,
    itemId: number,
    decision: 'KEEP' | 'REVOKE',
    note?: string,
  ) => Promise<void>;
}

export const PrivilegedAlertsAndReviewsSection: React.FC<Props> = ({
  busy,
  alerts,
  reviews,
  selectedReview,
  onAcknowledgeAlert,
  onCreateReview,
  onLoadReviewDetail,
  onDecideReviewItem,
}) => {
  const [reviewTitle, setReviewTitle] = useState('Rà soát quyền đặc biệt định kỳ Q4');
  const [dueDays, setDueDays] = useState(14);

  const handleCreateReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewTitle.trim()) return;
    await onCreateReview({ title: reviewTitle.trim(), dueDays });
  };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          Cảnh báo sử dụng quyền đặc biệt & Break-glass ({alerts.length})
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '8px' }}>Thời gian</th>
                <th style={{ padding: '8px' }}>Sự kiện / Mức độ</th>
                <th style={{ padding: '8px' }}>Tác nhân / Mục tiêu</th>
                <th style={{ padding: '8px' }}>Hành động</th>
                <th style={{ padding: '8px' }}>Xác nhận</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <strong>{a.eventType}</strong>{' '}
                    <span
                      style={
                        a.severity === 'CRITICAL'
                          ? authStyles.badgeDanger
                          : authStyles.badgeWarning
                      }
                    >
                      {a.severity}
                    </span>
                  </td>
                  <td style={{ padding: '8px' }}>
                    {a.actorUsername ?? `#${a.actorUserId ?? 'system'}`} →{' '}
                    <code>{a.targetCode ?? '-'}</code>
                  </td>
                  <td style={{ padding: '8px', fontSize: '12px' }}>{a.action}</td>
                  <td style={{ padding: '8px' }}>
                    {a.acknowledgedAt ? (
                      <span style={authStyles.badgeSuccess}>Đã xác nhận</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onAcknowledgeAlert(a.id, 'Đã kiểm tra hợp lệ')}
                        style={authStyles.btnSecondary}
                      >
                        Xác nhận
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>Rà soát quyền đặc biệt định kỳ</h3>
        <form
          onSubmit={(e) => void handleCreateReview(e)}
          style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'end', marginBottom: '14px' }}
        >
          <div style={{ flex: '1 1 280px' }}>
            <label style={authStyles.label}>Tên đợt rà soát</label>
            <input
              value={reviewTitle}
              onChange={(e) => setReviewTitle(e.target.value)}
              style={authStyles.input}
              required
            />
          </div>
          <div style={{ width: '130px' }}>
            <label style={authStyles.label}>Hạn (ngày)</label>
            <input
              type="number"
              min={1}
              max={90}
              value={dueDays}
              onChange={(e) => setDueDays(Number(e.target.value) || 14)}
              style={authStyles.input}
            />
          </div>
          <button type="submit" disabled={busy} style={authStyles.btnPrimary}>
            Khởi tạo đợt rà soát
          </button>
        </form>

        <div style={{ display: 'grid', gap: '8px', marginBottom: '14px' }}>
          {reviews.map((r) => (
            <div
              key={r.id}
              style={{
                padding: '10px 12px',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <strong>{r.reviewCode}</strong> — {r.title} ({r.statusName}) · Tiến độ:{' '}
                {r.decidedItems}/{r.totalItems} (Giữ: {r.keptItems}, Thu hồi: {r.revokedItems})
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onLoadReviewDetail(r.id)}
                style={authStyles.btnSecondary}
              >
                Xem & Duyệt
              </button>
            </div>
          ))}
        </div>

        {selectedReview && (
          <div style={{ overflowX: 'auto' }}>
            <h4 style={{ margin: '8px 0' }}>
              Chi tiết đợt {selectedReview.reviewCode} ({selectedReview.statusName})
            </h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '8px' }}>User</th>
                  <th style={{ padding: '8px' }}>Nguồn</th>
                  <th style={{ padding: '8px' }}>Mục tiêu</th>
                  <th style={{ padding: '8px' }}>Quyết định</th>
                  <th style={{ padding: '8px' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {selectedReview.items.map((item) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '8px' }}>
                      #{item.userId} {item.username}
                    </td>
                    <td style={{ padding: '8px' }}>{item.grantSource}</td>
                    <td style={{ padding: '8px' }}>
                      {item.targetType}:{item.targetCode}
                    </td>
                    <td style={{ padding: '8px' }}>
                      <strong>{item.decisionName}</strong>
                      {item.enforcementError && (
                        <div style={{ fontSize: '11.5px', color: 'var(--status-danger)' }}>
                          {item.enforcementError}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px', display: 'flex', gap: '6px' }}>
                      {selectedReview.status === 1 && item.decision === 1 && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void onDecideReviewItem(
                                selectedReview.id,
                                item.id,
                                'KEEP',
                                'Xác nhận tiếp tục giữ quyền',
                              )
                            }
                            style={authStyles.btnPrimary}
                          >
                            Giữ
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void onDecideReviewItem(
                                selectedReview.id,
                                item.id,
                                'REVOKE',
                                'Thu hồi quyền trong đợt rà soát',
                              )
                            }
                            style={authStyles.btnSecondary}
                          >
                            Thu hồi
                          </button>
                        </>
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
  );
};
