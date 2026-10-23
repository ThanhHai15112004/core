export const ROLE_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type RoleStatusCode = (typeof ROLE_STATUS)[keyof typeof ROLE_STATUS];
export type RoleStatusName = 'ACTIVE' | 'INACTIVE';

export const DATA_SCOPE = {
  ALL: 1,
  ORG_UNIT: 2,
  SUBORDINATES: 3,
  SELF: 4,
} as const;

export type DataScopeCode = (typeof DATA_SCOPE)[keyof typeof DATA_SCOPE];
export type DataScopeName = 'ALL' | 'ORG_UNIT' | 'SUBORDINATES' | 'SELF';

export const ROLES_TAB = {
  DIRECTORY: 'directory',
  MATRIX: 'matrix',
  DATA_SCOPES: 'data-scopes',
  AUDIT_SECURITY: 'audit-security',
} as const;

export type RolesTabId = (typeof ROLES_TAB)[keyof typeof ROLES_TAB];

export const DATA_SCOPE_META: Readonly<
  Record<
    DataScopeCode,
    {
      code: DataScopeCode;
      name: DataScopeName;
      label: string;
      shortLabel: string;
      description: string;
      tone: 'accent' | 'primary' | 'secondary' | 'neutral';
    }
  >
> = {
  [DATA_SCOPE.ALL]: {
    code: DATA_SCOPE.ALL,
    name: 'ALL',
    label: 'Toàn hệ thống (ALL)',
    shortLabel: 'ALL · Toàn hệ thống',
    description:
      'Truy cập toàn bộ dữ liệu không giới hạn đơn vị. Chỉ dành cho vai trò quản trị/kiểm toán hoặc có quyền cấp hệ thống.',
    tone: 'accent',
  },
  [DATA_SCOPE.ORG_UNIT]: {
    code: DATA_SCOPE.ORG_UNIT,
    name: 'ORG_UNIT',
    label: 'Theo đơn vị / Phòng ban (ORG_UNIT)',
    shortLabel: 'ORG_UNIT · Đơn vị',
    description:
      'Truy cập dữ liệu thuộc đơn vị/chi nhánh/phòng ban mà người dùng được phân công.',
    tone: 'primary',
  },
  [DATA_SCOPE.SUBORDINATES]: {
    code: DATA_SCOPE.SUBORDINATES,
    name: 'SUBORDINATES',
    label: 'Theo cấp dưới quản lý (SUBORDINATES)',
    shortLabel: 'SUBORDINATES · Cấp dưới',
    description:
      'Truy cập dữ liệu của bản thân và các nhân sự/đơn vị cấp dưới trực thuộc quyền quản lý.',
    tone: 'secondary',
  },
  [DATA_SCOPE.SELF]: {
    code: DATA_SCOPE.SELF,
    name: 'SELF',
    label: 'Chỉ dữ liệu cá nhân (SELF)',
    shortLabel: 'SELF · Cá nhân',
    description:
      'Mặc định an toàn nhất (Least Privilege): Chỉ được xem và thao tác trên dữ liệu do chính mình sở hữu.',
    tone: 'neutral',
  },
};

export const ROLE_STATUS_LABELS: Readonly<Record<RoleStatusCode, string>> = {
  [ROLE_STATUS.ACTIVE]: 'Đang hoạt động',
  [ROLE_STATUS.INACTIVE]: 'Ngừng hoạt động',
};

export const AUDIT_ACTOR_TYPE_LABELS: Readonly<Record<number, string>> = {
  1: 'Người dùng (USER)',
  2: 'Tài khoản dịch vụ (SERVICE_ACCOUNT)',
  3: 'Hệ thống (SYSTEM)',
};

