import type { UserIdentity } from './auth.contract.js';

/**
 * Mục 4.3 — Các mức Phạm vi dữ liệu (Data Scope) chuẩn của hệ thống:
 * - 1 (ALL): Xem dữ liệu toàn hệ thống (chỉ dành cho vai trò được phép)
 * - 2 (ORG_UNIT): Xem dữ liệu của đơn vị/chi nhánh (bao gồm đơn vị con trực thuộc)
 * - 3 (SUBORDINATES): Xem dữ liệu của cấp dưới theo cây quản lý (+ dữ liệu của chính mình)
 * - 4 (SELF): Chỉ xem dữ liệu của chính mình (dùng cho người dùng thông thường)
 */
export const DATA_SCOPE = {
  ALL: 1,
  ORG_UNIT: 2,
  SUBORDINATES: 3,
  SELF: 4,
} as const;

export type DataScopeCode = (typeof DATA_SCOPE)[keyof typeof DATA_SCOPE];
export type DataScopeName = keyof typeof DATA_SCOPE;

/** Chuyển đổi giá trị bất kỳ (số hoặc chuỗi) sang mã DataScopeCode chuẩn */
export function parseDataScope(
  val: unknown,
  fallback: DataScopeCode = DATA_SCOPE.SELF,
): DataScopeCode {
  if (typeof val === 'number') {
    if (val === 1 || val === 2 || val === 3 || val === 4) {
      return val;
    }
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    const num = Number(trimmed);
    if (num === 1 || num === 2 || num === 3 || num === 4) {
      return num;
    }
    const upper = trimmed.toUpperCase();
    if (upper === 'ALL' || upper === 'GLOBAL' || upper === 'SYSTEM' || upper === 'TOAN_HE_THONG') {
      return DATA_SCOPE.ALL;
    }
    if (
      upper === 'ORG_UNIT' ||
      upper === 'UNIT' ||
      upper === 'ORGANIZATION' ||
      upper === 'DEPARTMENT' ||
      upper === 'BRANCH' ||
      upper === 'DON_VI'
    ) {
      return DATA_SCOPE.ORG_UNIT;
    }
    if (
      upper === 'SUBORDINATES' ||
      upper === 'SUBORDINATE' ||
      upper === 'MANAGER_TREE' ||
      upper === 'CAP_DUOI'
    ) {
      return DATA_SCOPE.SUBORDINATES;
    }
    if (upper === 'SELF' || upper === 'OWN' || upper === 'PERSONAL' || upper === 'CA_NHAN') {
      return DATA_SCOPE.SELF;
    }
  }
  return fallback;
}

/** Lấy tên hiển thị chuẩn (ALL | ORG_UNIT | SUBORDINATES | SELF) từ mã số nguyên */
export function getDataScopeName(code: number): DataScopeName {
  switch (code) {
    case DATA_SCOPE.ALL:
      return 'ALL';
    case DATA_SCOPE.ORG_UNIT:
      return 'ORG_UNIT';
    case DATA_SCOPE.SUBORDINATES:
      return 'SUBORDINATES';
    case DATA_SCOPE.SELF:
    default:
      return 'SELF';
  }
}

/** Suy diễn phạm vi dữ liệu mặc định theo mã vai trò (chỉ vai trò quản trị được phép mặc định ALL) */
export function inferDefaultDataScopeForRoleCode(roleCode: string): DataScopeCode {
  const normalized = roleCode.trim().toLowerCase();
  if (normalized === 'super_admin' || normalized === 'admin' || normalized.startsWith('admin_')) {
    return DATA_SCOPE.ALL;
  }
  if (
    normalized.includes('director') ||
    normalized.includes('branch') ||
    normalized.includes('org_manager') ||
    normalized.includes('unit_manager')
  ) {
    return DATA_SCOPE.ORG_UNIT;
  }
  if (
    normalized.includes('manager') ||
    normalized.includes('lead') ||
    normalized.includes('supervisor')
  ) {
    return DATA_SCOPE.SUBORDINATES;
  }
  return DATA_SCOPE.SELF;
}

/** Bộ lọc phạm vi dữ liệu đã được giải quyết để áp dụng vào truy vấn danh sách & báo cáo */
export interface ResolvedDataScopeFilter {
  readonly isUnrestricted: boolean;
  readonly effectiveScope: DataScopeCode;
  readonly effectiveScopeName: DataScopeName;
  readonly grantedScopes: readonly DataScopeCode[];
  readonly allowedUserIds: readonly number[];
  readonly allowedOrganizationUnitIds: readonly number[];
  readonly customAttributes: Readonly<Record<string, unknown>>;
  readonly appliedRuleCodes: readonly string[];
}

/** Bản ghi mục tiêu cần kiểm tra quyền truy cập phạm vi trước khi xem chi tiết (chống đổi ID / IDOR) */
export interface DataScopeRecordTarget {
  readonly id?: number | string | undefined;
  readonly ownerId?: number | null | undefined;
  readonly primaryOrganizationUnitId?: number | null | undefined;
  readonly organizationUnitIds?: readonly number[] | undefined;
  readonly managerId?: number | null | undefined;
  readonly attributes?: Readonly<Record<string, unknown>> | undefined;
  readonly [key: string]: unknown;
}

/** Ngữ cảnh đầu vào cho hàm đánh giá rule phạm vi dữ liệu của module nghiệp vụ */
export interface DataScopeEvaluationContext {
  readonly actor: UserIdentity;
  readonly resource: string;
  readonly action: string;
  readonly baseFilter: ResolvedDataScopeFilter;
  readonly target?: DataScopeRecordTarget | undefined;
}

/** Kết quả trả về từ rule phạm vi tùy chỉnh của module nghiệp vụ */
export interface DataScopeRuleEvaluationResult {
  /** Nếu trả về true/false rõ ràng khi kiểm tra bản ghi đơn lẻ, sẽ ưu tiên quyết định quyền truy cập */
  readonly allow?: boolean | undefined;
  /** Cho phép module nghiệp vụ mở rộng hoặc thu hẹp bộ lọc danh sách/báo cáo */
  readonly filterOverride?:
    | {
        readonly isUnrestricted?: boolean | undefined;
        readonly allowedUserIds?: readonly number[] | undefined;
        readonly allowedOrganizationUnitIds?: readonly number[] | undefined;
        readonly customAttributes?: Readonly<Record<string, unknown>> | undefined;
      }
    | undefined;
}

export type DataScopeRuleEvaluator = (
  context: DataScopeEvaluationContext,
) => Promise<DataScopeRuleEvaluationResult | void> | DataScopeRuleEvaluationResult | void;

/** Khai báo một rule phạm vi dữ liệu từ module nghiệp vụ (không cần sửa trực tiếp Core) */
export interface DataScopeCustomRuleDeclaration {
  readonly code: string;
  readonly resource: string;
  readonly module?: string | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly priority?: number | undefined;
  readonly evaluate: DataScopeRuleEvaluator;
}

/** Thông tin metadata của rule phạm vi dữ liệu đã đăng ký để tra cứu/hiển thị quản trị */
export interface DataScopeCustomRuleMetadata {
  readonly code: string;
  readonly resource: string;
  readonly module: string;
  readonly name: string;
  readonly description: string | null;
  readonly priority: number;
}
