import type { SeederContext, SeederContract } from '@packages/database/index.js';

interface DefaultClassificationSeed {
  readonly dataTypeCode: string;
  readonly displayName: string;
  readonly moduleName: string;
  readonly classificationLevel: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
  readonly containsPii: boolean;
  readonly retentionDays: number;
  readonly retentionAction: 'PURGE' | 'ANONYMIZE' | 'ARCHIVE' | 'RETAIN_LEGAL';
  readonly legalBasis: string;
  readonly description: string;
}

interface DefaultSensitiveFieldSeed {
  readonly resourceType: string;
  readonly fieldPath: string;
  readonly displayName: string;
  readonly classificationLevel: 'CONFIDENTIAL' | 'RESTRICTED';
  readonly maskStrategy: 'FULL' | 'PARTIAL' | 'EMAIL' | 'PHONE' | 'HASH';
  readonly redactInLog: boolean;
  readonly maskInExport: boolean;
  readonly requiredPermission: string;
  readonly description: string;
}

interface DefaultConsentDefinitionSeed {
  readonly purposeCode: string;
  readonly policyVersion: string;
  readonly title: string;
  readonly description: string;
  readonly classificationLevel: 'INTERNAL' | 'CONFIDENTIAL';
  readonly isMandatory: boolean;
  readonly validityDays: number | null;
}

const DEFAULT_CLASSIFICATIONS: readonly DefaultClassificationSeed[] = [
  {
    dataTypeCode: 'public.catalog',
    displayName: 'Danh mục & Nội dung công khai',
    moduleName: 'codes',
    classificationLevel: 'PUBLIC',
    containsPii: false,
    retentionDays: 0,
    retentionAction: 'ARCHIVE',
    legalBasis: 'Public Information',
    description: 'Danh mục hệ thống và nội dung công khai không chứa dữ liệu cá nhân',
  },
  {
    dataTypeCode: 'exports.artifacts',
    displayName: 'Lịch sử & Tệp xuất dữ liệu tạm thời',
    moduleName: 'exports',
    classificationLevel: 'INTERNAL',
    containsPii: false,
    retentionDays: 30,
    retentionAction: 'PURGE',
    legalBasis: 'Operational Efficiency',
    description: 'Lịch sử xuất dữ liệu nội bộ, tự động dọn dẹp sau 30 ngày nếu không bị Legal Hold',
  },
  {
    dataTypeCode: 'users.personal_profile',
    displayName: 'Hồ sơ định danh cá nhân (PII)',
    moduleName: 'users',
    classificationLevel: 'CONFIDENTIAL',
    containsPii: true,
    retentionDays: 1095,
    retentionAction: 'ANONYMIZE',
    legalBasis: 'Contractual Necessity / Decree 13',
    description: 'Họ tên, email, số điện thoại, địa chỉ, ngày sinh của người dùng',
  },
  {
    dataTypeCode: 'auth.sessions',
    displayName: 'Phiên đăng nhập & Lịch sử truy cập',
    moduleName: 'sessions',
    classificationLevel: 'CONFIDENTIAL',
    containsPii: true,
    retentionDays: 180,
    retentionAction: 'PURGE',
    legalBasis: 'Legitimate Security Interest',
    description: 'Phiên xác thực, địa chỉ IP, thiết bị tin cậy của người dùng',
  },
  {
    dataTypeCode: 'privacy.consents',
    displayName: 'Hồ sơ sự đồng ý xử lý dữ liệu (Consents)',
    moduleName: 'data-governance',
    classificationLevel: 'CONFIDENTIAL',
    containsPii: true,
    retentionDays: 1825,
    retentionAction: 'ANONYMIZE',
    legalBasis: 'Legal Compliance Proof',
    description: 'Bằng chứng đồng ý/rút đồng ý theo mục đích, phiên bản và thời gian',
  },
  {
    dataTypeCode: 'audit.logs',
    displayName: 'Nhật ký kiểm toán bảo mật bất biến (Audit Logs)',
    moduleName: 'audit',
    classificationLevel: 'RESTRICTED',
    containsPii: true,
    retentionDays: 2555,
    retentionAction: 'RETAIN_LEGAL',
    legalBasis: 'Statutory Security & Accounting Obligation',
    description: 'Nhật ký kiểm toán bất biến, ngoại lệ bắt buộc giữ lại khi xử lý yêu cầu xóa DSAR',
  },
];

const DEFAULT_SENSITIVE_FIELDS: readonly DefaultSensitiveFieldSeed[] = [
  {
    resourceType: 'users',
    fieldPath: 'identityNumber',
    displayName: 'Số CCCD / CMND / Định danh cá nhân',
    classificationLevel: 'RESTRICTED',
    maskStrategy: 'PARTIAL',
    redactInLog: true,
    maskInExport: true,
    requiredPermission: 'data-governance.sensitive.read',
    description: 'Giấy tờ định danh công dân nhạy cảm cao, bắt buộc che trong Log và Export',
  },
  {
    resourceType: 'users',
    fieldPath: 'phone',
    displayName: 'Số điện thoại cá nhân',
    classificationLevel: 'CONFIDENTIAL',
    maskStrategy: 'PHONE',
    redactInLog: true,
    maskInExport: true,
    requiredPermission: 'data-governance.sensitive.read',
    description: 'Che số điện thoại khi xuất danh sách hoặc đọc không có quyền nhạy cảm',
  },
  {
    resourceType: 'users',
    fieldPath: 'email',
    displayName: 'Địa chỉ Email cá nhân',
    classificationLevel: 'CONFIDENTIAL',
    maskStrategy: 'EMAIL',
    redactInLog: false,
    maskInExport: true,
    requiredPermission: 'data-governance.sensitive.read',
    description: 'Che một phần email trong bản xuất dữ liệu khi người xuất thiếu quyền nhạy cảm',
  },
  {
    resourceType: '*',
    fieldPath: 'bankAccountNumber',
    displayName: 'Số tài khoản ngân hàng',
    classificationLevel: 'RESTRICTED',
    maskStrategy: 'PARTIAL',
    redactInLog: true,
    maskInExport: true,
    requiredPermission: 'data-governance.sensitive.read',
    description: 'Thông tin tài chính nhạy cảm trên mọi module, tự động redact trong Log',
  },
  {
    resourceType: '*',
    fieldPath: 'taxIdentificationNumber',
    displayName: 'Mã số thuế cá nhân',
    classificationLevel: 'RESTRICTED',
    maskStrategy: 'FULL',
    redactInLog: true,
    maskInExport: true,
    requiredPermission: 'data-governance.sensitive.read',
    description: 'Mã số thuế cá nhân cần che giấu trong Log và tệp xuất',
  },
];

const DEFAULT_CONSENT_DEFINITIONS: readonly DefaultConsentDefinitionSeed[] = [
  {
    purposeCode: 'core_service_processing',
    policyVersion: '1.0',
    title: 'Xử lý dữ liệu cốt lõi để cung cấp dịch vụ tài khoản',
    description: 'Sử dụng thông tin định danh và liên hệ cơ bản để vận hành tài khoản và xác thực.',
    classificationLevel: 'CONFIDENTIAL',
    isMandatory: true,
    validityDays: null,
  },
  {
    purposeCode: 'security_incident_alerts',
    policyVersion: '1.0',
    title: 'Cảnh báo bảo mật và đăng nhập bất thường',
    description: 'Gửi thông báo xác thực MFA, cảnh báo đăng nhập lạ và bảo vệ tài khoản.',
    classificationLevel: 'INTERNAL',
    isMandatory: true,
    validityDays: null,
  },
  {
    purposeCode: 'marketing_communications',
    policyVersion: '1.0',
    title: 'Nhận bản tin sản phẩm, ưu đãi và sự kiện',
    description: 'Cho phép gửi email/thông báo giới thiệu tính năng mới và chương trình khuyến mãi.',
    classificationLevel: 'INTERNAL',
    isMandatory: false,
    validityDays: 365,
  },
  {
    purposeCode: 'product_usage_analytics',
    policyVersion: '1.0',
    title: 'Phân tích trải nghiệm và tối ưu hóa hiệu năng',
    description: 'Thu thập số liệu tương tác ẩn danh/bán định danh để cải thiện chất lượng giao diện.',
    classificationLevel: 'INTERNAL',
    isMandatory: false,
    validityDays: 365,
  },
];

const DATA_GOVERNANCE_PERMS = [
  'data-governance.read',
  'data-governance.manage',
  'data-governance.sensitive.read',
  'data-governance.dsar.request',
  'data-governance.dsar.approve',
  'data-governance.consent.manage',
  'data-governance.legal_hold.manage',
] as const;

export class DataGovernanceSeeder implements SeederContract {
  public readonly name = 'DataGovernanceSeeder';
  public readonly scope = 'master' as const;
  public readonly order = 36;

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    const isPostgres = ctx.driver === 'postgres';
    let affected = 0;

    for (const c of DEFAULT_CLASSIFICATIONS) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO data_classifications (
            data_type_code, display_name, module_name, classification_level,
            contains_pii, retention_days, retention_action, legal_basis, description, is_enabled
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
          ON CONFLICT (data_type_code) DO NOTHING`,
          [
            c.dataTypeCode,
            c.displayName,
            c.moduleName,
            c.classificationLevel,
            c.containsPii,
            c.retentionDays,
            c.retentionAction,
            c.legalBasis,
            c.description,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT IGNORE INTO data_classifications (
            data_type_code, display_name, module_name, classification_level,
            contains_pii, retention_days, retention_action, legal_basis, description, is_enabled
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
          [
            c.dataTypeCode,
            c.displayName,
            c.moduleName,
            c.classificationLevel,
            c.containsPii,
            c.retentionDays,
            c.retentionAction,
            c.legalBasis,
            c.description,
          ],
        );
      }
      affected += 1;
    }

    for (const f of DEFAULT_SENSITIVE_FIELDS) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO data_sensitive_fields (
            resource_type, field_path, display_name, classification_level,
            mask_strategy, redact_in_log, mask_in_export, required_permission, description, is_enabled
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
          ON CONFLICT (resource_type, field_path) DO NOTHING`,
          [
            f.resourceType,
            f.fieldPath,
            f.displayName,
            f.classificationLevel,
            f.maskStrategy,
            f.redactInLog,
            f.maskInExport,
            f.requiredPermission,
            f.description,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT IGNORE INTO data_sensitive_fields (
            resource_type, field_path, display_name, classification_level,
            mask_strategy, redact_in_log, mask_in_export, required_permission, description, is_enabled
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
          [
            f.resourceType,
            f.fieldPath,
            f.displayName,
            f.classificationLevel,
            f.maskStrategy,
            f.redactInLog,
            f.maskInExport,
            f.requiredPermission,
            f.description,
          ],
        );
      }
      affected += 1;
    }

    for (const d of DEFAULT_CONSENT_DEFINITIONS) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO privacy_consent_definitions (
            purpose_code, policy_version, title, description,
            classification_level, is_mandatory, validity_days, is_active, published_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, CURRENT_TIMESTAMP)
          ON CONFLICT (purpose_code, policy_version) DO NOTHING`,
          [
            d.purposeCode,
            d.policyVersion,
            d.title,
            d.description,
            d.classificationLevel,
            d.isMandatory,
            d.validityDays,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT IGNORE INTO privacy_consent_definitions (
            purpose_code, policy_version, title, description,
            classification_level, is_mandatory, validity_days, is_active, published_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP)`,
          [
            d.purposeCode,
            d.policyVersion,
            d.title,
            d.description,
            d.classificationLevel,
            d.isMandatory,
            d.validityDays,
          ],
        );
      }
      affected += 1;
    }

    try {
      const roleRows = (await ctx.manager.query(
        isPostgres
          ? `SELECT id, code FROM roles WHERE code IN ($1, $2) AND deleted_at IS NULL`
          : `SELECT id, code FROM roles WHERE code IN (?, ?) AND deleted_at IS NULL`,
        ['super_admin', 'admin_security'],
      )) as Array<{ id: number; code: string }>;

      const permPlaceholders = DATA_GOVERNANCE_PERMS.map((_, idx) =>
        isPostgres ? `$${idx + 1}` : '?',
      ).join(', ');
      const permRows = (await ctx.manager.query(
        `SELECT id, code FROM permissions WHERE code IN (${permPlaceholders}) AND deleted_at IS NULL`,
        [...DATA_GOVERNANCE_PERMS],
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
          affected += 1;
        }
      }
    } catch {
      // Ignore if roles/permissions are not populated yet
    }

    return {
      affected,
      details: `${DEFAULT_CLASSIFICATIONS.length} classifications, ${DEFAULT_SENSITIVE_FIELDS.length} sensitive fields, and ${DEFAULT_CONSENT_DEFINITIONS.length} consent definitions ensured`,
    };
  }
}
