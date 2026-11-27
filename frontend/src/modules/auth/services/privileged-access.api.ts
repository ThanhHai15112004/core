import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  BreakGlassAccountItem,
  PrivilegedAccessTargetInput,
} from './privileged-access-api-types';
import type {
  PrivilegedGrantItem,
  PrivilegedOverviewItem,
  PrivilegedReviewCampaignDetail,
  PrivilegedReviewCampaignItem,
  PrivilegedTargetItem,
  PrivilegedUsageAlertItem,
  PrivilegedUserDirectoryItem,
} from '../types/privileged-access.types';

function pamHeaders(accessToken?: string, stepUpToken?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (stepUpToken?.trim()) headers['X-Step-Up-Token'] = stepUpToken.trim();
  return headers;
}

export const privilegedAccessApi = {
  getOverview: (accessToken: string) =>
    fetchApi<PrivilegedOverviewItem>(API_ROUTES.PRIVILEGED_ACCESS.OVERVIEW, {
      headers: pamHeaders(accessToken),
    }),

  listDirectoryUsers: (
    accessToken: string,
    params?: { q?: string; privilegedOnly?: boolean; limit?: number },
  ) => {
    const qs = new URLSearchParams({ limit: String(params?.limit ?? 100) });
    if (params?.q) qs.set('q', params.q);
    if (params?.privilegedOnly !== undefined) {
      qs.set('privilegedOnly', String(params.privilegedOnly));
    }
    return fetchApi<PrivilegedUserDirectoryItem[]>(
      API_ROUTES.PRIVILEGED_ACCESS.DIRECTORY_USERS(qs.toString()),
      { headers: pamHeaders(accessToken) },
    );
  },

  listStandingUsers: (accessToken: string) =>
    fetchApi<PrivilegedUserDirectoryItem[]>(
      API_ROUTES.PRIVILEGED_ACCESS.DIRECTORY_STANDING_USERS,
      { headers: pamHeaders(accessToken) },
    ),

  listTargets: (accessToken: string) =>
    fetchApi<PrivilegedTargetItem[]>(API_ROUTES.PRIVILEGED_ACCESS.TARGETS('limit=100'), {
      headers: pamHeaders(accessToken),
    }),

  upsertTarget: (
    accessToken: string,
    payload: PrivilegedAccessTargetInput,
    stepUpToken?: string,
  ) =>
    fetchApi<PrivilegedTargetItem>(API_ROUTES.PRIVILEGED_ACCESS.TARGETS(), {
      method: 'POST',
      headers: pamHeaders(accessToken, stepUpToken),
      body: JSON.stringify(payload),
    }),

  updateTarget: (
    accessToken: string,
    id: number,
    payload: Partial<PrivilegedAccessTargetInput>,
    stepUpToken?: string,
  ) =>
    fetchApi<PrivilegedTargetItem>(API_ROUTES.PRIVILEGED_ACCESS.TARGET_BY_ID(id), {
      method: 'PUT',
      headers: pamHeaders(accessToken, stepUpToken),
      body: JSON.stringify(payload),
    }),

  listGrants: (accessToken: string) =>
    fetchApi<PrivilegedGrantItem[]>(API_ROUTES.PRIVILEGED_ACCESS.GRANTS('limit=50'), {
      headers: pamHeaders(accessToken),
    }),

  requestGrant: (
    accessToken: string,
    payload: {
      userId?: number;
      targetType: 'ROLE' | 'PERMISSION';
      targetCode: string;
      reason: string;
      durationMinutes: number;
      ticketRef?: string;
    },
    stepUpToken?: string,
  ) =>
    fetchApi<PrivilegedGrantItem>(API_ROUTES.PRIVILEGED_ACCESS.GRANTS(), {
      method: 'POST',
      headers: pamHeaders(accessToken, stepUpToken),
      body: JSON.stringify(payload),
    }),

  approveGrant: (accessToken: string, id: number, comment?: string, stepUpToken?: string) =>
    fetchApi<PrivilegedGrantItem>(API_ROUTES.PRIVILEGED_ACCESS.GRANT_APPROVE(id), {
      method: 'POST',
      headers: pamHeaders(accessToken, stepUpToken),
      body: JSON.stringify({ comment: comment || null }),
    }),

  rejectGrant: (accessToken: string, id: number, comment?: string, stepUpToken?: string) =>
    fetchApi<PrivilegedGrantItem>(API_ROUTES.PRIVILEGED_ACCESS.GRANT_REJECT(id), {
      method: 'POST',
      headers: pamHeaders(accessToken, stepUpToken),
      body: JSON.stringify({ comment: comment || null }),
    }),

  revokeGrant: (accessToken: string, id: number, comment?: string, stepUpToken?: string) =>
    fetchApi<PrivilegedGrantItem>(API_ROUTES.PRIVILEGED_ACCESS.GRANT_REVOKE(id), {
      method: 'POST',
      headers: pamHeaders(accessToken, stepUpToken),
      body: JSON.stringify({ comment: comment || null }),
    }),

  sweepExpired: (accessToken: string, stepUpToken?: string) =>
    fetchApi<{
      expiredGrantsCount: number;
      autoSealedBreakGlassCount: number;
    }>(API_ROUTES.PRIVILEGED_ACCESS.GRANTS_SWEEP_EXPIRED, {
      method: 'POST',
      headers: pamHeaders(accessToken, stepUpToken),
    }),

  listBreakGlass: (accessToken: string) =>
    fetchApi<BreakGlassAccountItem[]>(API_ROUTES.PRIVILEGED_ACCESS.BREAK_GLASS('limit=50'), {
      headers: pamHeaders(accessToken),
    }),

  createBreakGlass: (
    accessToken: string,
    payload: {
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
    },
    stepUpToken?: string,
  ) =>
    fetchApi<BreakGlassAccountItem>(API_ROUTES.PRIVILEGED_ACCESS.BREAK_GLASS(), {
      method: 'POST',
      headers: pamHeaders(accessToken, stepUpToken),
      body: JSON.stringify(payload),
    }),

  activateBreakGlass: (
    accessToken: string,
    id: number,
    payload: { reason: string; durationMinutes: number; ticketRef?: string },
    stepUpToken?: string,
  ) =>
    fetchApi<BreakGlassAccountItem>(API_ROUTES.PRIVILEGED_ACCESS.BREAK_GLASS_ACTIVATE(id), {
      method: 'POST',
      headers: pamHeaders(accessToken, stepUpToken),
      body: JSON.stringify(payload),
    }),

  sealBreakGlass: (accessToken: string, id: number, reason?: string, stepUpToken?: string) =>
    fetchApi<BreakGlassAccountItem>(API_ROUTES.PRIVILEGED_ACCESS.BREAK_GLASS_SEAL(id), {
      method: 'POST',
      headers: pamHeaders(accessToken, stepUpToken),
      body: JSON.stringify({ reason: reason || 'Manual seal' }),
    }),

  listAlerts: (accessToken: string) =>
    fetchApi<PrivilegedUsageAlertItem[]>(API_ROUTES.PRIVILEGED_ACCESS.ALERTS('limit=50'), {
      headers: pamHeaders(accessToken),
    }),

  acknowledgeAlert: (accessToken: string, id: number, note?: string, stepUpToken?: string) =>
    fetchApi<PrivilegedUsageAlertItem>(API_ROUTES.PRIVILEGED_ACCESS.ALERT_ACKNOWLEDGE(id), {
      method: 'POST',
      headers: pamHeaders(accessToken, stepUpToken),
      body: JSON.stringify({ note: note || null }),
    }),

  listReviews: (accessToken: string) =>
    fetchApi<PrivilegedReviewCampaignItem[]>(API_ROUTES.PRIVILEGED_ACCESS.REVIEWS('limit=30'), {
      headers: pamHeaders(accessToken),
    }),

  getReviewDetail: (accessToken: string, id: number) =>
    fetchApi<PrivilegedReviewCampaignDetail>(API_ROUTES.PRIVILEGED_ACCESS.REVIEW_BY_ID(id), {
      headers: pamHeaders(accessToken),
    }),

  createReview: (
    accessToken: string,
    payload: { title: string; description?: string; dueDays?: number },
    stepUpToken?: string,
  ) =>
    fetchApi<PrivilegedReviewCampaignDetail>(API_ROUTES.PRIVILEGED_ACCESS.REVIEWS(), {
      method: 'POST',
      headers: pamHeaders(accessToken, stepUpToken),
      body: JSON.stringify(payload),
    }),

  decideReviewItem: (
    accessToken: string,
    reviewId: number,
    itemId: number,
    payload: { decision: 'KEEP' | 'REVOKE'; note?: string },
    stepUpToken?: string,
  ) =>
    fetchApi<PrivilegedReviewCampaignDetail>(
      API_ROUTES.PRIVILEGED_ACCESS.REVIEW_ITEM_DECIDE(reviewId, itemId),
      {
        method: 'POST',
        headers: pamHeaders(accessToken, stepUpToken),
        body: JSON.stringify(payload),
      },
    ),
};
