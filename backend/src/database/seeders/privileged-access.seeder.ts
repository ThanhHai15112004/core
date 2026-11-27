import type { SeederContext, SeederContract } from '@packages/database/index.js';

interface DefaultPrivilegedTargetSeed {
  readonly targetType: 'ROLE' | 'PERMISSION';
  readonly targetCode: string;
  readonly displayName: string;
  readonly description: string;
  readonly sensitivityLevel: 'HIGH' | 'CRITICAL';
  readonly requireMfaStepUp: boolean;
  readonly requireApproval: boolean;
  readonly autoApproveAllowed: boolean;
  readonly maxGrantMinutes: number;
  readonly alertOnUse: boolean;
  readonly reviewIntervalDays: number;
}

const DEFAULT_PRIVILEGED_TARGETS: readonly DefaultPrivilegedTargetSeed[] = [
  {
    targetType: 'ROLE',
    targetCode: 'super_admin',
    displayName: 'Super Administrator (Toàn quyền Hệ thống)',
    description:
      'Vai trò tối cao toàn hệ thống, yêu cầu MFA Step-Up, phê duyệt và rà soát mỗi 30 ngày',
    sensitivityLevel: 'CRITICAL',
    requireMfaStepUp: true,
    requireApproval: true,
    autoApproveAllowed: false,
    maxGrantMinutes: 120,
    alertOnUse: true,
    reviewIntervalDays: 30,
  },
  {
    targetType: 'ROLE',
    targetCode: 'admin_security',
    displayName: 'Security Administrator (Quản trị Bảo mật)',
    description:
      'Vai trò quản trị an toàn thông tin, chính sách MFA, khóa tài khoản và Break-glass',
    sensitivityLevel: 'CRITICAL',
    requireMfaStepUp: true,
    requireApproval: true,
    autoApproveAllowed: false,
    maxGrantMinutes: 180,
    alertOnUse: true,
    reviewIntervalDays: 60,
  },
  {
    targetType: 'ROLE',
    targetCode: 'admin',
    displayName: 'System Administrator (Quản trị Hệ thống)',
    description:
      'Vai trò quản trị hệ thống tổng hợp, giám sát sử dụng quyền và rà soát mỗi 90 ngày',
    sensitivityLevel: 'HIGH',
    requireMfaStepUp: true,
    requireApproval: true,
    autoApproveAllowed: false,
    maxGrantMinutes: 240,
    alertOnUse: true,
    reviewIntervalDays: 90,
  },
  {
    targetType: 'PERMISSION',
    targetCode: 'privileged-access.break_glass.manage',
    displayName: 'Quản trị & Kích hoạt Break-glass',
    description: 'Tạo, liên kết, kích hoạt khẩn cấp và niêm phong tài khoản Break-glass',
    sensitivityLevel: 'CRITICAL',
    requireMfaStepUp: true,
    requireApproval: true,
    autoApproveAllowed: false,
    maxGrantMinutes: 60,
    alertOnUse: true,
    reviewIntervalDays: 30,
  },
  {
    targetType: 'PERMISSION',
    targetCode: 'privileged-access.manage',
    displayName: 'Quản trị Chính sách Quyền Đặc Biệt & Rà soát',
    description: 'Đánh dấu quyền đặc biệt, quét thu hồi hết hạn và thực thi rà soát định kỳ',
    sensitivityLevel: 'CRITICAL',
    requireMfaStepUp: true,
    requireApproval: true,
    autoApproveAllowed: false,
    maxGrantMinutes: 120,
    alertOnUse: true,
    reviewIntervalDays: 60,
  },
  {
    targetType: 'PERMISSION',
    targetCode: 'privileged-access.approve',
    displayName: 'Phê duyệt & Thu hồi Cấp quyền Tạm thời',
    description: 'Phê duyệt, từ chối và thu hồi yêu cầu nâng quyền tạm thời (JIT)',
    sensitivityLevel: 'HIGH',
    requireMfaStepUp: true,
    requireApproval: true,
    autoApproveAllowed: false,
    maxGrantMinutes: 180,
    alertOnUse: true,
    reviewIntervalDays: 60,
  },
  {
    targetType: 'PERMISSION',
    targetCode: 'roles.manage',
    displayName: 'Quản trị Vai trò & Phân quyền RBAC',
    description: 'Thay đổi vai trò và ma trận quyền toàn hệ thống',
    sensitivityLevel: 'HIGH',
    requireMfaStepUp: false,
    requireApproval: true,
    autoApproveAllowed: false,
    maxGrantMinutes: 120,
    alertOnUse: true,
    reviewIntervalDays: 90,
  },
  {
    targetType: 'PERMISSION',
    targetCode: 'auth.settings.write',
    displayName: 'Thay đổi Chính sách Bảo mật & MFA Toàn hệ thống',
    description: 'Chỉnh sửa cấu hình Security Settings và chính sách xác thực',
    sensitivityLevel: 'HIGH',
    requireMfaStepUp: false,
    requireApproval: true,
    autoApproveAllowed: false,
    maxGrantMinutes: 120,
    alertOnUse: true,
    reviewIntervalDays: 90,
  },
];

const PAM_PERMISSION_CODES = [
  'privileged-access.read',
  'privileged-access.request',
  'privileged-access.approve',
  'privileged-access.manage',
  'privileged-access.break_glass.manage',
] as const;

/**
 * Seeder khởi tạo mặc định danh mục quyền/vai trò đặc biệt (`privileged_access_targets`)
 * và đồng bộ các quyền `privileged-access.*` cho vai trò `super_admin` và `admin_security`.
 */
export class PrivilegedAccessSeeder implements SeederContract {
  public readonly name = 'PrivilegedAccessSeeder';
  public readonly scope = 'master' as const;
  public readonly order = 35;

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    const isPostgres = ctx.driver === 'postgres';
    let affected = 0;

    for (const target of DEFAULT_PRIVILEGED_TARGETS) {
      if (isPostgres) {
        const res = (await ctx.manager.query(
          `INSERT INTO privileged_access_targets (
             target_type, target_code, display_name, description, sensitivity_level,
             require_mfa_step_up, require_approval, auto_approve_allowed,
             max_grant_minutes, alert_on_use, review_interval_days, is_enabled
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
           ON CONFLICT (target_type, target_code) DO NOTHING`,
          [
            target.targetType,
            target.targetCode,
            target.displayName,
            target.description,
            target.sensitivityLevel,
            target.requireMfaStepUp,
            target.requireApproval,
            target.autoApproveAllowed,
            target.maxGrantMinutes,
            target.alertOnUse,
            target.reviewIntervalDays,
          ],
        )) as { rowCount?: number };
        affected += Number(res?.rowCount ?? 1);
      } else {
        await ctx.manager.query(
          `INSERT IGNORE INTO privileged_access_targets (
             target_type, target_code, display_name, description, sensitivity_level,
             require_mfa_step_up, require_approval, auto_approve_allowed,
             max_grant_minutes, alert_on_use, review_interval_days, is_enabled
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
          [
            target.targetType,
            target.targetCode,
            target.displayName,
            target.description,
            target.sensitivityLevel,
            target.requireMfaStepUp,
            target.requireApproval,
            target.autoApproveAllowed,
            target.maxGrantMinutes,
            target.alertOnUse,
            target.reviewIntervalDays,
          ],
        );
        affected++;
      }
    }

    // Gán quyền PAM mặc định cho super_admin và admin_security (idempotent)
    try {
      const roleRows = (await ctx.manager.query(
        isPostgres
          ? `SELECT id, code FROM roles WHERE code IN ($1, $2) AND deleted_at IS NULL`
          : `SELECT id, code FROM roles WHERE code IN (?, ?) AND deleted_at IS NULL`,
        ['super_admin', 'admin_security'],
      )) as Array<{ id: number; code: string }>;

      const permPlaceholders = PAM_PERMISSION_CODES.map((_, idx) =>
        isPostgres ? `$${idx + 1}` : '?',
      ).join(', ');
      const permRows = (await ctx.manager.query(
        `SELECT id, code FROM permissions WHERE code IN (${permPlaceholders}) AND deleted_at IS NULL`,
        [...PAM_PERMISSION_CODES],
      )) as Array<{ id: number; code: string }>;

      for (const role of roleRows) {
        for (const perm of permRows) {
          if (isPostgres) {
            await ctx.manager.query(
              `INSERT INTO role_permissions (role_id, permission_id)
               VALUES ($1, $2)
               ON CONFLICT (role_id, permission_id) DO NOTHING`,
              [Number(role.id), Number(perm.id)],
            );
          } else {
            await ctx.manager.query(
              `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
              [Number(role.id), Number(perm.id)],
            );
          }
          affected++;
        }
      }
    } catch {
      // Ignore if roles/permissions tables have not been populated yet in isolated seeder run
    }

    return {
      affected,
      details: `${DEFAULT_PRIVILEGED_TARGETS.length} privileged access target policies and admin PAM permissions ensured`,
    };
  }
}
