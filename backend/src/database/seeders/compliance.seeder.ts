import type { SeederContext, SeederContract } from '@packages/database/index.js';

interface DefaultControlSeed {
  readonly controlCode: string;
  readonly title: string;
  readonly description: string;
  readonly domain: string;
  readonly frameworkTags: readonly string[];
  readonly frequency:
    'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL' | 'AD_HOC';
  readonly status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  readonly lastCheckResult: 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT_APPLICABLE' | null;
  readonly daysSinceLastCheck: number | null;
  readonly daysUntilNextCheck: number | null;
}

interface DefaultVendorSeed {
  readonly vendorCode: string;
  readonly name: string;
  readonly category: 'EMAIL' | 'SMS' | 'CLOUD' | 'PAYMENT' | 'AI' | 'OTHER';
  readonly criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly status: 'ACTIVE' | 'UNDER_REVIEW' | 'SUSPENDED' | 'OFFBOARDED';
  readonly websiteUrl: string;
  readonly contactEmail: string;
  readonly reviewFrequency: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';
  readonly contractEndOffsetDays: number;
  readonly reviewDueOffsetDays: number;
  readonly dpaSigned: boolean;
  readonly fallbackVendorName: string | null;
  readonly fallbackStrategy: string | null;
  readonly migrationRunbook: string | null;
  readonly rtoHours: number | null;
}

interface DefaultAssessmentSeed {
  readonly vendorCode: string;
  readonly dataCategory: string;
  readonly classificationLevel: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
  readonly allowedDataFields: readonly string[];
  readonly prohibitedDataFields: readonly string[];
  readonly processingPurpose: string;
  readonly dataFlowDirection: 'OUTBOUND' | 'INBOUND' | 'BIDIRECTIONAL';
  readonly storageRegions: readonly string[];
  readonly crossBorderTransfer: boolean;
  readonly transferMechanism: string | null;
  readonly retentionDays: number;
  readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly approvalStatus: 'PENDING' | 'APPROVED' | 'CONDITIONAL' | 'REJECTED';
}

const DEFAULT_CONTROLS: readonly DefaultControlSeed[] = [
  {
    controlCode: 'CTRL-2026-0001',
    title: 'Rà soát định kỳ quyền đặc biệt và tài khoản quản trị (PAM Review)',
    description:
      'Kiểm tra danh sách tài khoản có vai trò SUPER_ADMIN/SECURITY_ADMIN, thu hồi quyền không còn sử dụng và đối chiếu nhật ký Break-glass.',
    domain: 'ACCESS',
    frameworkTags: ['ISO27001:A.5.18', 'SOC2:CC6.2', 'INTERNAL:SEC-01'],
    frequency: 'QUARTERLY',
    status: 'ACTIVE',
    lastCheckResult: 'PASS',
    daysSinceLastCheck: 35,
    daysUntilNextCheck: 55,
  },
  {
    controlCode: 'CTRL-2026-0002',
    title: 'Diễn tập sao lưu & phục hồi dữ liệu (Backup & DR Restore Drill)',
    description:
      'Thực hiện khôi phục thử nghiệm bản sao lưu cơ sở dữ liệu vào môi trường cô lập và đối chiếu RPO/RTO thực tế.',
    domain: 'INFRASTRUCTURE',
    frameworkTags: ['ISO27001:A.8.13', 'SOC2:A1.3', 'INTERNAL:OPS-04'],
    frequency: 'MONTHLY',
    status: 'ACTIVE',
    lastCheckResult: 'PASS',
    daysSinceLastCheck: 18,
    daysUntilNextCheck: 12,
  },
  {
    controlCode: 'CTRL-2026-0003',
    title: 'Đánh giá bảo mật & hợp đồng nhà cung cấp bên thứ ba',
    description:
      'Rà soát phạm vi dữ liệu chia sẻ, thỏa thuận xử lý dữ liệu (DPA), hiệu lực hợp đồng và tính sẵn sàng của phương án dự phòng.',
    domain: 'VENDOR',
    frameworkTags: ['ISO27001:A.5.21', 'SOC2:CC9.2', 'GDPR:Art.28', 'INTERNAL:VRM-01'],
    frequency: 'SEMI_ANNUAL',
    status: 'ACTIVE',
    lastCheckResult: 'PARTIAL',
    daysSinceLastCheck: 190,
    daysUntilNextCheck: -10,
  },
  {
    controlCode: 'CTRL-2026-0004',
    title: 'Kiểm tra tính toàn vẹn nhật ký kiểm toán & che dữ liệu nhạy cảm',
    description:
      'Xác nhận Audit Log bất biến hoạt động liên tục, các trường PII/tài chính được mask đúng quy chuẩn trước khi ghi log hoặc export.',
    domain: 'DATA_PRIVACY',
    frameworkTags: ['ISO27001:A.8.15', 'GDPR:Art.32', 'DECREE13:VN', 'INTERNAL:PRV-02'],
    frequency: 'QUARTERLY',
    status: 'ACTIVE',
    lastCheckResult: 'PASS',
    daysSinceLastCheck: 20,
    daysUntilNextCheck: 70,
  },
];

const DEFAULT_VENDORS: readonly DefaultVendorSeed[] = [
  {
    vendorCode: 'VEND-2026-0001',
    name: 'Amazon SES (Email Delivery)',
    category: 'EMAIL',
    criticality: 'HIGH',
    status: 'ACTIVE',
    websiteUrl: 'https://aws.amazon.com/ses/',
    contactEmail: 'aws-compliance@example.com',
    reviewFrequency: 'SEMI_ANNUAL',
    contractEndOffsetDays: 240,
    reviewDueOffsetDays: 60,
    dpaSigned: true,
    fallbackVendorName: 'Postmark / Resend SMTP',
    fallbackStrategy:
      'Chuyển định tuyến EMAIL tại Provider Registry sang nhà cung cấp dự phòng không cần sửa mã nguồn.',
    migrationRunbook:
      'Mở Provider Registry -> Pause AWS SES -> Set Primary Postmark -> Verify SPF/DKIM.',
    rtoHours: 1,
  },
  {
    vendorCode: 'VEND-2026-0002',
    name: 'Twilio Messaging (SMS OTP)',
    category: 'SMS',
    criticality: 'HIGH',
    status: 'ACTIVE',
    websiteUrl: 'https://www.twilio.com',
    contactEmail: 'privacy@twilio.example.com',
    reviewFrequency: 'SEMI_ANNUAL',
    contractEndOffsetDays: 28,
    reviewDueOffsetDays: 20,
    dpaSigned: true,
    fallbackVendorName: 'eSMS / Viettel Brandname Gateway',
    fallbackStrategy:
      'Cấu hình Fallback tự động khi SMS provider chính lỗi hoặc hết hạn mức, ưu tiên TOTP làm kênh xác thực thay thế.',
    migrationRunbook: 'Bật fallback_enabled trong Provider Registry và kích hoạt gateway nội địa.',
    rtoHours: 2,
  },
  {
    vendorCode: 'VEND-2026-0003',
    name: 'Amazon Web Services (Cloud & S3)',
    category: 'CLOUD',
    criticality: 'CRITICAL',
    status: 'ACTIVE',
    websiteUrl: 'https://aws.amazon.com',
    contactEmail: 'enterprise-support@aws.example.com',
    reviewFrequency: 'QUARTERLY',
    contractEndOffsetDays: 320,
    reviewDueOffsetDays: 45,
    dpaSigned: true,
    fallbackVendorName: 'Google Cloud Platform (ap-southeast-1) / MinIO S3 On-Prem',
    fallbackStrategy:
      'Container hóa runtime stateless, sao lưu snapshot DB & Object Storage đa vùng tương thích S3 API.',
    migrationRunbook:
      'Thực thi DR Runbook section 13.7: Restore snapshot lên cụm dự phòng và chuyển DNS.',
    rtoHours: 4,
  },
  {
    vendorCode: 'VEND-2026-0004',
    name: 'Stripe / VNPay Gateway',
    category: 'PAYMENT',
    criticality: 'CRITICAL',
    status: 'ACTIVE',
    websiteUrl: 'https://stripe.com',
    contactEmail: 'security@payment.example.com',
    reviewFrequency: 'QUARTERLY',
    contractEndOffsetDays: 180,
    reviewDueOffsetDays: -5,
    dpaSigned: true,
    fallbackVendorName: 'OnePay / Chuyển khoản VietQR đối soát thủ công',
    fallbackStrategy:
      'Sử dụng Payment Port chuẩn hóa để tráo adapter thanh toán mà không đổi luồng đơn hàng.',
    migrationRunbook:
      'Chuyển adapter thanh toán trong Provider Registry và chạy đối soát Reconciliation.',
    rtoHours: 2,
  },
  {
    vendorCode: 'VEND-2026-0005',
    name: 'Google Gemini Enterprise API',
    category: 'AI',
    criticality: 'MEDIUM',
    status: 'UNDER_REVIEW',
    websiteUrl: 'https://ai.google.dev',
    contactEmail: 'ai-dpa@example.com',
    reviewFrequency: 'QUARTERLY',
    contractEndOffsetDays: 120,
    reviewDueOffsetDays: 15,
    dpaSigned: false,
    fallbackVendorName: 'Azure OpenAI / Self-hosted vLLM Gateway',
    fallbackStrategy:
      'Tách lớp AI Adapter, che toàn bộ PII trước khi gửi prompt và cho phép chuyển sang model nội bộ khi có sự cố.',
    migrationRunbook:
      'Đổi AI endpoint sang gateway dự phòng và tắt tính năng AI gợi ý không thiết yếu.',
    rtoHours: 4,
  },
];

const DEFAULT_ASSESSMENTS: readonly DefaultAssessmentSeed[] = [
  {
    vendorCode: 'VEND-2026-0001',
    dataCategory: 'Transactional Email & Notification Metadata',
    classificationLevel: 'CONFIDENTIAL',
    allowedDataFields: ['email', 'fullName', 'notificationSubject', 'locale'],
    prohibitedDataFields: ['passwordHash', 'identityNumber', 'bankAccountNumber', 'rawToken'],
    processingPurpose: 'Gửi email xác thực tài khoản, OTP và thông báo nghiệp vụ',
    dataFlowDirection: 'OUTBOUND',
    storageRegions: ['ap-southeast-1'],
    crossBorderTransfer: true,
    transferMechanism: 'Standard Contractual Clauses (SCC) + DPA',
    retentionDays: 30,
    riskLevel: 'LOW',
    approvalStatus: 'APPROVED',
  },
  {
    vendorCode: 'VEND-2026-0002',
    dataCategory: 'Phone Number & OTP Delivery',
    classificationLevel: 'CONFIDENTIAL',
    allowedDataFields: ['phone', 'otpCode'],
    prohibitedDataFields: ['email', 'identityNumber', 'financialData'],
    processingPurpose: 'Gửi mã xác thực SMS OTP và cảnh báo bảo mật khẩn cấp',
    dataFlowDirection: 'OUTBOUND',
    storageRegions: ['ap-southeast-1', 'us-east-1'],
    crossBorderTransfer: true,
    transferMechanism: 'SCC + Zero-retention SMS configuration',
    retentionDays: 7,
    riskLevel: 'MEDIUM',
    approvalStatus: 'APPROVED',
  },
  {
    vendorCode: 'VEND-2026-0005',
    dataCategory: 'Anonymized Prompt Context & Document Summaries',
    classificationLevel: 'INTERNAL',
    allowedDataFields: ['anonymizedText', 'documentTitle', 'languageCode'],
    prohibitedDataFields: ['email', 'phone', 'identityNumber', 'creditCard', 'secrets'],
    processingPurpose: 'Hỗ trợ tóm tắt và phân loại nội dung không chứa định danh cá nhân',
    dataFlowDirection: 'BIDIRECTIONAL',
    storageRegions: ['asia-southeast1'],
    crossBorderTransfer: true,
    transferMechanism: 'Zero Data Retention (ZDR) + PII Redaction Filter',
    retentionDays: 0,
    riskLevel: 'HIGH',
    approvalStatus: 'CONDITIONAL',
  },
];

const COMPLIANCE_PERMS = [
  'compliance.read',
  'compliance.manage',
  'compliance.check',
  'compliance.vendor.manage',
  'compliance.report',
] as const;

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export class ComplianceSeeder implements SeederContract {
  public readonly name = 'ComplianceSeeder';
  public readonly scope = 'master' as const;
  public readonly order = 37;

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    const isPostgres = ctx.driver === 'postgres';
    const now = new Date();
    let affected = 0;

    for (const c of DEFAULT_CONTROLS) {
      const lastCheckedAt =
        c.daysSinceLastCheck !== null ? addDays(now, -c.daysSinceLastCheck) : null;
      const nextCheckDueAt =
        c.daysUntilNextCheck !== null ? addDays(now, c.daysUntilNextCheck) : null;
      const tagsJson = JSON.stringify(c.frameworkTags);

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO compliance_controls (
            control_code, title, description, domain, framework_tags_json,
            frequency, status, last_checked_at, next_check_due_at, last_check_result
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (control_code) DO NOTHING`,
          [
            c.controlCode,
            c.title,
            c.description,
            c.domain,
            tagsJson,
            c.frequency,
            c.status,
            lastCheckedAt,
            nextCheckDueAt,
            c.lastCheckResult,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT IGNORE INTO compliance_controls (
            control_code, title, description, domain, framework_tags_json,
            frequency, status, last_checked_at, next_check_due_at, last_check_result
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            c.controlCode,
            c.title,
            c.description,
            c.domain,
            tagsJson,
            c.frequency,
            c.status,
            lastCheckedAt,
            nextCheckDueAt,
            c.lastCheckResult,
          ],
        );
      }
      affected += 1;
    }

    for (const v of DEFAULT_VENDORS) {
      const contractStart = addDays(now, -180);
      const contractEnd = addDays(now, v.contractEndOffsetDays);
      const lastReviewed = addDays(now, -90);
      const nextReviewDue = addDays(now, v.reviewDueOffsetDays);

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO compliance_vendors (
            vendor_code, name, category, criticality, status, website_url, contact_email,
            contract_start_date, contract_end_date, auto_renew, review_frequency,
            last_reviewed_at, next_review_due_at, dpa_signed,
            fallback_vendor_name, fallback_strategy, migration_runbook, rto_hours
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (vendor_code) DO NOTHING`,
          [
            v.vendorCode,
            v.name,
            v.category,
            v.criticality,
            v.status,
            v.websiteUrl,
            v.contactEmail,
            contractStart,
            contractEnd,
            v.reviewFrequency,
            lastReviewed,
            nextReviewDue,
            v.dpaSigned,
            v.fallbackVendorName,
            v.fallbackStrategy,
            v.migrationRunbook,
            v.rtoHours,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT IGNORE INTO compliance_vendors (
            vendor_code, name, category, criticality, status, website_url, contact_email,
            contract_start_date, contract_end_date, auto_renew, review_frequency,
            last_reviewed_at, next_review_due_at, dpa_signed,
            fallback_vendor_name, fallback_strategy, migration_runbook, rto_hours
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            v.vendorCode,
            v.name,
            v.category,
            v.criticality,
            v.status,
            v.websiteUrl,
            v.contactEmail,
            contractStart,
            contractEnd,
            v.reviewFrequency,
            lastReviewed,
            nextReviewDue,
            v.dpaSigned,
            v.fallbackVendorName,
            v.fallbackStrategy,
            v.migrationRunbook,
            v.rtoHours,
          ],
        );
      }
      affected += 1;
    }

    // Seed vendor data assessments idempotently if missing
    for (const a of DEFAULT_ASSESSMENTS) {
      const vendorRows = (await ctx.manager.query(
        isPostgres
          ? `SELECT id FROM compliance_vendors WHERE vendor_code = $1 AND deleted_at IS NULL LIMIT 1`
          : `SELECT id FROM compliance_vendors WHERE vendor_code = ? AND deleted_at IS NULL LIMIT 1`,
        [a.vendorCode],
      )) as Array<{ id: number }>;
      const vendorId = vendorRows[0]?.id ? Number(vendorRows[0].id) : null;
      if (!vendorId) continue;

      const existing = (await ctx.manager.query(
        isPostgres
          ? `SELECT id FROM compliance_vendor_data_assessments WHERE vendor_id = $1 AND data_category = $2 AND deleted_at IS NULL LIMIT 1`
          : `SELECT id FROM compliance_vendor_data_assessments WHERE vendor_id = ? AND data_category = ? AND deleted_at IS NULL LIMIT 1`,
        [vendorId, a.dataCategory],
      )) as Array<{ id: number }>;
      if (existing.length > 0) continue;

      await ctx.manager.query(
        isPostgres
          ? `INSERT INTO compliance_vendor_data_assessments (
              vendor_id, data_category, classification_level, allowed_data_fields_json,
              prohibited_data_fields_json, processing_purpose, data_flow_direction,
              storage_regions_json, cross_border_transfer, transfer_mechanism, retention_days,
              encryption_in_transit, encryption_at_rest, risk_level, approval_status, reviewed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, TRUE, $12, $13, $14)`
          : `INSERT INTO compliance_vendor_data_assessments (
              vendor_id, data_category, classification_level, allowed_data_fields_json,
              prohibited_data_fields_json, processing_purpose, data_flow_direction,
              storage_regions_json, cross_border_transfer, transfer_mechanism, retention_days,
              encryption_in_transit, encryption_at_rest, risk_level, approval_status, reviewed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, TRUE, ?, ?, ?)`,
        [
          vendorId,
          a.dataCategory,
          a.classificationLevel,
          JSON.stringify(a.allowedDataFields),
          JSON.stringify(a.prohibitedDataFields),
          a.processingPurpose,
          a.dataFlowDirection,
          JSON.stringify(a.storageRegions),
          a.crossBorderTransfer,
          a.transferMechanism,
          a.retentionDays,
          a.riskLevel,
          a.approvalStatus,
          now,
        ],
      );
      affected += 1;
    }

    // Seed initial check history + evidence for CTRL-2026-0001 if empty
    const ctrlRows = (await ctx.manager.query(
      isPostgres
        ? `SELECT id FROM compliance_controls WHERE control_code = $1 AND deleted_at IS NULL LIMIT 1`
        : `SELECT id FROM compliance_controls WHERE control_code = ? AND deleted_at IS NULL LIMIT 1`,
      ['CTRL-2026-0001'],
    )) as Array<{ id: number }>;
    const firstCtrlId = ctrlRows[0]?.id ? Number(ctrlRows[0].id) : null;
    if (firstCtrlId) {
      const existingChecks = (await ctx.manager.query(
        isPostgres
          ? `SELECT id FROM compliance_check_histories WHERE control_id = $1 AND deleted_at IS NULL LIMIT 1`
          : `SELECT id FROM compliance_check_histories WHERE control_id = ? AND deleted_at IS NULL LIMIT 1`,
        [firstCtrlId],
      )) as Array<{ id: number }>;

      if (existingChecks.length === 0) {
        await ctx.manager.query(
          isPostgres
            ? `INSERT INTO compliance_check_histories (
                control_id, checked_by_user_id, checked_at, result, score, findings, remediation_plan
              ) VALUES ($1, 1, $2, 'PASS', 98, 'Hoàn tất rà soát 100% tài khoản quản trị định kỳ quý hiện tại.', NULL)`
            : `INSERT INTO compliance_check_histories (
                control_id, checked_by_user_id, checked_at, result, score, findings, remediation_plan
              ) VALUES (?, 1, ?, 'PASS', 98, 'Hoàn tất rà soát 100% tài khoản quản trị định kỳ quý hiện tại.', NULL)`,
          [firstCtrlId, addDays(now, -35)],
        );
        affected += 1;
      }

      const existingEvidences = (await ctx.manager.query(
        isPostgres
          ? `SELECT id FROM compliance_evidences WHERE control_id = $1 AND deleted_at IS NULL LIMIT 1`
          : `SELECT id FROM compliance_evidences WHERE control_id = ? AND deleted_at IS NULL LIMIT 1`,
        [firstCtrlId],
      )) as Array<{ id: number }>;

      if (existingEvidences.length === 0) {
        await ctx.manager.query(
          isPostgres
            ? `INSERT INTO compliance_evidences (
                control_id, evidence_type, title, description, report_code,
                collected_by_user_id, collected_at, valid_until, status
              ) VALUES ($1, 'REPORT', 'Báo cáo rà soát PAM & Break-glass định kỳ', 'Trích xuất từ báo cáo tuân thủ quyền đặc biệt', 'users.security_compliance', 1, $2, $3, 'VALID')`
            : `INSERT INTO compliance_evidences (
                control_id, evidence_type, title, description, report_code,
                collected_by_user_id, collected_at, valid_until, status
              ) VALUES (?, 'REPORT', 'Báo cáo rà soát PAM & Break-glass định kỳ', 'Trích xuất từ báo cáo tuân thủ quyền đặc biệt', 'users.security_compliance', 1, ?, ?, 'VALID')`,
          [firstCtrlId, addDays(now, -35), addDays(now, 145)],
        );
        affected += 1;
      }
    }

    try {
      const roleRows = (await ctx.manager.query(
        isPostgres
          ? `SELECT id, code FROM roles WHERE code IN ($1, $2) AND deleted_at IS NULL`
          : `SELECT id, code FROM roles WHERE code IN (?, ?) AND deleted_at IS NULL`,
        ['super_admin', 'admin_security'],
      )) as Array<{ id: number; code: string }>;

      const permPlaceholders = COMPLIANCE_PERMS.map((_, idx) =>
        isPostgres ? `$${idx + 1}` : '?',
      ).join(', ');
      const permRows = (await ctx.manager.query(
        `SELECT id, code FROM permissions WHERE code IN (${permPlaceholders}) AND deleted_at IS NULL`,
        [...COMPLIANCE_PERMS],
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
      details: `${DEFAULT_CONTROLS.length} compliance controls, ${DEFAULT_VENDORS.length} vendors, and ${DEFAULT_ASSESSMENTS.length} data assessments ensured`,
    };
  }
}
