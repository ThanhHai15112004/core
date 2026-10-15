import { PasswordHasherService } from '@packages/security/index.js';
import type { SeederContext, SeederContract } from '@packages/database/index.js';

export const PRIVILEGED_DEFAULT_PASSWORD = '!P@ssw0rd#';

export interface SeedOrgUnitDef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: 'HEADQUARTERS' | 'BRANCH' | 'DEPARTMENT' | 'TEAM';
  readonly parentId: string | null;
  readonly description: string;
}

export interface SeedRoleDef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isSystem: boolean;
  readonly description: string;
  readonly permissions: readonly string[];
}

export interface SeedPrivilegedUserDef {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly fullName: string;
  readonly phone: string;
  readonly roleCode: string;
  readonly orgCode: string;
  readonly positionTitle: string;
}

/**
 * Đơn vị / Chi nhánh chỉ đặt tại TP.HCM (1 Chi nhánh duy nhất BRANCH_HCM và các phòng ban trực thuộc)
 */
export const HCMC_ORGANIZATION_UNITS: readonly SeedOrgUnitDef[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    code: 'HQ_HCM',
    name: 'Trụ sở Chính TP. Hồ Chí Minh',
    type: 'HEADQUARTERS',
    parentId: null,
    description: 'Trụ sở điều hành trung tâm tại TP. Hồ Chí Minh',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    code: 'BRANCH_HCM',
    name: 'Chi nhánh TP. Hồ Chí Minh',
    type: 'BRANCH',
    parentId: '10000000-0000-4000-8000-000000000001',
    description: 'Chi nhánh hoạt động chính tại TP. Hồ Chí Minh',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    code: 'DEPT_ENGINEERING',
    name: 'Khối Công nghệ & Kỹ thuật Phần mềm',
    type: 'DEPARTMENT',
    parentId: '10000000-0000-4000-8000-000000000002',
    description: 'Phát triển nền tảng Core, Backend & Web tại TP.HCM',
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    code: 'DEPT_MOBILE',
    name: 'Phòng Phát triển Ứng dụng Mobile',
    type: 'DEPARTMENT',
    parentId: '10000000-0000-4000-8000-000000000002',
    description: 'Phát triển và vận hành ứng dụng iOS / Android tại TP.HCM',
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    code: 'DEPT_SECURITY',
    name: 'Phòng An toàn Thông tin (SecOps)',
    type: 'DEPARTMENT',
    parentId: '10000000-0000-4000-8000-000000000002',
    description: 'Quản trị bảo mật, mã hóa dữ liệu, IAM và kiểm toán an ninh',
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    code: 'DEPT_OPS',
    name: 'Phòng Vận hành Hệ thống (DevOps / SRE)',
    type: 'DEPARTMENT',
    parentId: '10000000-0000-4000-8000-000000000002',
    description: 'Quản trị hạ tầng Cloud, Runtimes, Database, Queue và System Console',
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    code: 'DEPT_HR',
    name: 'Phòng Hành chính - Nhân sự',
    type: 'DEPARTMENT',
    parentId: '10000000-0000-4000-8000-000000000002',
    description: 'Tuyển dụng, quản lý hồ sơ nhân sự và cơ cấu tổ chức',
  },
  {
    id: '10000000-0000-4000-8000-000000000008',
    code: 'DEPT_FINANCE',
    name: 'Phòng Tài chính - Kế toán',
    type: 'DEPARTMENT',
    parentId: '10000000-0000-4000-8000-000000000002',
    description: 'Quản lý ngân sách, kế toán và đối soát tài chính',
  },
  {
    id: '10000000-0000-4000-8000-000000000009',
    code: 'DEPT_SALES',
    name: 'Phòng Kinh doanh & Phát triển Thị trường',
    type: 'DEPARTMENT',
    parentId: '10000000-0000-4000-8000-000000000002',
    description: 'Kinh doanh và chăm sóc đối tác tại TP.HCM',
  },
  {
    id: '10000000-0000-4000-8000-000000000010',
    code: 'DEPT_SUPPORT',
    name: 'Phòng Hỗ trợ & Dịch vụ Khách hàng',
    type: 'DEPARTMENT',
    parentId: '10000000-0000-4000-8000-000000000002',
    description: 'Hỗ trợ kỹ thuật và giải đáp yêu cầu người dùng 24/7',
  },
] as const;

const ALL_IAM_PERMISSIONS = [
  'users.read',
  'users.create',
  'users.update',
  'users.lock',
  'users.status',
  'users.assign_roles',
  'users.assign_organizations',
  'users.import',
  'users.export',
  'roles.read',
  'roles.manage',
  'organizations.read',
  'organizations.manage',
  'auth.sessions.manage',
  'auth.mfa.manage',
  'auth.settings.read',
  'auth.settings.write',
] as const;

export const STANDARD_IAM_ROLES: readonly SeedRoleDef[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    code: 'super_admin',
    name: 'Super Administrator (Toàn quyền Hệ thống)',
    isSystem: true,
    description: 'Đặc quyền tối cao toàn hệ thống, quản trị mọi phân hệ và cấu hình bảo mật',
    permissions: ALL_IAM_PERMISSIONS,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    code: 'admin',
    name: 'System Administrator (Quản trị Hệ thống)',
    isSystem: true,
    description: 'Quản trị tổng hợp người dùng, vai trò, đơn vị và vận hành chung',
    permissions: ALL_IAM_PERMISSIONS,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
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
    id: '20000000-0000-4000-8000-000000000004',
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
    id: '20000000-0000-4000-8000-000000000005',
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
    id: '20000000-0000-4000-8000-000000000006',
    code: 'admin_ops',
    name: 'Operations Admin (Quản trị Vận hành Hạ tầng)',
    isSystem: true,
    description: 'Quản trị System Console, Runtimes, Database, Cache, Queue và giám sát hệ thống',
    permissions: ['users.read', 'roles.read', 'organizations.read', 'auth.settings.read'],
  },
  {
    id: '20000000-0000-4000-8000-000000000007',
    code: 'admin_finance',
    name: 'Finance Administrator (Quản trị Tài chính & Kiểm toán)',
    isSystem: false,
    description: 'Tra cứu và kết xuất báo cáo người dùng, đơn vị phục vụ đối soát và kiểm toán',
    permissions: ['users.read', 'users.export', 'organizations.read', 'roles.read'],
  },
  {
    id: '20000000-0000-4000-8000-000000000008',
    code: 'admin_support',
    name: 'Customer Support Admin (Quản trị Hỗ trợ Người dùng)',
    isSystem: false,
    description: 'Hỗ trợ mở khóa tài khoản, kiểm tra trạng thái đăng nhập và hướng dẫn người dùng',
    permissions: ['users.read', 'users.lock', 'organizations.read'],
  },
  {
    id: '20000000-0000-4000-8000-000000000009',
    code: 'branch_director',
    name: 'Branch Director (Giám đốc Chi nhánh TP.HCM)',
    isSystem: false,
    description: 'Điều hành toàn bộ hoạt động và nhân sự tại Chi nhánh TP. Hồ Chí Minh',
    permissions: ['users.read', 'users.update', 'users.export', 'organizations.read', 'roles.read'],
  },
  {
    id: '20000000-0000-4000-8000-000000000010',
    code: 'department_manager',
    name: 'Department Manager (Trưởng phòng ban)',
    isSystem: false,
    description: 'Quản lý nhân sự và công việc trong phạm vi phòng ban trực thuộc',
    permissions: ['users.read', 'organizations.read'],
  },
  {
    id: '20000000-0000-4000-8000-000000000011',
    code: 'staff',
    name: 'Standard Staff (Nhân viên Tiêu chuẩn)',
    isSystem: false,
    description: 'Nhân viên chính thức thuộc các phòng ban tại Chi nhánh TP.HCM',
    permissions: ['users.read'],
  },
] as const;

/**
 * 10 Tài khoản Đặc quyền Cố định (Mật khẩu: `!P@ssw0rd#`, Email: `@gmail.com`)
 */
export const PRIVILEGED_ACCOUNTS: readonly SeedPrivilegedUserDef[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    username: 'superadmin',
    email: 'superadmin@gmail.com',
    fullName: 'Nguyễn Thái Sơn',
    phone: '0901112233',
    roleCode: 'super_admin',
    orgCode: 'HQ_HCM',
    positionTitle: 'Tổng Giám đốc Công nghệ (CTO)',
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    username: 'admin',
    email: 'admin@gmail.com',
    fullName: 'Trần Minh Đức',
    phone: '0902223344',
    roleCode: 'admin',
    orgCode: 'HQ_HCM',
    positionTitle: 'Quản trị viên Hệ thống Cấp cao',
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    username: 'admin_security',
    email: 'admin.security@gmail.com',
    fullName: 'Lê Hoàng Nam',
    phone: '0903334455',
    roleCode: 'admin_security',
    orgCode: 'DEPT_SECURITY',
    positionTitle: 'Giám đốc An toàn Thông tin (CISO)',
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    username: 'admin_hr',
    email: 'admin.hr@gmail.com',
    fullName: 'Phạm Thu Hà',
    phone: '0904445566',
    roleCode: 'admin_hr',
    orgCode: 'DEPT_HR',
    positionTitle: 'Giám đốc Nhân sự (CHRO)',
  },
  {
    id: '30000000-0000-4000-8000-000000000005',
    username: 'admin_mobile',
    email: 'admin.mobile@gmail.com',
    fullName: 'Võ Quốc Tuấn',
    phone: '0905556677',
    roleCode: 'admin_mobile',
    orgCode: 'DEPT_MOBILE',
    positionTitle: 'Trưởng phòng Nền tảng Mobile',
  },
  {
    id: '30000000-0000-4000-8000-000000000006',
    username: 'admin_ops',
    email: 'admin.ops@gmail.com',
    fullName: 'Đặng Tiến Dũng',
    phone: '0906667788',
    roleCode: 'admin_ops',
    orgCode: 'DEPT_OPS',
    positionTitle: 'Trưởng phòng Vận hành Hạ tầng (Lead SRE)',
  },
  {
    id: '30000000-0000-4000-8000-000000000007',
    username: 'admin_finance',
    email: 'admin.finance@gmail.com',
    fullName: 'Bùi Ngọc Mai',
    phone: '0907778899',
    roleCode: 'admin_finance',
    orgCode: 'DEPT_FINANCE',
    positionTitle: 'Kế toán Trưởng (CFO)',
  },
  {
    id: '30000000-0000-4000-8000-000000000008',
    username: 'admin_support',
    email: 'admin.support@gmail.com',
    fullName: 'Hoàng Thanh Tùng',
    phone: '0908889900',
    roleCode: 'admin_support',
    orgCode: 'DEPT_SUPPORT',
    positionTitle: 'Trưởng bộ phận Hỗ trợ 24/7',
  },
  {
    id: '30000000-0000-4000-8000-000000000009',
    username: 'director_hcm',
    email: 'director.hcm@gmail.com',
    fullName: 'Đỗ Khánh Linh',
    phone: '0909990011',
    roleCode: 'branch_director',
    orgCode: 'BRANCH_HCM',
    positionTitle: 'Giám đốc Chi nhánh TP. Hồ Chí Minh',
  },
  {
    id: '30000000-0000-4000-8000-000000000010',
    username: 'manager_eng',
    email: 'manager.eng@gmail.com',
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

    // 1. Seed Organization Units tại TP.HCM (1 Chi nhánh)
    for (const org of HCMC_ORGANIZATION_UNITS) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO organization_units (id, code, name, type, parent_id, status, description)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, parent_id = EXCLUDED.parent_id`,
          [org.id, org.code, org.name, org.type, org.parentId, org.description],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO organization_units (id, code, name, type, parent_id, status, description)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), parent_id = VALUES(parent_id)`,
          [org.id, org.code, org.name, org.type, org.parentId, org.description],
        );
      }
      affected++;
    }

    // 2. Seed Roles & Role Permissions
    let permCount = 0;
    for (const role of STANDARD_IAM_ROLES) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO roles (id, code, name, description, is_system, status)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
          [role.id, role.code, role.name, role.description, role.isSystem],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO roles (id, code, name, description, is_system, status)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE')
           ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
          [role.id, role.code, role.name, role.description, role.isSystem],
        );
      }
      affected++;

      for (const permCode of role.permissions) {
        permCount++;
        const rpId = `21000000-0000-4000-8000-${String(permCount).padStart(12, '0')}`;
        if (isPostgres) {
          await ctx.manager.query(
            `INSERT INTO role_permissions (id, role_id, permission_code)
             VALUES ($1, $2, $3)
             ON CONFLICT (role_id, permission_code) DO NOTHING`,
            [rpId, role.id, permCode],
          );
        } else {
          await ctx.manager.query(
            `INSERT INTO role_permissions (id, role_id, permission_code)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code)`,
            [rpId, role.id, permCode],
          );
        }
      }
    }

    // 3. Seed 10 Tài khoản Đặc quyền (Mật khẩu: !P@ssw0rd#, Email: @gmail.com)
    const privilegedPasswordHash = await this.passwordHasher.hash(PRIVILEGED_DEFAULT_PASSWORD);
    const branchHcmId = orgByCode.get('BRANCH_HCM')!.id;

    for (let idx = 0; idx < PRIVILEGED_ACCOUNTS.length; idx++) {
      const acc = PRIVILEGED_ACCOUNTS[idx]!;
      const role = roleByCode.get(acc.roleCode)!;
      const primaryOrg = orgByCode.get(acc.orgCode)!;

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO users (id, username, email, phone, full_name, password_hash, status, primary_organization_unit_id, version)
           VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, 1)
           ON CONFLICT (username) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash`,
          [
            acc.id,
            acc.username,
            acc.email,
            acc.phone,
            acc.fullName,
            privilegedPasswordHash,
            primaryOrg.id,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO users (id, username, email, phone, full_name, password_hash, status, primary_organization_unit_id, version)
           VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 1)
           ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), password_hash = VALUES(password_hash)`,
          [
            acc.id,
            acc.username,
            acc.email,
            acc.phone,
            acc.fullName,
            privilegedPasswordHash,
            primaryOrg.id,
          ],
        );
      }

      const urId = `31000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`;
      const uoPrimaryId = `32000000-0000-4000-8000-${String(idx * 2 + 1).padStart(12, '0')}`;
      const uoBranchId = `32000000-0000-4000-8000-${String(idx * 2 + 2).padStart(12, '0')}`;

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO user_roles (id, user_id, role_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [urId, acc.id, role.id],
        );
        await ctx.manager.query(
          `INSERT INTO user_organization_units (id, user_id, organization_unit_id, is_primary, position_title)
           VALUES ($1, $2, $3, TRUE, $4)
           ON CONFLICT (user_id, organization_unit_id) DO UPDATE SET is_primary = TRUE, position_title = EXCLUDED.position_title`,
          [uoPrimaryId, acc.id, primaryOrg.id, acc.positionTitle],
        );
        if (primaryOrg.id !== branchHcmId) {
          await ctx.manager.query(
            `INSERT INTO user_organization_units (id, user_id, organization_unit_id, is_primary, position_title)
             VALUES ($1, $2, $3, FALSE, $4)
             ON CONFLICT (user_id, organization_unit_id) DO NOTHING`,
            [uoBranchId, acc.id, branchHcmId, acc.positionTitle],
          );
        }
      } else {
        await ctx.manager.query(
          `INSERT INTO user_roles (id, user_id, role_id)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)`,
          [urId, acc.id, role.id],
        );
        await ctx.manager.query(
          `INSERT INTO user_organization_units (id, user_id, organization_unit_id, is_primary, position_title)
           VALUES (?, ?, ?, TRUE, ?)
           ON DUPLICATE KEY UPDATE is_primary = TRUE, position_title = VALUES(position_title)`,
          [uoPrimaryId, acc.id, primaryOrg.id, acc.positionTitle],
        );
        if (primaryOrg.id !== branchHcmId) {
          await ctx.manager.query(
            `INSERT INTO user_organization_units (id, user_id, organization_unit_id, is_primary, position_title)
             VALUES (?, ?, ?, FALSE, ?)
             ON DUPLICATE KEY UPDATE position_title = VALUES(position_title)`,
            [uoBranchId, acc.id, branchHcmId, acc.positionTitle],
          );
        }
      }
      affected++;
    }

    return {
      affected,
      details: `${HCMC_ORGANIZATION_UNITS.length} HCMC org units (1 branch), ${STANDARD_IAM_ROLES.length} roles, ${PRIVILEGED_ACCOUNTS.length} privileged accounts (@gmail.com) seeded`,
    };
  }
}
