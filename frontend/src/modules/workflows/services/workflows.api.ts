import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  CreateWorkflowDefinitionPayload,
  StartWorkflowInstancePayload,
  WorkflowCommentItem,
  WorkflowDefinitionItem,
  WorkflowHistoryItem,
  WorkflowInstanceDetail,
  WorkflowInstanceItem,
  WorkflowRecordActivityTimeline,
  WorkflowSlaScanResult,
  WorkflowStateItem,
  WorkflowTransitionItem,
} from '../types/workflows.types';

export const workflowsApi = {
  listDefinitions: (qs = '') =>
    fetchApiWithMeta<WorkflowDefinitionItem[]>(API_ROUTES.WORKFLOWS.DEFINITIONS(qs)),

  getDefinitionById: (id: number): Promise<WorkflowDefinitionItem> =>
    fetchApi<WorkflowDefinitionItem>(API_ROUTES.WORKFLOWS.DEFINITION_BY_ID(id)),

  createDefinition: (payload: CreateWorkflowDefinitionPayload): Promise<WorkflowDefinitionItem> =>
    fetchApi<WorkflowDefinitionItem>(API_ROUTES.WORKFLOWS.DEFINITIONS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createNewVersion: (id: number): Promise<WorkflowDefinitionItem> =>
    fetchApi<WorkflowDefinitionItem>(API_ROUTES.WORKFLOWS.DEFINITION_NEW_VERSION(id), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  replaceStates: (
    id: number,
    states: readonly WorkflowStateItem[],
  ): Promise<WorkflowDefinitionItem> =>
    fetchApi<WorkflowDefinitionItem>(API_ROUTES.WORKFLOWS.DEFINITION_STATES(id), {
      method: 'PUT',
      body: JSON.stringify({ states }),
    }),

  replaceTransitions: (
    id: number,
    transitions: readonly WorkflowTransitionItem[],
  ): Promise<WorkflowDefinitionItem> =>
    fetchApi<WorkflowDefinitionItem>(API_ROUTES.WORKFLOWS.DEFINITION_TRANSITIONS(id), {
      method: 'PUT',
      body: JSON.stringify({ transitions }),
    }),

  listInstances: (qs = '') =>
    fetchApiWithMeta<WorkflowInstanceItem[]>(API_ROUTES.WORKFLOWS.INSTANCES(qs)),

  getInstanceById: (id: number): Promise<WorkflowInstanceDetail> =>
    fetchApi<WorkflowInstanceDetail>(API_ROUTES.WORKFLOWS.INSTANCE_BY_ID(id)),

  startInstance: (payload: StartWorkflowInstancePayload): Promise<WorkflowInstanceDetail> =>
    fetchApi<WorkflowInstanceDetail>(API_ROUTES.WORKFLOWS.INSTANCE_START, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  executeTransition: (
    id: number,
    payload: {
      readonly transitionCode: string;
      readonly reason?: string | null;
      readonly contextDataPatch?: Record<string, unknown>;
    },
  ): Promise<WorkflowInstanceDetail> =>
    fetchApi<WorkflowInstanceDetail>(API_ROUTES.WORKFLOWS.INSTANCE_TRANSITION(id), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  decideApproval: (
    id: number,
    payload: {
      readonly decision: 'APPROVED' | 'REJECTED' | 'RETURNED';
      readonly comment?: string | null;
    },
  ): Promise<WorkflowInstanceDetail> =>
    fetchApi<WorkflowInstanceDetail>(API_ROUTES.WORKFLOWS.INSTANCE_APPROVE(id), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  delegateApproval: (
    id: number,
    payload: {
      readonly toUserId: number;
      readonly reason: string;
      readonly effectiveFrom?: string;
      readonly effectiveUntil?: string;
      readonly workflowCodes?: readonly string[];
    },
  ): Promise<WorkflowInstanceDetail> =>
    fetchApi<WorkflowInstanceDetail>(API_ROUTES.WORKFLOWS.INSTANCE_DELEGATE(id), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  cancelInstance: (
    id: number,
    payload: {
      readonly reason: string;
      readonly action?: 'CANCEL' | 'TERMINATE';
    },
  ): Promise<WorkflowInstanceDetail> =>
    fetchApi<WorkflowInstanceDetail>(API_ROUTES.WORKFLOWS.INSTANCE_CANCEL(id), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getInstanceHistories: (id: number): Promise<WorkflowHistoryItem[]> =>
    fetchApi<WorkflowHistoryItem[]>(API_ROUTES.WORKFLOWS.INSTANCE_HISTORIES(id)),

  scanSlaOverdue: (): Promise<WorkflowSlaScanResult> =>
    fetchApi<WorkflowSlaScanResult>(API_ROUTES.WORKFLOWS.SLA_SCAN_OVERDUE, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  listComments: (entityType: string, entityId: string): Promise<WorkflowCommentItem[]> =>
    fetchApi<WorkflowCommentItem[]>(
      API_ROUTES.WORKFLOWS.COMMENTS(
        `entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      ),
    ),

  addComment: (payload: {
    readonly entityType: string;
    readonly entityId: string;
    readonly workflowInstanceId?: number | null;
    readonly parentCommentId?: number | null;
    readonly content: string;
    readonly isInternal?: boolean;
    readonly attachmentFileIds?: readonly number[];
  }): Promise<WorkflowCommentItem> =>
    fetchApi<WorkflowCommentItem>(API_ROUTES.WORKFLOWS.COMMENTS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateComment: (
    id: number,
    payload: {
      readonly content: string;
      readonly editReason?: string | null;
    },
  ): Promise<WorkflowCommentItem> =>
    fetchApi<WorkflowCommentItem>(API_ROUTES.WORKFLOWS.COMMENT_BY_ID(id), {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteComment: (id: number): Promise<WorkflowCommentItem> =>
    fetchApi<WorkflowCommentItem>(API_ROUTES.WORKFLOWS.COMMENT_BY_ID(id), {
      method: 'DELETE',
    }),

  getTimeline: (entityType: string, entityId: string): Promise<WorkflowRecordActivityTimeline> =>
    fetchApi<WorkflowRecordActivityTimeline>(
      API_ROUTES.WORKFLOWS.TIMELINE(
        `entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      ),
    ),
};
