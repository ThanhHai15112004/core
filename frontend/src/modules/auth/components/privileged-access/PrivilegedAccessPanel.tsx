import React, { useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { authStyles } from '../auth-ui.styles';
import type { PrivilegedAccessTargetInput } from '../../services/privileged-access-api-types';
import type {
  BreakGlassAccountItem,
  PrivilegedGrantItem,
  PrivilegedOverviewItem,
  PrivilegedReviewCampaignDetail,
  PrivilegedReviewCampaignItem,
  PrivilegedTargetItem,
  PrivilegedTargetType,
  PrivilegedUsageAlertItem,
  PrivilegedUserDirectoryItem,
} from '../../types/privileged-access.types';
import { PrivilegedAlertsAndReviewsSection } from './PrivilegedAlertsAndReviewsSection';
import { PrivilegedBreakGlassSection } from './PrivilegedBreakGlassSection';
import { PrivilegedGrantsSection } from './PrivilegedGrantsSection';
import { PrivilegedTargetsSection } from './PrivilegedTargetsSection';

type PamSubView = 'targets' | 'grants' | 'break-glass' | 'alerts-reviews';

interface Props {
  readonly accessToken: string;
  readonly busy: boolean;
  readonly stepUpToken: string;
  readonly onChangeStepUpToken: (val: string) => void;
  readonly overview: PrivilegedOverviewItem | null;
  readonly directoryUsers: readonly PrivilegedUserDirectoryItem[];
  readonly standingUsers: readonly PrivilegedUserDirectoryItem[];
  readonly targets: readonly PrivilegedTargetItem[];
  readonly grants: readonly PrivilegedGrantItem[];
  readonly breakGlassAccounts: readonly BreakGlassAccountItem[];
  readonly alerts: readonly PrivilegedUsageAlertItem[];
  readonly reviews: readonly PrivilegedReviewCampaignItem[];
  readonly selectedReview: PrivilegedReviewCampaignDetail | null;
  readonly onRefresh: () => Promise<void>;
  readonly onUpsertTarget: (payload: PrivilegedAccessTargetInput) => Promise<void>;
  readonly onToggleTargetField: (
    target: PrivilegedTargetItem,
    patch: Partial<PrivilegedAccessTargetInput>,
  ) => Promise<void>;
  readonly onRequestGrant: (payload: {
    userId?: number;
    targetType: PrivilegedTargetType;
    targetCode: string;
    reason: string;
    durationMinutes: number;
    ticketRef?: string;
  }) => Promise<void>;
  readonly onApproveGrant: (id: number, comment?: string) => Promise<void>;
  readonly onRejectGrant: (id: number, comment?: string) => Promise<void>;
  readonly onRevokeGrant: (id: number, comment?: string) => Promise<void>;
  readonly onSweepExpired: () => Promise<void>;
  readonly onCreateBreakGlass: (payload: {
    mode: 'LINK_EXISTING' | 'CREATE_NEW';
    existingUserId?: number;
    username?: string;
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    code: string;
    label: string;
    roleCode: string;
    maxActivationMinutes: number;
    requireMfa: boolean;
    sealImmediately: boolean;
  }) => Promise<void>;
  readonly onActivateBreakGlass: (
    id: number,
    payload: { reason: string; durationMinutes: number; ticketRef?: string },
  ) => Promise<void>;
  readonly onSealBreakGlass: (id: number, reason?: string) => Promise<void>;
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

export const PrivilegedAccessPanel: React.FC<Props> = ({
  accessToken,
  busy,
  stepUpToken,
  onChangeStepUpToken,
  overview,
  directoryUsers,
  standingUsers,
  targets,
  grants,
  breakGlassAccounts,
  alerts,
  reviews,
  selectedReview,
  onRefresh,
  onUpsertTarget,
  onToggleTargetField,
  onRequestGrant,
  onApproveGrant,
  onRejectGrant,
  onRevokeGrant,
  onSweepExpired,
  onCreateBreakGlass,
  onActivateBreakGlass,
  onSealBreakGlass,
  onAcknowledgeAlert,
  onCreateReview,
  onLoadReviewDetail,
  onDecideReviewItem,
}) => {
  const [view, setView] = useState<PamSubView>('targets');

  if (!accessToken) {
    return (
      <div style={authStyles.card}>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Vui lòng đăng nhập bằng tài khoản quản trị có quyền <code>privileged-access.read</code>{' '}
          để quản trị Quyền Đặc Biệt (PAM — 14.4).
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={authStyles.cardHighlighted}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={18} />
            <strong>Bảng điều khiển Quyền Quản Trị Đặc Biệt (PAM — 14.4)</strong>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={stepUpToken}
              onChange={(e) => onChangeStepUpToken(e.target.value)}
              placeholder="Dán MFA Step-Up Token (X-Step-Up-Token) từ tab MFA..."
              style={{ ...authStyles.monoInput, width: '320px' }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRefresh()}
              style={authStyles.btnSecondary}
            >
              <RefreshCw size={14} /> Làm mới
            </button>
          </div>
        </div>

        {overview && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12.5px' }}>
            <span style={authStyles.badgePrimary}>
              Targets: {overview.targetsEnabled}/{overview.targetsTotal}
            </span>
            <span style={authStyles.badgePrimary}>
              Standing Admins: {overview.standingPrivilegedUsersCount}
            </span>
            <span style={authStyles.badgeWarning}>
              Chờ duyệt JIT: {overview.pendingGrantsCount}
            </span>
            <span style={authStyles.badgeSuccess}>
              JIT đang hiệu lực: {overview.activeGrantsCount}
            </span>
            <span style={authStyles.badgeDanger}>
              Break-glass mở: {overview.breakGlassActiveCount}/{overview.breakGlassTotal}
            </span>
            <span style={authStyles.badgeWarning}>
              Cảnh báo chưa xác nhận: {overview.unacknowledgedAlertsCount}
            </span>
            <span style={authStyles.badgePrimary}>
              Đợt rà soát đang mở: {overview.openReviewsCount}
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          ...authStyles.card,
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          padding: '12px 16px',
        }}
      >
        {(
          [
            { id: 'targets', label: `Mục tiêu & Admin (${targets.length}/${standingUsers.length})` },
            { id: 'grants', label: `Cấp quyền tạm thời (${grants.length})` },
            { id: 'break-glass', label: `Break-glass (${breakGlassAccounts.length})` },
            { id: 'alerts-reviews', label: `Cảnh báo & Rà soát (${alerts.length}/${reviews.length})` },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            style={view === item.id ? authStyles.btnPrimary : authStyles.btnSecondary}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === 'targets' && (
        <PrivilegedTargetsSection
          busy={busy}
          targets={targets}
          standingUsers={standingUsers}
          onUpsertTarget={onUpsertTarget}
          onToggleTargetField={onToggleTargetField}
        />
      )}

      {view === 'grants' && (
        <PrivilegedGrantsSection
          busy={busy}
          directoryUsers={directoryUsers}
          targets={targets}
          grants={grants}
          onRequestGrant={onRequestGrant}
          onApprove={onApproveGrant}
          onReject={onRejectGrant}
          onRevoke={onRevokeGrant}
          onSweepExpired={onSweepExpired}
        />
      )}

      {view === 'break-glass' && (
        <PrivilegedBreakGlassSection
          busy={busy}
          directoryUsers={directoryUsers}
          accounts={breakGlassAccounts}
          onCreate={onCreateBreakGlass}
          onActivate={onActivateBreakGlass}
          onSeal={onSealBreakGlass}
        />
      )}

      {view === 'alerts-reviews' && (
        <PrivilegedAlertsAndReviewsSection
          busy={busy}
          alerts={alerts}
          reviews={reviews}
          selectedReview={selectedReview}
          onAcknowledgeAlert={onAcknowledgeAlert}
          onCreateReview={onCreateReview}
          onLoadReviewDetail={onLoadReviewDetail}
          onDecideReviewItem={onDecideReviewItem}
        />
      )}
    </div>
  );
};
