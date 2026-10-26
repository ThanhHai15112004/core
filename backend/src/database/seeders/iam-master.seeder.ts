import { DATA_SCOPE, type DataScopeCode, PasswordHasherService } from '@packages/security/index.js';
import type { SeederContext, SeederContract } from '@packages/database/index.js';
import {
  ORGANIZATION_UNIT_STATUS,
  ORGANIZATION_UNIT_TYPE,
  type OrganizationUnitTypeCode,
} from '@modules/organizations/contracts/index.js';
import { PERMISSION_STATUS, ROLE_STATUS } from '@modules/roles/contracts/index.js';
import { USER_STATUS } from '@modules/users/contracts/index.js';
import { DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES } from '@modules/notifications/index.js';

export const PRIVILEGED_DEFAULT_PASSWORD = '!P@ssw0rd#';

export interface SeedOrgUnitDef {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly type: OrganizationUnitTypeCode;
  readonly parentId: number | null;
  readonly managerId: number | null;
  readonly description: string;
}

export interface SeedPermissionDef {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
}

export interface SeedRoleDef {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly isSystem: boolean;
  readonly dataScope: DataScopeCode;
  readonly description: string;
  readonly permissions: readonly string[];
}

export interface SeedPrivilegedUserDef {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly phone: string;
  readonly roleCode: string;
  readonly orgCode: string;
  readonly positionTitle: string;
  readonly managerId: number | null;
}

/**
 * Đơn vị / Chi nhánh chỉ đặt tại TP.HCM (1 Chi nhánh duy nhất BRANCH_HCM và các phòng ban trực thuộc)
 * ID đánh theo số thứ tự nguyên: 1, 2, 3, 4...10
 * Type: 1 = HEADQUARTERS, 2 = BRANCH, 3 = DEPARTMENT, 4 = TEAM
 */
export const HCMC_ORGANIZATION_UNITS: readonly SeedOrgUnitDef[] = [
  {
    id: 1,
    code: 'HQ_HCM',
    name: 'Trụ sở Chính TP. Hồ Chí Minh',
    type: ORGANIZATION_UNIT_TYPE.HEADQUARTERS,
    parentId: null,
    managerId: 1,
    description: 'Trụ sở điều hành trung tâm tại TP. Hồ Chí Minh',
  },
  {
    id: 2,
    code: 'BRANCH_HCM',
    name: 'Chi nhánh TP. Hồ Chí Minh',
    type: ORGANIZATION_UNIT_TYPE.BRANCH,
    parentId: 1,
    managerId: 9,
    description: 'Chi nhánh hoạt động chính tại TP. Hồ Chí Minh',
  },
  {
    id: 3,
    code: 'DEPT_ENGINEERING',
    name: 'Khối Công nghệ & Kỹ thuật Phần mềm',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    managerId: 10,
    description: 'Phát triển nền tảng Core, Backend & Web tại TP.HCM',
  },
  {
    id: 4,
    code: 'DEPT_MOBILE',
    name: 'Phòng Phát triển Ứng dụng Mobile',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    managerId: 10,
    description: 'Phát triển và vận hành ứng dụng iOS / Android tại TP.HCM',
  },
  {
    id: 5,
    code: 'DEPT_SECURITY',
    name: 'Phòng An toàn Thông tin (SecOps)',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    managerId: 3,
    description: 'Quản trị bảo mật, mã hóa dữ liệu, IAM và kiểm toán an ninh',
  },
  {
    id: 6,
    code: 'DEPT_OPS',
    name: 'Phòng Vận hành Hệ thống (DevOps / SRE)',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    managerId: 6,
    description: 'Quản trị hạ tầng Cloud, Runtimes, Database, Queue và System Console',
  },
  {
    id: 7,
    code: 'DEPT_HR',
    name: 'Phòng Hành chính - Nhân sự',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    managerId: 4,
    description: 'Tuyển dụng, quản lý hồ sơ nhân sự và cơ cấu tổ chức',
  },
  {
    id: 8,
    code: 'DEPT_FINANCE',
    name: 'Phòng Tài chính - Kế toán',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    managerId: 7,
    description: 'Quản lý ngân sách, kế toán và đối soát tài chính',
  },
  {
    id: 9,
    code: 'DEPT_SALES',
    name: 'Phòng Kinh doanh & Phát triển Thị trường',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    managerId: 9,
    description: 'Kinh doanh và chăm sóc đối tác tại TP.HCM',
  },
  {
    id: 10,
    code: 'DEPT_SUPPORT',
    name: 'Phòng Hỗ trợ & Dịch vụ Khách hàng',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    managerId: 8,
    description: 'Hỗ trợ kỹ thuật và giải đáp yêu cầu người dùng 24/7',
  },
] as const;

export const STANDARD_IAM_PERMISSIONS: readonly SeedPermissionDef[] = [
  {
    id: 1,
    code: 'users.read',
    name: 'Xem danh sách & chi tiết người dùng',
    module: 'users',
    description: 'Quyền tra cứu danh sách, chi tiết và lịch sử trạng thái người dùng',
  },
  {
    id: 2,
    code: 'users.create',
    name: 'Tạo mới người dùng',
    module: 'users',
    description: 'Quyền tạo mới tài khoản người dùng',
  },
  {
    id: 3,
    code: 'users.update',
    name: 'Cập nhật hồ sơ người dùng',
    module: 'users',
    description: 'Quyền chỉnh sửa họ tên, email, số điện thoại người dùng',
  },
  {
    id: 4,
    code: 'users.lock',
    name: 'Khóa / Mở khóa tài khoản',
    module: 'users',
    description: 'Quyền khóa tạm thời hoặc mở khóa tài khoản người dùng',
  },
  {
    id: 5,
    code: 'users.status',
    name: 'Quản lý trạng thái & Lưu trữ người dùng',
    module: 'users',
    description: 'Quyền chuyển trạng thái Active, Inactive, Locked, Archived',
  },
  {
    id: 6,
    code: 'users.assign_roles',
    name: 'Gán vai trò cho người dùng',
    module: 'users',
    description: 'Quyền gán hoặc gỡ vai trò (Role) của người dùng',
  },
  {
    id: 7,
    code: 'users.assign_organizations',
    name: 'Gán đơn vị / chi nhánh cho người dùng',
    module: 'users',
    description: 'Quyền phân bổ người dùng vào đơn vị, chi nhánh, phòng ban',
  },
  {
    id: 8,
    code: 'users.import',
    name: 'Nhập danh sách người dùng hàng loạt',
    module: 'users',
    description: 'Quyền import người dùng hàng loạt từ CSV/JSON',
  },
  {
    id: 9,
    code: 'users.export',
    name: 'Xuất danh sách người dùng',
    module: 'users',
    description: 'Quyền kết xuất danh sách người dùng theo bộ lọc',
  },
  {
    id: 10,
    code: 'roles.read',
    name: 'Xem danh sách vai trò & quyền hạn',
    module: 'roles',
    description: 'Quyền xem danh mục vai trò (Roles) và quyền hạn (Permissions)',
  },
  {
    id: 11,
    code: 'roles.manage',
    name: 'Quản lý vai trò & phân quyền',
    module: 'roles',
    description: 'Quyền tạo, cập nhật vai trò và gán quyền hạn cho vai trò',
  },
  {
    id: 12,
    code: 'organizations.read',
    name: 'Xem cơ cấu đơn vị / chi nhánh',
    module: 'organizations',
    description: 'Quyền xem cây sơ đồ tổ chức, đơn vị, chi nhánh, phòng ban',
  },
  {
    id: 13,
    code: 'organizations.manage',
    name: 'Quản lý cơ cấu đơn vị / chi nhánh',
    module: 'organizations',
    description: 'Quyền thêm mới và cập nhật đơn vị, chi nhánh, phòng ban',
  },
  {
    id: 14,
    code: 'auth.sessions.manage',
    name: 'Quản lý phiên đăng nhập',
    module: 'auth',
    description: 'Quyền xem và thu hồi phiên đăng nhập của người dùng',
  },
  {
    id: 15,
    code: 'auth.mfa.manage',
    name: 'Quản lý xác thực nhiều lớp (MFA)',
    module: 'auth',
    description: 'Quyền thiết lập TOTP, Email OTP và mã khôi phục dự phòng',
  },
  {
    id: 16,
    code: 'auth.settings.read',
    name: 'Xem cấu hình bảo mật & mã hóa',
    module: 'auth',
    description: 'Quyền xem cấu hình thuật toán băm mật khẩu, mã hóa DB và chính sách MFA',
  },
  {
    id: 17,
    code: 'auth.settings.write',
    name: 'Cập nhật cấu hình bảo mật & mã hóa',
    module: 'auth',
    description: 'Quyền thay đổi thuật toán băm mật khẩu, mã hóa DB và chính sách bảo mật',
  },
  {
    id: 18,
    code: 'codes.read',
    name: 'Xem danh mục động & mã chuẩn hệ thống',
    module: 'codes',
    description: 'Quyền xem danh sách nhóm danh mục (code_types) và giá trị danh mục (code_values)',
  },
  {
    id: 19,
    code: 'codes.manage',
    name: 'Quản trị danh mục động & đồng bộ Manifest',
    module: 'codes',
    description:
      'Quyền thêm mới, chỉnh sửa, ẩn/hiện giá trị danh mục động và đồng bộ từ module.manifest.json',
  },
  {
    id: 20,
    code: 'settings.read',
    name: 'Xem cấu hình hệ thống & tham số vận hành',
    module: 'settings',
    description:
      'Quyền xem danh sách nhóm cấu hình, tham số hệ thống, ghi đè theo môi trường/đơn vị và lịch sử thay đổi',
  },
  {
    id: 21,
    code: 'settings.manage',
    name: 'Quản trị cấu hình hệ thống & đồng bộ Manifest',
    module: 'settings',
    description:
      'Quyền thêm mới, cập nhật giá trị cấu hình, ghi đè theo môi trường/đơn vị và đồng bộ từ module.manifest.json',
  },
  {
    id: 22,
    code: 'files.read',
    name: 'Xem danh sách & thông tin tệp tin',
    module: 'files',
    description:
      'Quyền tra cứu danh sách tệp tin, xem thông tin chi tiết và theo dõi liên kết sử dụng tệp tin',
  },
  {
    id: 23,
    code: 'files.upload',
    name: 'Tải tệp tin lên hệ thống',
    module: 'files',
    description: 'Quyền tải lên một hoặc nhiều tệp tin vào kho lưu trữ dùng chung',
  },
  {
    id: 24,
    code: 'files.download',
    name: 'Tải tệp tin xuống & xem luồng Media',
    module: 'files',
    description: 'Quyền tải xuống tệp tin và phát luồng video/media có kiểm soát',
  },
  {
    id: 25,
    code: 'files.manage',
    name: 'Đổi tên, quản lý thư mục & liên kết tệp tin',
    module: 'files',
    description:
      'Quyền tạo thư mục, đổi tên hiển thị tệp tin, đưa vào thùng rác, khôi phục và quản lý liên kết sử dụng',
  },
  {
    id: 26,
    code: 'files.delete',
    name: 'Xóa vĩnh viễn tệp tin khỏi thùng rác',
    module: 'files',
    description: 'Quyền xóa vĩnh viễn tệp tin và dọn dẹp thùng rác khi không còn liên kết dữ liệu',
  },
  {
    id: 27,
    code: 'notifications.read',
    name: 'Xem thông báo & lịch sử phát thông báo',
    module: 'notifications',
    description: 'Quyền xem hộp thư thông báo và tra cứu lịch sử phát thông báo trong hệ thống',
  },
  {
    id: 28,
    code: 'notifications.send',
    name: 'Tạo & phát thông báo trong hệ thống',
    module: 'notifications',
    description:
      'Quyền tạo và gửi thông báo cho cá nhân, nhóm người dùng, theo vai trò hoặc theo đơn vị tổ chức',
  },
  {
    id: 29,
    code: 'notifications.manage',
    name: 'Quản trị cấu hình & chính sách thông báo',
    module: 'notifications',
    description:
      'Quyền quản trị cấu hình vận hành hệ thống thông báo, kênh phát, hạn mức và chính sách sở thích nhận thông báo',
  },
] as const;

const ALL_IAM_PERMISSION_CODES = STANDARD_IAM_PERMISSIONS.map((p) => p.code);

export const STANDARD_IAM_ROLES: readonly SeedRoleDef[] = [
  {
    id: 1,
    code: 'super_admin',
    name: 'Super Administrator (Toàn quyền Hệ thống)',
    isSystem: true,
    dataScope: DATA_SCOPE.ALL,
    description: 'Đặc quyền tối cao toàn hệ thống, quản trị mọi phân hệ và cấu hình bảo mật',
    permissions: ALL_IAM_PERMISSION_CODES,
  },
  {
    id: 2,
    code: 'admin',
    name: 'System Administrator (Quản trị Hệ thống)',
    isSystem: true,
    dataScope: DATA_SCOPE.ALL,
    description: 'Quản trị tổng hợp người dùng, vai trò, đơn vị và vận hành chung',
    permissions: ALL_IAM_PERMISSION_CODES,
  },
  {
    id: 3,
    code: 'admin_security',
    name: 'Security Administrator (Quản trị Bảo mật & Mã hóa)',
    isSystem: true,
    dataScope: DATA_SCOPE.ALL,
    description: 'Quản trị thuật toán mã hóa, chính sách MFA, khóa tài khoản và thu hồi phiên',
    permissions: [
      'users.read',
      'users.lock',
      'users.status',
      'roles.read',
      'roles.manage',
      'auth.sessions.manage',
      'auth.mfa.manage',
      'auth.settings.read',
      'auth.settings.write',
    ],
  },
  {
    id: 4,
    code: 'admin_hr',
    name: 'HR Administrator (Quản trị Nhân sự & Tổ chức)',
    isSystem: true,
    dataScope: DATA_SCOPE.ALL,
    description: 'Quản lý hồ sơ nhân sự, sơ đồ phòng ban, nhập/xuất danh sách người dùng hàng loạt',
    permissions: [
      'users.read',
      'users.create',
      'users.update',
      'users.status',
      'users.assign_organizations',
      'users.import',
      'users.export',
      'organizations.read',
      'organizations.manage',
      'roles.read',
      'codes.read',
      'codes.manage',
    ],
  },
  {
    id: 5,
    code: 'admin_mobile',
    name: 'Mobile Platform Admin (Quản trị Kênh Mobile)',
    isSystem: true,
    dataScope: DATA_SCOPE.ALL,
    description: 'Quản trị người dùng kênh ứng dụng di động, phiên thiết bị Mobile & OTP',
    permissions: [
      'users.read',
      'users.update',
      'users.lock',
      'auth.sessions.manage',
      'auth.mfa.manage',
      'organizations.read',
      'roles.read',
      'codes.read',
    ],
  },
  {
    id: 6,
    code: 'admin_ops',
    name: 'Operations Admin (Quản trị Vận hành Hạ tầng)',
    isSystem: true,
    dataScope: DATA_SCOPE.ALL,
    description: 'Quản trị System Console, Runtimes, Database, Cache, Queue và giám sát hệ thống',
    permissions: [
      'users.read',
      'roles.read',
      'organizations.read',
      'auth.settings.read',
      'codes.read',
      'codes.manage',
    ],
  },
  {
    id: 7,
    code: 'admin_finance',
    name: 'Finance Administrator (Quản trị Tài chính & Kiểm toán)',
    isSystem: false,
    dataScope: DATA_SCOPE.ALL,
    description: 'Tra cứu và kết xuất báo cáo người dùng, đơn vị phục vụ đối soát và kiểm toán',
    permissions: ['users.read', 'users.export', 'organizations.read', 'roles.read', 'codes.read'],
  },
  {
    id: 8,
    code: 'admin_support',
    name: 'Customer Support Admin (Quản trị Hỗ trợ Người dùng)',
    isSystem: false,
    dataScope: DATA_SCOPE.ALL,
    description: 'Hỗ trợ mở khóa tài khoản, kiểm tra trạng thái đăng nhập và hướng dẫn người dùng',
    permissions: ['users.read', 'users.lock', 'organizations.read', 'codes.read'],
  },
  {
    id: 9,
    code: 'branch_director',
    name: 'Branch Director (Giám đốc Chi nhánh TP.HCM)',
    isSystem: false,
    dataScope: DATA_SCOPE.ORG_UNIT,
    description: 'Điều hành toàn bộ hoạt động và nhân sự tại Chi nhánh TP. Hồ Chí Minh',
    permissions: [
      'users.read',
      'users.update',
      'users.export',
      'organizations.read',
      'roles.read',
      'codes.read',
    ],
  },
  {
    id: 10,
    code: 'department_manager',
    name: 'Department Manager (Trưởng phòng ban)',
    isSystem: false,
    dataScope: DATA_SCOPE.SUBORDINATES,
    description: 'Quản lý nhân sự và công việc trong phạm vi phòng ban trực thuộc',
    permissions: ['users.read', 'organizations.read', 'codes.read'],
  },
  {
    id: 11,
    code: 'staff',
    name: 'Standard Staff (Nhân viên Tiêu chuẩn)',
    isSystem: false,
    dataScope: DATA_SCOPE.SELF,
    description: 'Nhân viên chính thức thuộc các phòng ban tại Chi nhánh TP.HCM',
    permissions: ['users.read', 'codes.read'],
  },
] as const;

/**
 * 10 Tài khoản Đặc quyền Cố định (ID: 1..10, Mật khẩu: `!P@ssw0rd#`, Email: `@gmail.com`)
 */
export const PRIVILEGED_ACCOUNTS: readonly SeedPrivilegedUserDef[] = [
  {
    id: 1,
    username: 'superadmin',
    email: 'superadmin@gmail.com',
    firstName: 'Sơn',
    lastName: 'Nguyễn Thái',
    fullName: 'Nguyễn Thái Sơn',
    phone: '0901112233',
    roleCode: 'super_admin',
    orgCode: 'HQ_HCM',
    positionTitle: 'Tổng Giám đốc Công nghệ (CTO)',
    managerId: null,
  },
  {
    id: 2,
    username: 'admin',
    email: 'admin@gmail.com',
    firstName: 'Đức',
    lastName: 'Trần Minh',
    fullName: 'Trần Minh Đức',
    phone: '0902223344',
    roleCode: 'admin',
    orgCode: 'HQ_HCM',
    positionTitle: 'Quản trị viên Hệ thống Cấp cao',
    managerId: 1,
  },
  {
    id: 3,
    username: 'admin_security',
    email: 'admin.security@gmail.com',
    firstName: 'Nam',
    lastName: 'Lê Hoàng',
    fullName: 'Lê Hoàng Nam',
    phone: '0903334455',
    roleCode: 'admin_security',
    orgCode: 'DEPT_SECURITY',
    positionTitle: 'Giám đốc An toàn Thông tin (CISO)',
    managerId: 1,
  },
  {
    id: 4,
    username: 'admin_hr',
    email: 'admin.hr@gmail.com',
    firstName: 'Hà',
    lastName: 'Phạm Thu',
    fullName: 'Phạm Thu Hà',
    phone: '0904445566',
    roleCode: 'admin_hr',
    orgCode: 'DEPT_HR',
    positionTitle: 'Giám đốc Nhân sự (CHRO)',
    managerId: 1,
  },
  {
    id: 5,
    username: 'admin_mobile',
    email: 'admin.mobile@gmail.com',
    firstName: 'Tuấn',
    lastName: 'Võ Quốc',
    fullName: 'Võ Quốc Tuấn',
    phone: '0905556677',
    roleCode: 'admin_mobile',
    orgCode: 'DEPT_MOBILE',
    positionTitle: 'Trưởng phòng Nền tảng Mobile',
    managerId: 9,
  },
  {
    id: 6,
    username: 'admin_ops',
    email: 'admin.ops@gmail.com',
    firstName: 'Dũng',
    lastName: 'Đặng Tiến',
    fullName: 'Đặng Tiến Dũng',
    phone: '0906667788',
    roleCode: 'admin_ops',
    orgCode: 'DEPT_OPS',
    positionTitle: 'Trưởng phòng Vận hành Hạ tầng (Lead SRE)',
    managerId: 9,
  },
  {
    id: 7,
    username: 'admin_finance',
    email: 'admin.finance@gmail.com',
    firstName: 'Mai',
    lastName: 'Bùi Ngọc',
    fullName: 'Bùi Ngọc Mai',
    phone: '0907778899',
    roleCode: 'admin_finance',
    orgCode: 'DEPT_FINANCE',
    positionTitle: 'Kế toán Trưởng (CFO)',
    managerId: 9,
  },
  {
    id: 8,
    username: 'admin_support',
    email: 'admin.support@gmail.com',
    firstName: 'Tùng',
    lastName: 'Hoàng Thanh',
    fullName: 'Hoàng Thanh Tùng',
    phone: '0908889900',
    roleCode: 'admin_support',
    orgCode: 'DEPT_SUPPORT',
    positionTitle: 'Trưởng bộ phận Hỗ trợ 24/7',
    managerId: 9,
  },
  {
    id: 9,
    username: 'director_hcm',
    email: 'director.hcm@gmail.com',
    firstName: 'Linh',
    lastName: 'Đỗ Khánh',
    fullName: 'Đỗ Khánh Linh',
    phone: '0909990011',
    roleCode: 'branch_director',
    orgCode: 'BRANCH_HCM',
    positionTitle: 'Giám đốc Chi nhánh TP. Hồ Chí Minh',
    managerId: 1,
  },
  {
    id: 10,
    username: 'manager_eng',
    email: 'manager.eng@gmail.com',
    firstName: 'Huy',
    lastName: 'Ngô Quang',
    fullName: 'Ngô Quang Huy',
    phone: '0912345678',
    roleCode: 'department_manager',
    orgCode: 'DEPT_ENGINEERING',
    positionTitle: 'Giám đốc Kỹ thuật Phần mềm',
    managerId: 9,
  },
] as const;

export class IamMasterSeeder implements SeederContract {
  public readonly name = 'IamMasterOrganizationsRolesAndAdminsSeeder';
  public readonly scope = 'master' as const;
  public readonly order = 15;

  private readonly passwordHasher = new PasswordHasherService();

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    const isPostgres = ctx.driver === 'postgres';
    let affected = 0;

    const orgByCode = new Map(HCMC_ORGANIZATION_UNITS.map((o) => [o.code, o]));
    const roleByCode = new Map(STANDARD_IAM_ROLES.map((r) => [r.code, r]));

    // 1. Seed Organization Units tại TP.HCM (1 Chi nhánh, ID: 1..10)
    for (const org of HCMC_ORGANIZATION_UNITS) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO organization_units (id, code, name, type, parent_id, manager_id, status, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, parent_id = EXCLUDED.parent_id, manager_id = EXCLUDED.manager_id`,
          [
            org.id,
            org.code,
            org.name,
            org.type,
            org.parentId,
            org.managerId,
            ORGANIZATION_UNIT_STATUS.ACTIVE,
            org.description,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO organization_units (id, code, name, type, parent_id, manager_id, status, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), parent_id = VALUES(parent_id), manager_id = VALUES(manager_id)`,
          [
            org.id,
            org.code,
            org.name,
            org.type,
            org.parentId,
            org.managerId,
            ORGANIZATION_UNIT_STATUS.ACTIVE,
            org.description,
          ],
        );
      }
      affected++;
    }

    // 2. Seed Permissions vào bảng `permissions` độc lập
    const permIdByCode = new Map<string, number>();
    for (const perm of STANDARD_IAM_PERMISSIONS) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO permissions (code, name, module, description, status)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, module = EXCLUDED.module, description = EXCLUDED.description`,
          [perm.code, perm.name, perm.module, perm.description, PERMISSION_STATUS.ACTIVE],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO permissions (code, name, module, description, status)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module), description = VALUES(description)`,
          [perm.code, perm.name, perm.module, perm.description, PERMISSION_STATUS.ACTIVE],
        );
      }
    }

    const dbPerms = (await ctx.manager.query(`SELECT id, code FROM permissions`)) as Array<{
      id: number;
      code: string;
    }>;
    for (const row of dbPerms) {
      permIdByCode.set(String(row.code), Number(row.id));
    }

    // 3. Seed Roles (ID: 1..11) & Role Permissions (role_id INT, permission_id INT)
    for (const role of STANDARD_IAM_ROLES) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO roles (id, code, name, description, is_system, data_scope, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, data_scope = EXCLUDED.data_scope`,
          [
            role.id,
            role.code,
            role.name,
            role.description,
            role.isSystem,
            role.dataScope,
            ROLE_STATUS.ACTIVE,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO roles (id, code, name, description, is_system, data_scope, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), data_scope = VALUES(data_scope)`,
          [
            role.id,
            role.code,
            role.name,
            role.description,
            role.isSystem,
            role.dataScope,
            ROLE_STATUS.ACTIVE,
          ],
        );
      }
      affected++;

      for (const permCode of role.permissions) {
        const permId = permIdByCode.get(permCode);
        if (!permId) continue;

        if (isPostgres) {
          await ctx.manager.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES ($1, $2)
             ON CONFLICT (role_id, permission_id) DO NOTHING`,
            [role.id, permId],
          );
        } else {
          await ctx.manager.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE permission_id = VALUES(permission_id)`,
            [role.id, permId],
          );
        }
      }
    }

    // 4. Seed 10 Tài khoản Đặc quyền (ID: 1..10, Mật khẩu: !P@ssw0rd#, Email: @gmail.com)
    const privilegedPasswordHash = await this.passwordHasher.hash(PRIVILEGED_DEFAULT_PASSWORD);
    const branchHcmId = orgByCode.get('BRANCH_HCM')!.id;

    for (const acc of PRIVILEGED_ACCOUNTS) {
      const role = roleByCode.get(acc.roleCode)!;
      const primaryOrg = orgByCode.get(acc.orgCode)!;
      const phoneHash = this.passwordHasher.sha256(acc.phone.trim());

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO users (id, username, email, phone, phone_hash, password_hash, status, email_verified_at, phone_verified_at, primary_organization_unit_id, manager_id, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $8, $9, 1)
           ON CONFLICT (username) DO UPDATE SET email = EXCLUDED.email, phone = EXCLUDED.phone, phone_hash = EXCLUDED.phone_hash, password_hash = EXCLUDED.password_hash, manager_id = EXCLUDED.manager_id`,
          [
            acc.id,
            acc.username,
            acc.email,
            acc.phone,
            phoneHash,
            privilegedPasswordHash,
            USER_STATUS.ACTIVE,
            primaryOrg.id,
            acc.managerId,
          ],
        );
        await ctx.manager.query(
          `INSERT INTO user_profiles (user_id, first_name, last_name, full_name, city, country)
           VALUES ($1, $2, $3, $4, 'TP. Hồ Chí Minh', 'Việt Nam')
           ON CONFLICT (user_id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, full_name = EXCLUDED.full_name`,
          [acc.id, acc.firstName, acc.lastName, acc.fullName],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO users (id, username, email, phone, phone_hash, password_hash, status, email_verified_at, phone_verified_at, primary_organization_unit_id, manager_id, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, 1)
           ON DUPLICATE KEY UPDATE email = VALUES(email), phone = VALUES(phone), phone_hash = VALUES(phone_hash), password_hash = VALUES(password_hash), manager_id = VALUES(manager_id)`,
          [
            acc.id,
            acc.username,
            acc.email,
            acc.phone,
            phoneHash,
            privilegedPasswordHash,
            USER_STATUS.ACTIVE,
            primaryOrg.id,
            acc.managerId,
          ],
        );
        await ctx.manager.query(
          `INSERT INTO user_profiles (user_id, first_name, last_name, full_name, city, country)
           VALUES (?, ?, ?, ?, 'TP. Hồ Chí Minh', 'Việt Nam')
           ON DUPLICATE KEY UPDATE first_name = VALUES(first_name), last_name = VALUES(last_name), full_name = VALUES(full_name)`,
          [acc.id, acc.firstName, acc.lastName, acc.fullName],
        );
      }

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO user_roles (user_id, role_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [acc.id, role.id],
        );
        await ctx.manager.query(
          `INSERT INTO user_organization_units (user_id, organization_unit_id, is_primary, position_title)
           VALUES ($1, $2, TRUE, $3)
           ON CONFLICT (user_id, organization_unit_id) DO UPDATE SET is_primary = TRUE, position_title = EXCLUDED.position_title`,
          [acc.id, primaryOrg.id, acc.positionTitle],
        );
        if (primaryOrg.id !== branchHcmId) {
          await ctx.manager.query(
            `INSERT INTO user_organization_units (user_id, organization_unit_id, is_primary, position_title)
             VALUES ($1, $2, FALSE, $3)
             ON CONFLICT (user_id, organization_unit_id) DO NOTHING`,
            [acc.id, branchHcmId, acc.positionTitle],
          );
        }
      } else {
        await ctx.manager.query(
          `INSERT INTO user_roles (user_id, role_id)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)`,
          [acc.id, role.id],
        );
        await ctx.manager.query(
          `INSERT INTO user_organization_units (user_id, organization_unit_id, is_primary, position_title)
           VALUES (?, ?, TRUE, ?)
           ON DUPLICATE KEY UPDATE is_primary = TRUE, position_title = VALUES(position_title)`,
          [acc.id, primaryOrg.id, acc.positionTitle],
        );
        if (primaryOrg.id !== branchHcmId) {
          await ctx.manager.query(
            `INSERT INTO user_organization_units (user_id, organization_unit_id, is_primary, position_title)
             VALUES (?, ?, FALSE, ?)
             ON DUPLICATE KEY UPDATE position_title = VALUES(position_title)`,
            [acc.id, branchHcmId, acc.positionTitle],
          );
        }
      }
      affected++;
    }

    // 5. Seed Default Global Security Settings (ID = 1, password_hash_algorithm = 1, db_encryption_algorithm = 1, mfa_policy = 1)
    if (isPostgres) {
      await ctx.manager.query(
        `INSERT INTO auth_security_settings (
          id, scope_key, password_hash_algorithm, db_encryption_algorithm, encrypt_fields_at_rest,
          mfa_policy, allowed_mfa_methods_json, max_failed_login_attempts, lockout_duration_minutes,
          password_min_length, require_uppercase, require_numbers, require_special_chars
        ) VALUES (1, 'GLOBAL', 1, 1, TRUE, 1, '["TOTP","EMAIL_OTP","RECOVERY_CODE"]', 5, 15, 8, TRUE, TRUE, TRUE)
        ON CONFLICT (scope_key) DO NOTHING`,
      );
    } else {
      await ctx.manager.query(
        `INSERT INTO auth_security_settings (
          id, scope_key, password_hash_algorithm, db_encryption_algorithm, encrypt_fields_at_rest,
          mfa_policy, allowed_mfa_methods_json, max_failed_login_attempts, lockout_duration_minutes,
          password_min_length, require_uppercase, require_numbers, require_special_chars
        ) VALUES (1, 'GLOBAL', 1, 1, TRUE, 1, '["TOTP","EMAIL_OTP","RECOVERY_CODE"]', 5, 15, 8, TRUE, TRUE, TRUE)
        ON DUPLICATE KEY UPDATE scope_key = VALUES(scope_key)`,
      );
    }

    // 6. Seed Sample Initial Audit Logs (Mục 4.4 — Nhật ký thao tác: User, Service Account, System)
    const sampleAuditLogs = [
      {
        id: 1,
        actorType: 1,
        actorUserId: 1,
        actorServiceAccountId: null,
        actorApiClientId: null,
        actorIdentifier: 'superadmin',
        module: 'roles',
        feature: 'role-management',
        action: 'role.update',
        resourceType: 'role',
        resourceId: '9',
        beforeData: JSON.stringify({ code: 'branch_director', dataScope: 1 }),
        afterData: JSON.stringify({ code: 'branch_director', dataScope: 2 }),
        reason: 'Cập nhật phạm vi dữ liệu (Data Scope) Giám đốc Chi nhánh sang UNIT',
        ipAddress: '10.10.1.15',
        userAgent: 'Mozilla/5.0 (IAM Console)',
        requestId: 'req-seed-audit-001',
        correlationId: 'corr-seed-audit-001',
      },
      {
        id: 2,
        actorType: 1,
        actorUserId: 2,
        actorServiceAccountId: null,
        actorApiClientId: null,
        actorIdentifier: 'admin_iam',
        module: 'users',
        feature: 'user-status',
        action: 'user.unlock',
        resourceType: 'user',
        resourceId: '8',
        beforeData: JSON.stringify({ status: 3, lockReason: 'Exceeded failed login attempts' }),
        afterData: JSON.stringify({ status: 1, lockReason: null, failedLoginAttempts: 0 }),
        reason: 'Xác minh danh tính hợp lệ và mở khóa tài khoản theo ticket #IAM-402',
        ipAddress: '10.10.1.22',
        userAgent: 'Mozilla/5.0 (IAM Console)',
        requestId: 'req-seed-audit-002',
        correlationId: 'corr-seed-audit-002',
      },
      {
        id: 3,
        actorType: 2,
        actorUserId: null,
        actorServiceAccountId: 1,
        actorApiClientId: 1,
        actorIdentifier: 'SA_ERP_SYNC:cli_erp_sync_prod',
        module: 'auth',
        feature: 'api-client-token',
        action: 'api_client.issue_token',
        resourceType: 'api_client',
        resourceId: '1',
        beforeData: null,
        afterData: JSON.stringify({
          serviceAccountCode: 'SA_ERP_SYNC',
          scopes: ['users.read', 'organizations.read'],
        }),
        reason: 'Issued M2M access token for SA_ERP_SYNC',
        ipAddress: '172.16.10.50',
        userAgent: 'Core-ERP-Sync-Worker/2.1',
        requestId: 'req-seed-audit-003',
        correlationId: 'corr-seed-audit-003',
      },
    ];

    for (const log of sampleAuditLogs) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO audit_logs (
            id, actor_type, actor_user_id, actor_service_account_id, actor_api_client_id,
            actor_identifier, module, feature, action, resource_type, resource_id,
            before_data, after_data, reason, ip_address, user_agent, request_id, correlation_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (id) DO NOTHING`,
          [
            log.id,
            log.actorType,
            log.actorUserId,
            log.actorServiceAccountId,
            log.actorApiClientId,
            log.actorIdentifier,
            log.module,
            log.feature,
            log.action,
            log.resourceType,
            log.resourceId,
            log.beforeData,
            log.afterData,
            log.reason,
            log.ipAddress,
            log.userAgent,
            log.requestId,
            log.correlationId,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO audit_logs (
            id, actor_type, actor_user_id, actor_service_account_id, actor_api_client_id,
            actor_identifier, module, feature, action, resource_type, resource_id,
            before_data, after_data, reason, ip_address, user_agent, request_id, correlation_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE action = VALUES(action)`,
          [
            log.id,
            log.actorType,
            log.actorUserId,
            log.actorServiceAccountId,
            log.actorApiClientId,
            log.actorIdentifier,
            log.module,
            log.feature,
            log.action,
            log.resourceType,
            log.resourceId,
            log.beforeData,
            log.afterData,
            log.reason,
            log.ipAddress,
            log.userAgent,
            log.requestId,
            log.correlationId,
          ],
        );
      }
    }

    // 7. Seed Default System Notification Templates (Phase 7 — Mục 7.2)
    try {
      for (const tpl of DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES) {
        const varsJson = JSON.stringify(tpl.variables);
        if (isPostgres) {
          await ctx.manager.query(
            `INSERT INTO notification_templates (
              code, name, channel, category, locale, subject_template, body_template, html_template, variables_json, is_active, is_system
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10)
            ON CONFLICT (code, channel, locale) DO UPDATE SET
              name = EXCLUDED.name,
              subject_template = EXCLUDED.subject_template,
              body_template = EXCLUDED.body_template,
              html_template = EXCLUDED.html_template,
              variables_json = EXCLUDED.variables_json`,
            [
              tpl.code,
              tpl.name,
              tpl.channel,
              tpl.category,
              tpl.locale,
              tpl.subjectTemplate,
              tpl.bodyTemplate,
              tpl.htmlTemplate,
              varsJson,
              tpl.isSystem,
            ],
          );
        } else {
          await ctx.manager.query(
            `INSERT INTO notification_templates (
              code, name, channel, category, locale, subject_template, body_template, html_template, variables_json, is_active, is_system
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)
            ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              subject_template = VALUES(subject_template),
              body_template = VALUES(body_template),
              html_template = VALUES(html_template),
              variables_json = VALUES(variables_json)`,
            [
              tpl.code,
              tpl.name,
              tpl.channel,
              tpl.category,
              tpl.locale,
              tpl.subjectTemplate,
              tpl.bodyTemplate,
              tpl.htmlTemplate,
              varsJson,
              tpl.isSystem,
            ],
          );
        }
        affected++;
      }
    } catch {
      // Ignore if notification_templates table is not yet migrated in isolated environments
    }

    return {
      affected,
      details: `${HCMC_ORGANIZATION_UNITS.length} HCMC org units (1 branch), ${STANDARD_IAM_PERMISSIONS.length} permissions, ${STANDARD_IAM_ROLES.length} roles, ${PRIVILEGED_ACCOUNTS.length} privileged accounts (@gmail.com) seeded`,
    };
  }
}
