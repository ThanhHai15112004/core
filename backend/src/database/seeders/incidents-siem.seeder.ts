import type { SeederContext, SeederContract } from '@packages/database/index.js';

interface DefaultSeverityPolicySeed {
  severity: 'P1' | 'P2' | 'P3' | 'P4';
  name: string;
  description: string;
  responseSlaMinutes: number;
  resolutionSlaMinutes: number;
  autoEscalate: boolean;
}

interface DefaultRunbookSeed {
  code: string;
  title: string;
  description: string;
  alertCode: string;
  defaultSeverity: 'P1' | 'P2' | 'P3' | 'P4';
  triageSteps: string[];
  mitigationSteps: string[];
  verificationSteps: string[];
}

interface DefaultOwnerMappingSeed {
  alertCode: string;
  alertName: string;
  source: 'SIEM' | 'METRICS' | 'MANUAL';
  defaultSeverity: 'P1' | 'P2' | 'P3' | 'P4';
  ownerUserId: number;
  runbookCode: string | null;
  notifyChannels: string[];
}

const DEFAULT_SEVERITY_POLICIES: readonly DefaultSeverityPolicySeed[] = [
  {
    severity: 'P1',
    name: 'Nghiêm trọng khẩn cấp (Critical / P1)',
    description:
      'Sự cố bảo mật hoặc sập hệ thống diện rộng (lộ/tái sử dụng token, chiếm quyền, mất dịch vụ). Yêu cầu phản hồi ngay.',
    responseSlaMinutes: 15,
    resolutionSlaMinutes: 60,
    autoEscalate: true,
  },
  {
    severity: 'P2',
    name: 'Mức độ cao (High / P2)',
    description:
      'Bất thường bảo mật rõ rệt hoặc suy giảm nghiêm trọng (Brute-force đăng nhập, đổi quyền nhạy cảm, export dữ liệu lớn, tắt MFA).',
    responseSlaMinutes: 30,
    resolutionSlaMinutes: 240,
    autoEscalate: true,
  },
  {
    severity: 'P3',
    name: 'Mức độ trung bình (Medium / P3)',
    description:
      'Cảnh báo cần kiểm tra trong ca trực (vượt rate-limit lặp lại, độ trễ tăng cao cục bộ).',
    responseSlaMinutes: 120,
    resolutionSlaMinutes: 1440,
    autoEscalate: false,
  },
  {
    severity: 'P4',
    name: 'Mức độ thấp (Low / P4)',
    description: 'Cảnh báo theo dõi thông tin, điều tra định kỳ hoặc tối ưu phòng ngừa.',
    responseSlaMinutes: 1440,
    resolutionSlaMinutes: 4320,
    autoEscalate: false,
  },
];

const DEFAULT_RUNBOOKS: readonly DefaultRunbookSeed[] = [
  {
    code: 'RB_BRUTE_FORCE_LOGIN',
    title: 'Runbook xử lý đăng nhập sai liên tiếp / Brute-Force',
    description:
      'Quy trình kiểm tra nguồn IP, tài khoản mục tiêu và phong tỏa tấn công dò mật khẩu.',
    alertCode: 'ANOMALY_BRUTE_FORCE_LOGIN',
    defaultSeverity: 'P2',
    triageSteps: [
      'Kiểm tra danh sách IP nguồn, User-Agent và danh sách tài khoản bị nhắm tới trong Security Events / Auth Login Histories.',
      'Đối chiếu xem tài khoản mục tiêu có đăng nhập thành công bất thường từ IP đó ngay trước/sau đợt thất bại hay không.',
      'Kiểm tra xem nhiều tài khoản có bị dò cùng lúc (Password Spraying) từ dải IP hay không.',
    ],
    mitigationSteps: [
      'Khóa tạm thời hoặc yêu cầu đặt lại mật khẩu đối với tài khoản có dấu hiệu bị xâm nhập.',
      'Bật hoặc siết ngưỡng Rate Limit / Block IP tại WAF hoặc PlatformSecurityService.',
      'Thu hồi toàn bộ phiên đăng nhập nghi vấn nếu phát hiện đăng nhập thành công bất thường.',
    ],
    verificationSteps: [
      'Xác nhận lưu lượng LOGIN_FAILED từ IP nghi vấn đã giảm về 0 trong 15 phút tiếp theo.',
      'Ghi lại nguyên nhân, dải IP đã chặn và cập nhật hậu kiểm.',
    ],
  },
  {
    code: 'RB_PRIVILEGE_ESCALATION',
    title: 'Runbook xử lý thay đổi quyền hạn / vai trò nhạy cảm',
    description:
      'Xác minh tính hợp lệ của thao tác cấp quyền, đổi quyền Role hoặc nâng quyền Admin.',
    alertCode: 'ANOMALY_PRIVILEGE_MODIFICATION',
    defaultSeverity: 'P2',
    triageSteps: [
      'Kiểm tra actorUserId, targetUserId và beforeData/afterData trong Audit Log.',
      'Xác nhận với người thực hiện (actor) hoặc ticket phê duyệt xem thay đổi quyền có nằm trong yêu cầu hợp lệ không.',
      'Rà soát toàn bộ thao tác khác của actor trong 30 phút xung quanh thời điểm đổi quyền.',
    ],
    mitigationSteps: [
      'Nếu không hợp lệ: hoàn tác ngay quyền/vai trò về trạng thái beforeData.',
      'Thu hồi toàn bộ phiên và API token đang hoạt động của cả actor và targetUserId nếu nghi ngờ chiếm quyền.',
    ],
    verificationSteps: [
      'Kiểm tra lại ma trận quyền RBAC của vai trò/người dùng bị tác động đã khớp trạng thái an toàn.',
    ],
  },
  {
    code: 'RB_LARGE_DATA_EXPORT',
    title: 'Runbook xử lý xuất dữ liệu khối lượng lớn (Large Data Export)',
    description: 'Đánh giá rủi ro rò rỉ dữ liệu khi người dùng xuất số lượng bản ghi vượt ngưỡng.',
    alertCode: 'ANOMALY_LARGE_DATA_EXPORT',
    defaultSeverity: 'P2',
    triageSteps: [
      'Kiểm tra profileCode, filters, totalExported, định dạng file và IP thực hiện trong Export Histories.',
      'Xác nhận với quản lý bộ phận xem tác vụ xuất dữ liệu có phục vụ báo cáo/đối soát hợp lệ không.',
    ],
    mitigationSteps: [
      'Thu hồi ngay downloadToken / đánh dấu hết hạn artifact export nếu phát hiện hành vi bất thường.',
      'Tạm khóa tài khoản thực hiện và thu hồi phiên đăng nhập nếu nghi ngờ đánh cắp dữ liệu.',
    ],
    verificationSteps: [
      'Xác nhận link tải tạm thời trả về expired/404 và không có lượt tải tiếp theo.',
    ],
  },
  {
    code: 'RB_TOKEN_COMPROMISE',
    title: 'Runbook xử lý tái sử dụng Refresh Token (Token Reuse Attack)',
    description: 'Ứng cứu khẩn cấp P1 khi phát hiện Refresh Token đã xoay vòng bị dùng lại.',
    alertCode: 'ANOMALY_REFRESH_TOKEN_REUSE',
    defaultSeverity: 'P1',
    triageSteps: [
      'Xác định userId, sessionId và hai địa chỉ IP/User-Agent khác nhau cùng sử dụng chuỗi token.',
      'Kiểm tra các hành động nhạy cảm (đổi mật khẩu, đổi quyền, export) phát sinh sau thời điểm token bị đánh cắp.',
    ],
    mitigationSteps: [
      'Đảm bảo toàn bộ family session của người dùng đã bị thu hồi (revokeAllSessions).',
      'Buộc đặt lại mật khẩu và kiểm tra lại cấu hình MFA của tài khoản bị ảnh hưởng.',
    ],
    verificationSteps: [
      'Xác nhận không còn refresh token nào thuộc session family cũ còn hiệu lực.',
    ],
  },
  {
    code: 'RB_MFA_DISABLED',
    title: 'Runbook xử lý tắt hoặc đặt lại MFA bất thường',
    description: 'Kiểm tra thao tác vô hiệu hóa bảo vệ 2 lớp (MFA) trên tài khoản người dùng.',
    alertCode: 'ANOMALY_MFA_DISABLED',
    defaultSeverity: 'P2',
    triageSteps: [
      'Kiểm tra người thực hiện là chính chủ hay Admin reset hộ và đối chiếu IP/thiết bị.',
    ],
    mitigationSteps: [
      'Nếu không có xác nhận chính chủ: khóa tạm tài khoản, thu hồi toàn bộ phiên và bật lại yêu cầu cấu hình MFA bắt buộc.',
    ],
    verificationSteps: [
      'Xác nhận người dùng đã kích hoạt lại MFA trước khi tiếp tục truy cập hệ thống.',
    ],
  },
];

const DEFAULT_OWNER_MAPPINGS: readonly DefaultOwnerMappingSeed[] = [
  {
    alertCode: 'ANOMALY_REFRESH_TOKEN_REUSE',
    alertName: 'Tái sử dụng Refresh Token (Token Compromise)',
    source: 'SIEM',
    defaultSeverity: 'P1',
    ownerUserId: 1,
    runbookCode: 'RB_TOKEN_COMPROMISE',
    notifyChannels: ['IN_APP', 'EMAIL'],
  },
  {
    alertCode: 'ANOMALY_BRUTE_FORCE_LOGIN',
    alertName: 'Đăng nhập sai liên tiếp / Brute-Force',
    source: 'SIEM',
    defaultSeverity: 'P2',
    ownerUserId: 1,
    runbookCode: 'RB_BRUTE_FORCE_LOGIN',
    notifyChannels: ['IN_APP', 'EMAIL'],
  },
  {
    alertCode: 'ANOMALY_PRIVILEGE_MODIFICATION',
    alertName: 'Thay đổi quyền hạn / vai trò nhạy cảm',
    source: 'SIEM',
    defaultSeverity: 'P2',
    ownerUserId: 1,
    runbookCode: 'RB_PRIVILEGE_ESCALATION',
    notifyChannels: ['IN_APP', 'EMAIL'],
  },
  {
    alertCode: 'ANOMALY_LARGE_DATA_EXPORT',
    alertName: 'Xuất dữ liệu khối lượng lớn',
    source: 'SIEM',
    defaultSeverity: 'P2',
    ownerUserId: 1,
    runbookCode: 'RB_LARGE_DATA_EXPORT',
    notifyChannels: ['IN_APP', 'EMAIL'],
  },
  {
    alertCode: 'ANOMALY_MFA_DISABLED',
    alertName: 'Tắt hoặc đặt lại MFA',
    source: 'SIEM',
    defaultSeverity: 'P2',
    ownerUserId: 1,
    runbookCode: 'RB_MFA_DISABLED',
    notifyChannels: ['IN_APP', 'EMAIL'],
  },
  {
    alertCode: 'ANOMALY_RATE_LIMIT_ABUSE',
    alertName: 'Vượt ngưỡng Rate Limit API',
    source: 'SIEM',
    defaultSeverity: 'P3',
    ownerUserId: 1,
    runbookCode: null,
    notifyChannels: ['IN_APP'],
  },
];

/**
 * Seeder khởi tạo chính sách mức độ sự cố P1–P4, Runbook mẫu và bảng phân công Owner mặc định cho Mục 12.6.
 */
export class IncidentsSiemSeeder implements SeederContract {
  public readonly name = 'IncidentsSiemSeeder';
  public readonly scope = 'master' as const;
  public readonly order = 16;

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    const isPostgres = ctx.driver === 'postgres';
    let affected = 0;

    for (const p of DEFAULT_SEVERITY_POLICIES) {
      const params = [
        p.severity,
        p.name,
        p.description,
        p.responseSlaMinutes,
        p.resolutionSlaMinutes,
        p.autoEscalate,
      ];
      if (isPostgres) {
        const res = await ctx.manager.query(
          `INSERT INTO incident_severity_policies (
            severity, name, description, response_sla_minutes, resolution_sla_minutes, auto_escalate, is_system
          )
          VALUES ($1, $2, $3, $4, $5, $6, TRUE)
          ON CONFLICT (severity) DO NOTHING`,
          params,
        );
        affected += Number((res as { rowCount?: number } | undefined)?.rowCount ?? 0);
      } else {
        const res = await ctx.manager.query(
          `INSERT IGNORE INTO incident_severity_policies (
            severity, name, description, response_sla_minutes, resolution_sla_minutes, auto_escalate, is_system
          )
          VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
          params,
        );
        affected += Number((res as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
      }
    }

    for (const rb of DEFAULT_RUNBOOKS) {
      const params = [
        rb.code,
        rb.title,
        rb.description,
        rb.alertCode,
        rb.defaultSeverity,
        JSON.stringify(rb.triageSteps),
        JSON.stringify(rb.mitigationSteps),
        JSON.stringify(rb.verificationSteps),
      ];
      if (isPostgres) {
        const res = await ctx.manager.query(
          `INSERT INTO incident_runbooks (
            code, title, description, alert_code, default_severity,
            triage_steps_json, mitigation_steps_json, verification_steps_json,
            is_active, is_system
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, TRUE)
          ON CONFLICT (code) DO NOTHING`,
          params,
        );
        affected += Number((res as { rowCount?: number } | undefined)?.rowCount ?? 0);
      } else {
        const res = await ctx.manager.query(
          `INSERT IGNORE INTO incident_runbooks (
            code, title, description, alert_code, default_severity,
            triage_steps_json, mitigation_steps_json, verification_steps_json,
            is_active, is_system
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, TRUE)`,
          params,
        );
        affected += Number((res as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
      }
    }

    const runbookRows = (await ctx.manager.query(
      'SELECT id, code FROM incident_runbooks WHERE deleted_at IS NULL',
    )) as { id: number | string; code: string }[];
    const runbookIdByCode = new Map<string, number>();
    for (const row of runbookRows) {
      runbookIdByCode.set(String(row.code), Number(row.id));
    }

    for (const m of DEFAULT_OWNER_MAPPINGS) {
      const runbookId = m.runbookCode ? (runbookIdByCode.get(m.runbookCode) ?? null) : null;
      const params = [
        m.alertCode,
        m.alertName,
        m.source,
        m.defaultSeverity,
        m.ownerUserId,
        runbookId,
        JSON.stringify(m.notifyChannels),
      ];
      if (isPostgres) {
        const res = await ctx.manager.query(
          `INSERT INTO alert_owner_mappings (
            alert_code, alert_name, source, default_severity, owner_user_id,
            runbook_id, notify_channels_json, is_enabled, is_system
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, TRUE)
          ON CONFLICT (alert_code) DO NOTHING`,
          params,
        );
        affected += Number((res as { rowCount?: number } | undefined)?.rowCount ?? 0);
      } else {
        const res = await ctx.manager.query(
          `INSERT IGNORE INTO alert_owner_mappings (
            alert_code, alert_name, source, default_severity, owner_user_id,
            runbook_id, notify_channels_json, is_enabled, is_system
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, TRUE)`,
          params,
        );
        affected += Number((res as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
      }
    }

    return {
      affected,
      details: `${affected} incident severity policy / runbook / owner mapping row(s) seeded`,
    };
  }
}
