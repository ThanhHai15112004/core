import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  CreateWorkflowDefinitionPayload,
  StartWorkflowInstancePayload,
  WorkflowDefinitionItem,
  WorkflowHistoryItem,
  WorkflowInstanceDetail,
  WorkflowInstanceItem,
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
};
