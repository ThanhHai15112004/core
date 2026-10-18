import { PasswordHasherService } from '@packages/security/index.js';
import type { SeederContext, SeederContract } from '@packages/database/index.js';
import {
  ORGANIZATION_UNIT_STATUS,
  ORGANIZATION_UNIT_TYPE,
  type OrganizationUnitTypeCode,
} from '@modules/organizations/contracts/index.js';
import { PERMISSION_STATUS, ROLE_STATUS } from '@modules/roles/contracts/index.js';
import { USER_STATUS } from '@modules/users/contracts/index.js';

export const PRIVILEGED_DEFAULT_PASSWORD = '!P@ssw0rd#';

export interface SeedOrgUnitDef {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly type: OrganizationUnitTypeCode;
  readonly parentId: number | null;
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
    description: 'Trụ sở điều hành trung tâm tại TP. Hồ Chí Minh',
  },
  {
    id: 2,
    code: 'BRANCH_HCM',
    name: 'Chi nhánh TP. Hồ Chí Minh',
    type: ORGANIZATION_UNIT_TYPE.BRANCH,
    parentId: 1,
    description: 'Chi nhánh hoạt động chính tại TP. Hồ Chí Minh',
  },
  {
    id: 3,
    code: 'DEPT_ENGINEERING',
    name: 'Khối Công nghệ & Kỹ thuật Phần mềm',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    description: 'Phát triển nền tảng Core, Backend & Web tại TP.HCM',
  },
  {
    id: 4,
    code: 'DEPT_MOBILE',
    name: 'Phòng Phát triển Ứng dụng Mobile',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    description: 'Phát triển và vận hành ứng dụng iOS / Android tại TP.HCM',
  },
  {
    id: 5,
    code: 'DEPT_SECURITY',
    name: 'Phòng An toàn Thông tin (SecOps)',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    description: 'Quản trị bảo mật, mã hóa dữ liệu, IAM và kiểm toán an ninh',
  },
  {
    id: 6,
    code: 'DEPT_OPS',
    name: 'Phòng Vận hành Hệ thống (DevOps / SRE)',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    description: 'Quản trị hạ tầng Cloud, Runtimes, Database, Queue và System Console',
  },
  {
    id: 7,
    code: 'DEPT_HR',
    name: 'Phòng Hành chính - Nhân sự',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    description: 'Tuyển dụng, quản lý hồ sơ nhân sự và cơ cấu tổ chức',
  },
  {
    id: 8,
    code: 'DEPT_FINANCE',
    name: 'Phòng Tài chính - Kế toán',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    description: 'Quản lý ngân sách, kế toán và đối soát tài chính',
  },
  {
    id: 9,
    code: 'DEPT_SALES',
    name: 'Phòng Kinh doanh & Phát triển Thị trường',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
    description: 'Kinh doanh và chăm sóc đối tác tại TP.HCM',
  },
  {
    id: 10,
    code: 'DEPT_SUPPORT',
    name: 'Phòng Hỗ trợ & Dịch vụ Khách hàng',
    type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
    parentId: 2,
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
] as const;

const ALL_IAM_PERMISSION_CODES = STANDARD_IAM_PERMISSIONS.map((p) => p.code);

export const STANDARD_IAM_ROLES: readonly SeedRoleDef[] = [
  {
    id: 1,
    code: 'super_admin',
    name: 'Super Administrator (Toàn quyền Hệ thống)',
    isSystem: true,
    description: 'Đặc quyền tối cao toàn hệ thống, quản trị mọi phân hệ và cấu hình bảo mật',
    permissions: ALL_IAM_PERMISSION_CODES,
  },
  {
    id: 2,
    code: 'admin',
    name: 'System Administrator (Quản trị Hệ thống)',
    isSystem: true,
    description: 'Quản trị tổng hợp người dùng, vai trò, đơn vị và vận hành chung',
    permissions: ALL_IAM_PERMISSION_CODES,
  },
  {
    id: 3,
    code: 'admin_security',
    name: 'Security Administrator (Quản trị Bảo mật & Mã hóa)',
    isSystem: true,
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
    ],
  },
  {
    id: 5,
    code: 'admin_mobile',
    name: 'Mobile Platform Admin (Quản trị Kênh Mobile)',
    isSystem: true,
    description: 'Quản trị người dùng kênh ứng dụng di động, phiên thiết bị Mobile & OTP',
    permissions: [
      'users.read',
      'users.update',
      'users.lock',
      'auth.sessions.manage',
      'auth.mfa.manage',
      'organizations.read',
      'roles.read',
    ],
  },
  {
    id: 6,
    code: 'admin_ops',
    name: 'Operations Admin (Quản trị Vận hành Hạ tầng)',
    isSystem: true,
    description: 'Quản trị System Console, Runtimes, Database, Cache, Queue và giám sát hệ thống',
    permissions: ['users.read', 'roles.read', 'organizations.read', 'auth.settings.read'],
  },
  {
    id: 7,
    code: 'admin_finance',
    name: 'Finance Administrator (Quản trị Tài chính & Kiểm toán)',
    isSystem: false,
    description: 'Tra cứu và kết xuất báo cáo người dùng, đơn vị phục vụ đối soát và kiểm toán',
    permissions: ['users.read', 'users.export', 'organizations.read', 'roles.read'],
  },
  {
    id: 8,
    code: 'admin_support',
    name: 'Customer Support Admin (Quản trị Hỗ trợ Người dùng)',
    isSystem: false,
    description: 'Hỗ trợ mở khóa tài khoản, kiểm tra trạng thái đăng nhập và hướng dẫn người dùng',
    permissions: ['users.read', 'users.lock', 'organizations.read'],
  },
  {
    id: 9,
    code: 'branch_director',
    name: 'Branch Director (Giám đốc Chi nhánh TP.HCM)',
    isSystem: false,
    description: 'Điều hành toàn bộ hoạt động và nhân sự tại Chi nhánh TP. Hồ Chí Minh',
    permissions: ['users.read', 'users.update', 'users.export', 'organizations.read', 'roles.read'],
  },
  {
    id: 10,
    code: 'department_manager',
    name: 'Department Manager (Trưởng phòng ban)',
    isSystem: false,
    description: 'Quản lý nhân sự và công việc trong phạm vi phòng ban trực thuộc',
    permissions: ['users.read', 'organizations.read'],
  },
  {
    id: 11,
    code: 'staff',
    name: 'Standard Staff (Nhân viên Tiêu chuẩn)',
    isSystem: false,
    description: 'Nhân viên chính thức thuộc các phòng ban tại Chi nhánh TP.HCM',
    permissions: ['users.read'],
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
          `INSERT INTO organization_units (id, code, name, type, parent_id, status, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, parent_id = EXCLUDED.parent_id`,
          [
            org.id,
            org.code,
            org.name,
            org.type,
            org.parentId,
            ORGANIZATION_UNIT_STATUS.ACTIVE,
            org.description,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO organization_units (id, code, name, type, parent_id, status, description)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), parent_id = VALUES(parent_id)`,
          [
            org.id,
            org.code,
            org.name,
            org.type,
            org.parentId,
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
          `INSERT INTO roles (id, code, name, description, is_system, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
          [role.id, role.code, role.name, role.description, role.isSystem, ROLE_STATUS.ACTIVE],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO roles (id, code, name, description, is_system, status)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
          [role.id, role.code, role.name, role.description, role.isSystem, ROLE_STATUS.ACTIVE],
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
          `INSERT INTO users (id, username, email, phone, phone_hash, password_hash, status, email_verified_at, phone_verified_at, primary_organization_unit_id, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $8, 1)
           ON CONFLICT (username) DO UPDATE SET email = EXCLUDED.email, phone = EXCLUDED.phone, phone_hash = EXCLUDED.phone_hash, password_hash = EXCLUDED.password_hash`,
          [
            acc.id,
            acc.username,
            acc.email,
            acc.phone,
            phoneHash,
            privilegedPasswordHash,
            USER_STATUS.ACTIVE,
            primaryOrg.id,
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
          `INSERT INTO users (id, username, email, phone, phone_hash, password_hash, status, email_verified_at, phone_verified_at, primary_organization_unit_id, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, 1)
           ON DUPLICATE KEY UPDATE email = VALUES(email), phone = VALUES(phone), phone_hash = VALUES(phone_hash), password_hash = VALUES(password_hash)`,
          [
            acc.id,
            acc.username,
            acc.email,
            acc.phone,
            phoneHash,
            privilegedPasswordHash,
            USER_STATUS.ACTIVE,
            primaryOrg.id,
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
          password_min_length, require_uppercase, require_numbers, require_special_chars,
          allow_email_registration, allow_phone_registration, require_email_verification, require_phone_verification,
          otp_max_send_count, otp_max_attempts, otp_cooldown_seconds,
          session_idle_timeout_minutes, session_max_lifetime_minutes, enable_login_audit_log
        ) VALUES (1, 'GLOBAL', 1, 1, TRUE, 1, '["TOTP","EMAIL_OTP","RECOVERY_CODE"]', 5, 15, 8, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, 5, 5, 60, 30, 10080, TRUE)
        ON CONFLICT (scope_key) DO NOTHING`,
      );
    } else {
      await ctx.manager.query(
        `INSERT INTO auth_security_settings (
          id, scope_key, password_hash_algorithm, db_encryption_algorithm, encrypt_fields_at_rest,
          mfa_policy, allowed_mfa_methods_json, max_failed_login_attempts, lockout_duration_minutes,
          password_min_length, require_uppercase, require_numbers, require_special_chars,
          allow_email_registration, allow_phone_registration, require_email_verification, require_phone_verification,
          otp_max_send_count, otp_max_attempts, otp_cooldown_seconds,
          session_idle_timeout_minutes, session_max_lifetime_minutes, enable_login_audit_log
        ) VALUES (1, 'GLOBAL', 1, 1, TRUE, 1, '["TOTP","EMAIL_OTP","RECOVERY_CODE"]', 5, 15, 8, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, 5, 5, 60, 30, 10080, TRUE)
        ON DUPLICATE KEY UPDATE scope_key = VALUES(scope_key)`,
      );
    }

    return {
      affected,
      details: `${HCMC_ORGANIZATION_UNITS.length} HCMC org units (1 branch), ${STANDARD_IAM_PERMISSIONS.length} permissions, ${STANDARD_IAM_ROLES.length} roles, ${PRIVILEGED_ACCOUNTS.length} privileged accounts (@gmail.com) seeded`,
    };
  }
}
