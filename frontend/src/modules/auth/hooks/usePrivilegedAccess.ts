import { useCallback, useEffect, useState } from 'react';
import { privilegedAccessApi } from '../services/privileged-access.api';
import type { PrivilegedAccessTargetInput } from '../services/privileged-access-api-types';
import type {
  BreakGlassAccountItem,
  PrivilegedGrantItem,
  PrivilegedOverviewItem,
  PrivilegedReviewCampaignDetail,
  PrivilegedReviewCampaignItem,
  PrivilegedTargetItem,
  PrivilegedUsageAlertItem,
  PrivilegedUserDirectoryItem,
} from '../types/privileged-access.types';

export function usePrivilegedAccess(
  accessToken: string,
  notify: (type: 'ok' | 'err', text: string) => void,
) {
  const [busy, setBusy] = useState(false);
  const [stepUpToken, setStepUpToken] = useState('');
  const [overview, setOverview] = useState<PrivilegedOverviewItem | null>(null);
  const [directoryUsers, setDirectoryUsers] = useState<PrivilegedUserDirectoryItem[]>([]);
  const [standingUsers, setStandingUsers] = useState<PrivilegedUserDirectoryItem[]>([]);
  const [targets, setTargets] = useState<PrivilegedTargetItem[]>([]);
  const [grants, setGrants] = useState<PrivilegedGrantItem[]>([]);
  const [breakGlassAccounts, setBreakGlassAccounts] = useState<BreakGlassAccountItem[]>([]);
  const [alerts, setAlerts] = useState<PrivilegedUsageAlertItem[]>([]);
  const [reviews, setReviews] = useState<PrivilegedReviewCampaignItem[]>([]);
  const [selectedReview, setSelectedReview] = useState<PrivilegedReviewCampaignDetail | null>(null);

  const refreshAll = useCallback(async () => {
    if (!accessToken) {
      setOverview(null);
      setDirectoryUsers([]);
      setStandingUsers([]);
      setTargets([]);
      setGrants([]);
      setBreakGlassAccounts([]);
      setAlerts([]);
      setReviews([]);
      setSelectedReview(null);
      return;
    }
    setBusy(true);
    try {
      const [ov, dir, stand, tgt, gr, bg, al, rev] = await Promise.all([
        privilegedAccessApi.getOverview(accessToken).catch(() => null),
        privilegedAccessApi.listDirectoryUsers(accessToken).catch(() => []),
        privilegedAccessApi.listStandingUsers(accessToken).catch(() => []),
        privilegedAccessApi.listTargets(accessToken).catch(() => []),
        privilegedAccessApi.listGrants(accessToken).catch(() => []),
        privilegedAccessApi.listBreakGlass(accessToken).catch(() => []),
        privilegedAccessApi.listAlerts(accessToken).catch(() => []),
        privilegedAccessApi.listReviews(accessToken).catch(() => []),
      ]);
      setOverview(ov);
      setDirectoryUsers(Array.isArray(dir) ? dir : []);
      setStandingUsers(Array.isArray(stand) ? stand : []);
      setTargets(Array.isArray(tgt) ? tgt : []);
      setGrants(Array.isArray(gr) ? gr : []);
      setBreakGlassAccounts(Array.isArray(bg) ? bg : []);
      setAlerts(Array.isArray(al) ? al : []);
      setReviews(Array.isArray(rev) ? rev : []);
    } finally {
      setBusy(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const runAction = useCallback(
    async (fn: () => Promise<void>, successMessage: string) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        await fn();
        notify('ok', successMessage);
        await refreshAll();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Thao tác PAM thất bại');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAll],
  );

  const upsertTarget = useCallback(
    (payload: PrivilegedAccessTargetInput) =>
      runAction(
        async () => {
          await privilegedAccessApi.upsertTarget(accessToken, payload, stepUpToken);
        },
        `Đã lưu chính sách đặc biệt cho ${payload.targetType}:${payload.targetCode}`,
      ),
    [accessToken, runAction, stepUpToken],
  );

  const toggleTargetField = useCallback(
    (target: PrivilegedTargetItem, patch: Partial<PrivilegedAccessTargetInput>) =>
      runAction(
        async () => {
          await privilegedAccessApi.updateTarget(accessToken, target.id, patch, stepUpToken);
        },
        `Đã cập nhật chính sách ${target.targetCode}`,
      ),
    [accessToken, runAction, stepUpToken],
  );

  const requestGrant = useCallback(
    (payload: {
      userId?: number;
      targetType: 'ROLE' | 'PERMISSION';
      targetCode: string;
      reason: string;
      durationMinutes: number;
      ticketRef?: string;
    }) =>
      runAction(
        async () => {
          await privilegedAccessApi.requestGrant(accessToken, payload, stepUpToken);
        },
        `Đã tạo yêu cầu cấp quyền tạm thời ${payload.targetCode}`,
      ),
    [accessToken, runAction, stepUpToken],
  );

  const approveGrant = useCallback(
    (id: number, comment?: string) =>
      runAction(
        async () => {
          await privilegedAccessApi.approveGrant(accessToken, id, comment, stepUpToken);
        },
        `Đã phê duyệt cấp quyền #${id}`,
      ),
    [accessToken, runAction, stepUpToken],
  );

  const rejectGrant = useCallback(
    (id: number, comment?: string) =>
      runAction(
        async () => {
          await privilegedAccessApi.rejectGrant(accessToken, id, comment, stepUpToken);
        },
        `Đã từ chối yêu cầu #${id}`,
      ),
    [accessToken, runAction, stepUpToken],
  );

  const revokeGrant = useCallback(
    (id: number, comment?: string) =>
      runAction(
        async () => {
          await privilegedAccessApi.revokeGrant(accessToken, id, comment, stepUpToken);
        },
        `Đã thu hồi quyền tạm thời #${id}`,
      ),
    [accessToken, runAction, stepUpToken],
  );

  const sweepExpired = useCallback(
    () =>
      runAction(async () => {
        await privilegedAccessApi.sweepExpired(accessToken, stepUpToken);
      }, 'Đã chạy quét thu hồi quyền & Break-glass hết hạn'),
    [accessToken, runAction, stepUpToken],
  );

  const createBreakGlass = useCallback(
    (payload: {
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
    }) =>
      runAction(
        async () => {
          await privilegedAccessApi.createBreakGlass(accessToken, payload, stepUpToken);
        },
        `Đã đăng ký tài khoản Break-glass ${payload.code}`,
      ),
    [accessToken, runAction, stepUpToken],
  );

  const activateBreakGlass = useCallback(
    (id: number, payload: { reason: string; durationMinutes: number; ticketRef?: string }) =>
      runAction(
        async () => {
          await privilegedAccessApi.activateBreakGlass(accessToken, id, payload, stepUpToken);
        },
        `Đã kích hoạt khẩn cấp Break-glass #${id}`,
      ),
    [accessToken, runAction, stepUpToken],
  );

  const sealBreakGlass = useCallback(
    (id: number, reason?: string) =>
      runAction(
        async () => {
          await privilegedAccessApi.sealBreakGlass(accessToken, id, reason, stepUpToken);
        },
        `Đã niêm phong tài khoản Break-glass #${id}`,
      ),
    [accessToken, runAction, stepUpToken],
  );

  const acknowledgeAlert = useCallback(
    (id: number, note?: string) =>
      runAction(
        async () => {
          await privilegedAccessApi.acknowledgeAlert(accessToken, id, note, stepUpToken);
        },
        `Đã xác nhận cảnh báo #${id}`,
      ),
    [accessToken, runAction, stepUpToken],
  );

  const loadReviewDetail = useCallback(
    async (id: number) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        const detail = await privilegedAccessApi.getReviewDetail(accessToken, id);
        setSelectedReview(detail);
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Không thể tải đợt rà soát');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify],
  );

  const createReview = useCallback(
    (payload: { title: string; description?: string; dueDays?: number }) =>
      runAction(async () => {
        const created = await privilegedAccessApi.createReview(accessToken, payload, stepUpToken);
        setSelectedReview(created);
      }, `Đã tạo đợt rà soát "${payload.title}"`),
    [accessToken, runAction, stepUpToken],
  );

  const decideReviewItem = useCallback(
    (reviewId: number, itemId: number, decision: 'KEEP' | 'REVOKE', note?: string) =>
      runAction(
        async () => {
          const updated = await privilegedAccessApi.decideReviewItem(
            accessToken,
            reviewId,
            itemId,
            { decision, note },
            stepUpToken,
          );
          setSelectedReview(updated);
        },
        decision === 'KEEP' ? 'Đã xác nhận GIỮ quyền' : 'Đã THU HỒI quyền trong đợt rà soát',
      ),
    [accessToken, runAction, stepUpToken],
  );

  return {
    busy,
    stepUpToken,
    setStepUpToken,
    overview,
    directoryUsers,
    standingUsers,
    targets,
    grants,
    breakGlassAccounts,
    alerts,
    reviews,
    selectedReview,
    refreshAll,
    upsertTarget,
    toggleTargetField,
    requestGrant,
    approveGrant,
    rejectGrant,
    revokeGrant,
    sweepExpired,
    createBreakGlass,
    activateBreakGlass,
    sealBreakGlass,
    acknowledgeAlert,
    loadReviewDetail,
    createReview,
    decideReviewItem,
  };
}
