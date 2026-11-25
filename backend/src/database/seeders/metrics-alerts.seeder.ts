import type { SeederContext, SeederContract } from '@packages/database/index.js';

interface DefaultAlertRuleSeed {
  code: string;
  name: string;
  description: string;
  metricKey: string;
  operator: string;
  threshold: number;
  windowSeconds: number;
  forSeconds: number;
  cooldownSeconds: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  channels: string[];
}

const DEFAULT_ALERT_RULES: readonly DefaultAlertRuleSeed[] = [
  {
    code: 'SYS_HTTP_ERROR_RATE_HIGH',
    name: 'Tỷ lệ lỗi HTTP 5xx vượt ngưỡng',
    description: 'Cảnh báo khi tỷ lệ lỗi HTTP 5xx vượt quá 5% trong 5 phút',
    metricKey: 'http.error_rate',
    operator: 'gt',
    threshold: 5,
    windowSeconds: 300,
    forSeconds: 60,
    cooldownSeconds: 300,
    severity: 'CRITICAL',
    channels: ['log', 'webhook', 'notification', 'domain_event'],
  },
  {
    code: 'SYS_HTTP_LATENCY_P95_SLOW',
    name: 'Độ trễ API P95 chậm',
    description: 'Cảnh báo khi P95 thời gian phản hồi HTTP API vượt quá 500ms',
    metricKey: 'http.latency_p95',
    operator: 'gt',
    threshold: 500,
    windowSeconds: 300,
    forSeconds: 60,
    cooldownSeconds: 300,
    severity: 'WARNING',
    channels: ['log', 'webhook', 'domain_event'],
  },
  {
    code: 'SYS_HTTP_LATENCY_P99_CRITICAL',
    name: 'Độ trễ API P99 nghiêm trọng',
    description: 'Cảnh báo khẩn khi P99 thời gian phản hồi HTTP API vượt quá 1500ms',
    metricKey: 'http.latency_p99',
    operator: 'gt',
    threshold: 1500,
    windowSeconds: 300,
    forSeconds: 60,
    cooldownSeconds: 300,
    severity: 'CRITICAL',
    channels: ['log', 'webhook', 'notification', 'domain_event'],
  },
  {
    code: 'SYS_INSTANCE_CPU_HIGH',
    name: 'CPU theo instance vượt ngưỡng',
    description: 'Cảnh báo khi mức sử dụng CPU trên một instance vượt quá 85%',
    metricKey: 'runtime.cpu_percent',
    operator: 'gt',
    threshold: 85,
    windowSeconds: 300,
    forSeconds: 120,
    cooldownSeconds: 300,
    severity: 'WARNING',
    channels: ['log', 'webhook', 'domain_event'],
  },
  {
    code: 'SYS_INSTANCE_EVENT_LOOP_LAG',
    name: 'Event Loop bị nghẽn theo instance',
    description: 'Cảnh báo khi Event Loop P99 trên một instance vượt quá 150ms',
    metricKey: 'runtime.event_loop_p99_ms',
    operator: 'gt',
    threshold: 150,
    windowSeconds: 300,
    forSeconds: 60,
    cooldownSeconds: 300,
    severity: 'CRITICAL',
    channels: ['log', 'webhook', 'notification', 'domain_event'],
  },
  {
    code: 'SYS_DB_POOL_SATURATION',
    name: 'Database connection pool sắp cạn',
    description: 'Cảnh báo khi tỷ lệ sử dụng DB pool vượt 85%',
    metricKey: 'db.pool_utilization_percent',
    operator: 'gt',
    threshold: 85,
    windowSeconds: 300,
    forSeconds: 60,
    cooldownSeconds: 300,
    severity: 'CRITICAL',
    channels: ['log', 'webhook', 'notification', 'domain_event'],
  },
  {
    code: 'SYS_QUEUE_OLDEST_JOB_AGE',
    name: 'Job tồn đọng quá lâu trong Queue',
    description: 'Cảnh báo khi tuổi job chờ lâu nhất trong queue vượt 300 giây',
    metricKey: 'queue.oldest_job_age_sec',
    operator: 'gt',
    threshold: 300,
    windowSeconds: 300,
    forSeconds: 60,
    cooldownSeconds: 300,
    severity: 'WARNING',
    channels: ['log', 'webhook', 'domain_event'],
  },
  {
    code: 'SYS_REDIS_LATENCY_HIGH',
    name: 'Độ trễ Redis P95 cao',
    description: 'Cảnh báo khi độ trễ P95 của lệnh Redis vượt 50ms',
    metricKey: 'redis.latency_p95_ms',
    operator: 'gt',
    threshold: 50,
    windowSeconds: 300,
    forSeconds: 60,
    cooldownSeconds: 300,
    severity: 'WARNING',
    channels: ['log', 'webhook', 'domain_event'],
  },
  {
    code: 'SYS_PROVIDER_LATENCY_HIGH',
    name: 'Độ trễ Provider bên ngoài cao',
    description: 'Cảnh báo khi độ trễ P95 gọi provider/outbound HTTP vượt 2000ms',
    metricKey: 'provider.latency_p95_ms',
    operator: 'gt',
    threshold: 2000,
    windowSeconds: 300,
    forSeconds: 60,
    cooldownSeconds: 300,
    severity: 'WARNING',
    channels: ['log', 'webhook', 'domain_event'],
  },
];

/**
 * Seeder khởi tạo bộ rule cảnh báo hệ thống mặc định (`alert_rules`) cho Mục 12.3.
 * Dùng `INSERT ... ON CONFLICT DO NOTHING` / `INSERT IGNORE` để giữ nguyên rule người vận hành đã tùy biến.
 */
export class MetricsAlertsSeeder implements SeederContract {
  public readonly name = 'MetricsAlertsSeeder';
  public readonly scope = 'master' as const;
  public readonly order = 15;

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    const isPostgres = ctx.driver === 'postgres';
    let affected = 0;

    for (const rule of DEFAULT_ALERT_RULES) {
      const channelsJson = JSON.stringify(rule.channels);
      const params = [
        rule.code,
        rule.name,
        rule.description,
        rule.metricKey,
        rule.operator,
        rule.threshold,
        rule.windowSeconds,
        rule.forSeconds,
        rule.cooldownSeconds,
        rule.severity,
        channelsJson,
      ];

      if (isPostgres) {
        const res = await ctx.manager.query(
          `INSERT INTO alert_rules (
            code, name, description, is_enabled, metric_key, operator, threshold,
            window_seconds, for_seconds, cooldown_seconds, severity, channels_json, is_system
          )
          VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
          ON CONFLICT (code) DO NOTHING`,
          params,
        );
        affected += Number((res as { rowCount?: number } | undefined)?.rowCount ?? 0);
      } else {
        const res = await ctx.manager.query(
          `INSERT IGNORE INTO alert_rules (
            code, name, description, is_enabled, metric_key, operator, threshold,
            window_seconds, for_seconds, cooldown_seconds, severity, channels_json, is_system
          )
          VALUES (?, ?, ?, TRUE, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
          params,
        );
        affected += Number((res as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
      }
    }

    return {
      affected,
      details: `${affected} default system alert rule(s) seeded`,
    };
  }
}
