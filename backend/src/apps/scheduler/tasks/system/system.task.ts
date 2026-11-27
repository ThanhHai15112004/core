import { Injectable, type OnModuleInit } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  BACKUP_QUEUE_TOPICS,
  COMPLIANCE_QUEUE_TOPICS,
  DATA_GOVERNANCE_QUEUE_TOPICS,
  DR_QUEUE_TOPICS,
  IDEMPOTENCY_QUEUE_TOPICS,
  OUTBOX_QUEUE_TOPICS,
  PRIVILEGED_ACCESS_QUEUE_TOPICS,
  RECONCILIATION_QUEUE_TOPICS,
} from '@packages/kernel/index.js';
import { QUEUES } from '@packages/messaging/index.js';
import { ScheduledTaskRegistry } from '../../registry/scheduled-task.registry.js';

@Injectable()
export class SystemTask implements OnModuleInit {
  constructor(
    private readonly registry: ScheduledTaskRegistry,
    private readonly config: CoreConfigService,
  ) {}

  /** Đăng ký tác vụ bảo trì hệ thống định kỳ (maintenance tick) khi khởi tạo module */
  public onModuleInit(): void {
    this.registry.register({
      id: 'system.maintenance',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'system.maintenance.tick',
      description: 'Enqueue a system.maintenance.tick job for the Worker.',
      pattern: this.config.runtime.scheduler.maintenanceCron,
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'workflows.sla.scan',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'workflows.sla.tick',
      description:
        'Quét thời hạn SLA của các quy trình xử lý (Workflows) đang chạy và gửi cảnh báo sắp quá hạn / quá hạn (Mục 9.3.8).',
      pattern: '*/15 * * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'workflows' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'calendar.reminder.scan',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'calendar.reminder.tick',
      description:
        'Quét các lịch nhắc sự kiện (Calendar & Events) đến hạn và gửi thông báo qua Notification (Mục 9.7.4).',
      pattern: '*/5 * * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'calendar' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'outbox.lag.check',
      queue: QUEUES.SYSTEM_EVENTS,
      name: OUTBOX_QUEUE_TOPICS.LAG_ALERT_TICK,
      description:
        'Kiểm tra độ trễ, tồn đọng và Dead Letter của Transactional Outbox (11.2), cảnh báo quản trị khi vượt ngưỡng.',
      pattern: '*/5 * * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'outbox' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'outbox.cleanup',
      queue: QUEUES.SYSTEM_EVENTS,
      name: OUTBOX_QUEUE_TOPICS.CLEANUP_TICK,
      description:
        'Tự động dọn các sự kiện Outbox PUBLISHED / DEAD_LETTER đã quá hạn lưu trữ theo chính sách retention (11.2).',
      pattern: '15 3 * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'outbox' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'idempotency.cleanup',
      queue: QUEUES.SYSTEM_EVENTS,
      name: IDEMPOTENCY_QUEUE_TOPICS.CLEANUP_TICK,
      description:
        'Tự động dọn các bản ghi khóa chống xử lý trùng (Idempotency) đã hết hạn TTL theo từng luồng (11.3).',
      pattern: '30 3 * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'idempotency' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'reconciliation.schedule.scan',
      queue: QUEUES.SYSTEM_EVENTS,
      name: RECONCILIATION_QUEUE_TOPICS.SCHEDULE_TICK,
      description:
        'Quét và kích hoạt các Job đối soát dữ liệu định kỳ đến hạn giữa hệ thống nội bộ và nguồn bên ngoài (11.5).',
      pattern: '*/10 * * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'reconciliation' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'backup.schedule.scan',
      queue: QUEUES.SYSTEM_EVENTS,
      name: BACKUP_QUEUE_TOPICS.SCHEDULE_TICK,
      description:
        'Quét và kích hoạt các chính sách sao lưu Database/Storage đến hạn theo lịch Cron (13.6).',
      pattern: '*/15 * * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'backup-ops' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'backup.retention.prune',
      queue: QUEUES.SYSTEM_EVENTS,
      name: BACKUP_QUEUE_TOPICS.RETENTION_PRUNE_TICK,
      description: 'Tự động dọn dẹp các bản backup hết hạn lưu trữ theo chính sách Retention (13.6).',
      pattern: this.config.backup.retentionPruneCron,
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'backup-ops' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'backup.verify.drill',
      queue: QUEUES.SYSTEM_EVENTS,
      name: BACKUP_QUEUE_TOPICS.VERIFY_DRILL_TICK,
      description:
        'Tự động kiểm tra và chạy Restore Drill vào môi trường cô lập cho bản backup mới nhất (13.6).',
      pattern: this.config.backup.drillCron,
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'backup-ops' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'dr.sync.schedule',
      queue: QUEUES.SYSTEM_EVENTS,
      name: DR_QUEUE_TOPICS.SYNC_TICK,
      description:
        'Đồng bộ Database/Storage sang DR và kiểm tra ngưỡng RPO theo lịch (13.7 — tự bỏ qua nếu DR đang tắt).',
      pattern: this.config.dr.syncCron,
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'dr-ops' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'dr.drill.check',
      queue: QUEUES.SYSTEM_EVENTS,
      name: DR_QUEUE_TOPICS.DRILL_CHECK_TICK,
      description:
        'Kiểm tra hạn diễn tập Disaster Recovery định kỳ và cảnh báo hoặc tự chạy Simulation Drill (13.7).',
      pattern: this.config.dr.drillCron,
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'dr-ops' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'privileged-access.expiration.sweep',
      queue: QUEUES.SYSTEM_EVENTS,
      name: PRIVILEGED_ACCESS_QUEUE_TOPICS.EXPIRATION_SWEEP_TICK,
      description:
        'Tự động thu hồi quyền đặc biệt tạm thời (JIT) và tự niêm phong tài khoản Break-glass đã hết hạn (14.4).',
      pattern: '*/2 * * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'privileged-access' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'privileged-access.review.schedule',
      queue: QUEUES.SYSTEM_EVENTS,
      name: PRIVILEGED_ACCESS_QUEUE_TOPICS.REVIEW_SCHEDULE_TICK,
      description:
        'Kiểm tra chu kỳ và tự động khởi tạo đợt rà soát quyền đặc biệt định kỳ nếu đến hạn (14.4).',
      pattern: '0 2 * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'privileged-access' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'data-governance.retention.sweep',
      queue: QUEUES.SYSTEM_EVENTS,
      name: DATA_GOVERNANCE_QUEUE_TOPICS.RETENTION_SWEEP_TICK,
      description:
        'Thực thi định kỳ chính sách thời gian lưu dữ liệu (Retention) theo loại dữ liệu, tự động bỏ qua mục đang bị Legal Hold (14.5).',
      pattern: '45 3 * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'data-governance' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'data-governance.expiration.sweep',
      queue: QUEUES.SYSTEM_EVENTS,
      name: DATA_GOVERNANCE_QUEUE_TOPICS.GOVERNANCE_EXPIRATION_TICK,
      description:
        'Tự động hết hạn lệnh Legal Hold, Consent có thời hạn và dọn liên kết tải dữ liệu cá nhân DSAR quá hạn (14.5).',
      pattern: '*/15 * * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'data-governance' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'compliance.review.reminder.sweep',
      queue: QUEUES.SYSTEM_EVENTS,
      name: COMPLIANCE_QUEUE_TOPICS.REVIEW_REMINDER_SWEEP_TICK,
      description:
        'Quét nhắc kiểm tra yêu cầu kiểm soát (Control), rà soát nhà cung cấp, hạn hợp đồng và hết hạn bằng chứng (14.6).',
      pattern: '15 7 * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'compliance' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });
  }
}
