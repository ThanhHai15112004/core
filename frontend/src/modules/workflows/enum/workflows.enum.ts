export const WORKFLOWS_TAB = {
  INSTANCES: 'INSTANCES',
  DEFINITIONS: 'DEFINITIONS',
} as const;

export type WorkflowsTabId = (typeof WORKFLOWS_TAB)[keyof typeof WORKFLOWS_TAB];

export const WORKFLOW_DEFINITION_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  DRAFT: 3,
  ARCHIVED: 4,
} as const;

export const WORKFLOW_INSTANCE_STATUS = {
  RUNNING: 1,
  COMPLETED: 2,
  REJECTED: 3,
  CANCELLED: 4,
  EXPIRED: 5,
} as const;

export const WORKFLOW_STATE_TYPE_OPTIONS = [
  { code: 'INITIAL', label: 'INITIAL (Trạng thái khởi tạo)' },
  { code: 'INTERMEDIATE', label: 'INTERMEDIATE (Trạng thái trung gian / chờ duyệt)' },
  { code: 'FINAL_APPROVED', label: 'FINAL_APPROVED (Kết thúc — Đã phê duyệt)' },
  { code: 'FINAL_REJECTED', label: 'FINAL_REJECTED (Kết thúc — Từ chối)' },
  { code: 'CANCELLED', label: 'CANCELLED (Đã hủy)' },
] as const;

export const WORKFLOW_BADGE_TONE_OPTIONS = [
  { code: 'neutral', label: 'Neutral (Xám)' },
  { code: 'info', label: 'Info (Xanh dương)' },
  { code: 'warning', label: 'Warning (Vàng cam)' },
  { code: 'success', label: 'Success (Xanh lá)' },
  { code: 'danger', label: 'Danger (Đỏ)' },
] as const;

export const WORKFLOW_CONDITION_OPERATOR_OPTIONS = [
  { code: 'eq', label: 'Bằng (=)' },
  { code: 'neq', label: 'Khác (!=)' },
  { code: 'gt', label: 'Lớn hơn (>)' },
  { code: 'gte', label: 'Lớn hơn hoặc bằng (>=)' },
  { code: 'lt', label: 'Nhỏ hơn (<)' },
  { code: 'lte', label: 'Nhỏ hơn hoặc bằng (<=)' },
  { code: 'exists', label: 'Bắt buộc tồn tại (exists)' },
] as const;

