import { describe, it, expect, beforeEach } from '@jest/globals';
import type { Job, Queue } from 'bullmq';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { ForbiddenAppException } from '@packages/kernel/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { RedisService } from '@packages/redis/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  BaseMessagePublisherProvider,
  CATCHUP_RUN_PREFIX,
  MANUAL_RUN_PREFIX,
  MessagingConnectionService,
  QUEUES,
  QueueRegistry,
  resolveScheduledTaskId,
  scheduledEnvelope,
  type QueueName,
} from '@packages/messaging/index.js';
import { JobProgressTrackerService, schedulerKeys } from '@packages/queue/index.js';
import { ScheduledTaskRegistry } from '@apps/scheduler/registry/scheduled-task.registry.js';
import { ScheduleSyncService } from '@apps/scheduler/bootstrap/sync-schedules.js';
import { SystemProcessor } from '@apps/worker/processors/system/system.processor.js';
import {
  SchedulerActionRejectedException,
  SchedulerOperationsService,
  SchedulerOpsService,
} from '@modules/scheduler-ops/index.js';

describe('Phase 7.4 — Công việc định kỳ (Scheduler: Cron/Interval, Timezone, Distributed Lock, History, Manual Run, Pause/Resume, Failure Alert & Missed Run Detection)', () => {
  let redis: RedisService;
  let config: CoreConfigService;
  let i18n: CoreI18nService;
  let auditLogService: AuditLogService;
  let taskRegistry: ScheduledTaskRegistry;
  let upsertedSchedulers: Map<
    string,
    { repeatOpts: { pattern?: string; every?: number; tz?: string }; jobTemplate: unknown }
  >;
  let dispatchedJobs: Array<{
    id: string;
    queue: string;
    name: string;
    data: unknown;
    opts: Record<string, unknown>;
    repeatJobKey?: string;
    timestamp: number;
    processedOn?: number;
    finishedOn?: number;
    failedReason?: string;
    attemptsMade: number;
    state: 'completed' | 'failed' | 'active' | 'delayed' | 'waiting';
  }>;
  let publishedMessages: Array<{
    queue: string;
    topic: string;
    payload: unknown;
    options: unknown;
  }>;
  let fakeQueueRegistry: QueueRegistry;
  let fakeConnection: MessagingConnectionService;
  let fakePublisher: BaseMessagePublisherProvider;
  let schedulerOperations: SchedulerOperationsService;
  let schedulerOps: SchedulerOpsService;
  let scheduleSync: ScheduleSyncService;
  let progressTracker: JobProgressTrackerService;

  beforeEach(async () => {
    applyTestEnv();
    process.env['SCHEDULER_TIMEZONE'] = 'Asia/Ho_Chi_Minh';
    process.env['SCHEDULER_LOCK_TTL_SEC'] = '120';
    process.env['SCHEDULER_ALERT_RECIPIENTS'] = 'ops-lead@example.com';

    config = new CoreConfigService();
    i18n = new CoreI18nService(config);
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
    auditLogService = new AuditLogService();
    taskRegistry = new ScheduledTaskRegistry();

    upsertedSchedulers = new Map();
    dispatchedJobs = [];
    publishedMessages = [];

    const buildFakeQueue = (queueName: string): Queue =>
      ({
        name: queueName,
        getJobSchedulers: async () =>
          [...upsertedSchedulers.entries()].map(([id, item]) => ({
            id,
            key: id,
            name: id,
            pattern: item.repeatOpts.pattern,
            every: item.repeatOpts.every,
            tz: item.repeatOpts.tz,
            next: Date.now() + 60_000,
            iterationCount: 3,
          })),
        upsertJobScheduler: async (
          id: string,
          repeatOpts: { pattern?: string; every?: number; tz?: string },
          jobTemplate: unknown,
        ) => {
          upsertedSchedulers.set(id, { repeatOpts, jobTemplate });
          return { id };
        },
        removeJobScheduler: async (id: string) => {
          return upsertedSchedulers.delete(id);
        },
        add: async (name: string, data: unknown, opts: Record<string, unknown> = {}) => {
          const jobId = String(opts['jobId'] ?? `job_${Date.now()}_${dispatchedJobs.length + 1}`);
          const entry = {
            id: jobId,
            queue: queueName,
            name,
            data,
            opts,
            timestamp: Date.now(),
            attemptsMade: 0,
            state: 'waiting' as const,
          };
          dispatchedJobs.push(entry);
          return { id: jobId, name, data, opts };
        },
        getJobs: async (states: string[]) => {
          return dispatchedJobs
            .filter((j) => j.queue === queueName && states.includes(j.state))
            .map((j) => ({
              id: j.id,
              name: j.name,
              data: j.data,
              opts: j.opts,
              repeatJobKey: j.repeatJobKey,
              timestamp: j.timestamp,
              delay: 0,
              processedOn: j.processedOn,
              finishedOn: j.finishedOn,
              failedReason: j.failedReason,
              attemptsMade: j.attemptsMade,
            }));
        },
        getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0, failed: 0 }),
        isPaused: async () => false,
        getWorkers: async () => [{ id: 'w1' }],
      }) as unknown as Queue;

    const queueMap = new Map<QueueName, Queue>([
      [QUEUES.SYSTEM_EVENTS, buildFakeQueue(QUEUES.SYSTEM_EVENTS)],
      [QUEUES.SYSTEM_CRITICAL, buildFakeQueue(QUEUES.SYSTEM_CRITICAL)],
      [QUEUES.SYSTEM_NOTIFICATIONS, buildFakeQueue(QUEUES.SYSTEM_NOTIFICATIONS)],
      [QUEUES.SYSTEM_HEAVY, buildFakeQueue(QUEUES.SYSTEM_HEAVY)],
    ]);

    fakeQueueRegistry = {
      isKnown: (name: string) => queueMap.has(name as QueueName),
      get: (name: string) => queueMap.get(name as QueueName)!,
      getQueue: (name: string) => queueMap.get(name as QueueName)!,
      getQueues: () => queueMap,
      withTimeout: <T>(p: Promise<T>) => p,
      retentionOptions: () => ({ removeOnComplete: { count: 200 }, removeOnFail: { count: 500 } }),
    } as unknown as QueueRegistry;

    fakeConnection = {
      getStatus: () => ({
        state: 'connected',
        since: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        lastPingMs: 1,
        lastError: null,
        lastPublishAt: null,
        failures: 0,
      }),
    } as unknown as MessagingConnectionService;

    fakePublisher = {
      recordPublished: () => undefined,
      publish: async (queue: string, topic: string, payload: unknown, options?: unknown) => {
        publishedMessages.push({ queue, topic, payload, options });
      },
    } as unknown as BaseMessagePublisherProvider;

    progressTracker = new JobProgressTrackerService(redis, config, fakePublisher);
    schedulerOperations = new SchedulerOperationsService(
      config,
      redis,
      fakeQueueRegistry,
      fakeConnection,
      fakePublisher,
      auditLogService,
    );
    schedulerOps = new SchedulerOpsService(
      config,
      i18n,
      redis,
      fakeQueueRegistry,
      schedulerOperations,
      fakeConnection,
    );
    scheduleSync = new ScheduleSyncService(
      fakeQueueRegistry,
      fakeConnection,
      redis,
      taskRegistry,
      config,
    );
  });

  it('7.4.1 & 7.4.2: đăng ký công việc định kỳ theo Cron hoặc khoảng thời gian (Interval) và tính đúng múi giờ cấu hình độc lập với server', async () => {
    taskRegistry.register({
      id: 'reports.daily',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'reports.daily.generate',
      description: 'Generate daily summary report at 08:00 Tokyo time',
      pattern: '0 8 * * *',
      tz: 'Asia/Tokyo',
      ownerEmail: 'reports-owner@example.com',
    });

    taskRegistry.register({
      id: 'cache.warmup',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'cache.warmup.tick',
      description: 'Warm up hot cache every 60 seconds',
      every: 60_000,
    });

    const synced = await scheduleSync.sync();
    expect(synced).toBe(true);
    expect(upsertedSchedulers.size).toBe(2);

    const cronTask = upsertedSchedulers.get('reports.daily');
    expect(cronTask?.repeatOpts).toEqual({
      pattern: '0 8 * * *',
      tz: 'Asia/Tokyo',
    });

    const intervalTask = upsertedSchedulers.get('cache.warmup');
    expect(intervalTask?.repeatOpts).toEqual({
      every: 60_000,
      tz: 'Asia/Ho_Chi_Minh',
    });

    // Kiểm tra tính toán mốc chạy theo múi giờ cụ thể không phụ thuộc timezone của server
    const tokyoInspect = schedulerOps.inspectCron('0 8 * * *', 'Asia/Tokyo');
    const utcInspect = schedulerOps.inspectCron('0 8 * * *', 'UTC');
    expect(tokyoInspect.valid).toBe(true);
    expect(tokyoInspect.timezone).toBe('Asia/Tokyo');
    expect(tokyoInspect.utcOffset).toBe('+09:00');
    expect(utcInspect.utcOffset).toBe('+00:00');
    expect(tokyoInspect.next[0]).not.toBe(utcInspect.next[0]);
  });

  it('7.4.3: ngăn một công việc định kỳ chạy trùng bằng Redis Distributed Lock (chặn cả Run Now lẫn Worker chạy chồng)', async () => {
    taskRegistry.register({
      id: 'billing.reconcile',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'billing.reconcile.run',
      pattern: '*/10 * * * *',
    });
    await scheduleSync.sync();

    // 1. Chiếm giữ Distributed Lock cho lần thực thi đầu tiên
    const firstLock = await schedulerOperations.acquireTaskLock(
      'billing.reconcile',
      'exec_running_1',
      60,
    );
    expect(firstLock).toEqual({ acquired: true, holder: 'exec_running_1' });

    // 2. Lần thực thi thứ 2 của cùng task bị từ chối chiếm lock
    const secondLock = await schedulerOperations.acquireTaskLock(
      'billing.reconcile',
      'exec_running_2',
      60,
    );
    expect(secondLock).toEqual({ acquired: false, holder: 'exec_running_1' });

    // 3. Bấm Run Now khi task đang giữ lock -> ném 409 TASK_RUNNING
    await expect(
      schedulerOperations.runNow('billing.reconcile', {
        ip: '127.0.0.1',
        actor: 'admin@example.com',
        permissions: ['scheduler.run'],
      }),
    ).rejects.toThrow(SchedulerActionRejectedException);

    // 4. Worker nhận một job trùng khi lock đang giữ bởi exec_running_1 -> tự động skip (không chạy chồng)
    const metrics = new MetricsRegistryService(config, 'worker', 0);
    let handlerCount = 0;
    const processor = new SystemProcessor(config, metrics, progressTracker, {
      purgeExpiredTrash: async () => {
        handlerCount++;
        return { purgedCount: 1 };
      },
    } as never);

    const overlappingJob = {
      id: 'repeat:billing.reconcile:overlap_2',
      name: 'system.maintenance.tick',
      queueName: QUEUES.SYSTEM_EVENTS,
      repeatJobKey: 'billing.reconcile',
      data: { triggeredBy: 'scheduler' },
      timestamp: Date.now(),
      attemptsMade: 0,
      attemptsStarted: 1,
      opts: { attempts: 1 },
      log: async () => 1,
      updateProgress: async () => undefined,
    } as unknown as Job;

    const overlapRes = (await processor.process(overlappingJob)) as {
      skipped?: boolean;
      reason?: string;
      holderExecutionId?: string;
    };
    expect(overlapRes.skipped).toBe(true);
    expect(overlapRes.reason).toBe('overlap_prevented');
    expect(overlapRes.holderExecutionId).toBe('exec_running_1');
    expect(handlerCount).toBe(0);

    // 5. Giải phóng lock của exec_running_1 -> job tiếp theo chạy bình thường và tự giải phóng lock sau khi xong
    const released = await schedulerOperations.releaseTaskLock(
      'billing.reconcile',
      'exec_running_1',
    );
    expect(released).toBe(true);
    expect(await schedulerOperations.getTaskLock('billing.reconcile')).toBeNull();

    const normalRes = (await processor.process(overlappingJob)) as { handled?: boolean };
    expect(normalRes.handled).toBe(true);
    expect(handlerCount).toBe(1);
    expect(await schedulerOperations.getTaskLock('billing.reconcile')).toBeNull();
  });

  it('7.4.4: ghi lịch sử mỗi lần chạy (thời gian bắt đầu, kết thúc, thời lượng, trạng thái và kết quả/lỗi)', async () => {
    taskRegistry.register({
      id: 'system.maintenance',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'system.maintenance.tick',
      pattern: '*/5 * * * *',
    });
    await scheduleSync.sync();

    const now = Date.now();
    dispatchedJobs.push(
      {
        id: 'repeat:system.maintenance:1',
        queue: QUEUES.SYSTEM_EVENTS,
        name: 'system.maintenance.tick',
        data: {},
        opts: {},
        repeatJobKey: 'system.maintenance',
        timestamp: now - 120_000,
        processedOn: now - 119_500,
        finishedOn: now - 118_200,
        attemptsMade: 1,
        state: 'completed',
      },
      {
        id: `${MANUAL_RUN_PREFIX}system.maintenance:${now - 60_000}`,
        queue: QUEUES.SYSTEM_EVENTS,
        name: 'system.maintenance.tick',
        data: {},
        opts: {},
        timestamp: now - 60_000,
        processedOn: now - 59_800,
        finishedOn: now - 59_100,
        failedReason: 'DatabaseError: deadlock detected',
        attemptsMade: 2,
        state: 'failed',
      },
    );

    const executions = await schedulerOps.getExecutions({
      range: '24h',
      taskId: 'system.maintenance',
    });
    expect(executions.items).toHaveLength(2);

    const manualFailed = executions.items[0]!;
    expect(manualFailed.trigger).toBe('manual');
    expect(manualFailed.status).toBe('failed');
    expect(manualFailed.startedAt).toBe(new Date(now - 59_800).toISOString());
    expect(manualFailed.finishedAt).toBe(new Date(now - 59_100).toISOString());
    expect(manualFailed.durationMs).toBe(700);
    expect(manualFailed.error).toEqual({
      type: 'DatabaseError',
      message: 'DatabaseError: deadlock detected',
    });

    const scheduledSuccess = executions.items[1]!;
    expect(scheduledSuccess.trigger).toBe('scheduled');
    expect(scheduledSuccess.status).toBe('success');
    expect(scheduledSuccess.startedAt).toBe(new Date(now - 119_500).toISOString());
    expect(scheduledSuccess.finishedAt).toBe(new Date(now - 118_200).toISOString());
    expect(scheduledSuccess.durationMs).toBe(1300);
    expect(scheduledSuccess.error).toBeNull();
  });

  it('7.4.5 & 7.4.6: cho phép chạy thủ công (runNow) và tạm dừng/bật lại (disable/enable) có kiểm tra quyền RBAC và ghi AuditLog', async () => {
    taskRegistry.register({
      id: 'sync.inventory',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'sync.inventory.tick',
      pattern: '*/15 * * * *',
    });
    await scheduleSync.sync();

    const recordedAudits: Array<{
      action: string;
      resourceId: string | null;
      actorIdentifier: string | null;
    }> = [];
    auditLogService.record = async (input) => {
      recordedAudits.push({
        action: input.action,
        resourceId: input.resourceId ?? null,
        actorIdentifier: input.actorIdentifier ?? null,
      });
      return {} as never;
    };

    // 1. Không có quyền `scheduler.run` -> bị chặn bởi ForbiddenAppException (403)
    await expect(
      schedulerOperations.runNow('sync.inventory', {
        ip: '10.0.0.15',
        actor: 'viewer@example.com',
        userId: 20,
        permissions: ['scheduler.view'],
      }),
    ).rejects.toThrow(ForbiddenAppException);

    // 2. Không có quyền `scheduler.toggle` -> bị chặn khi disable / enable
    await expect(
      schedulerOperations.disable('sync.inventory', {
        ip: '10.0.0.15',
        actor: 'viewer@example.com',
        userId: 20,
        permissions: ['scheduler.run'],
      }),
    ).rejects.toThrow(ForbiddenAppException);

    // 3. Có quyền `scheduler.run` -> chạy thủ công thành công + ghi AuditLog
    const runRes = await schedulerOperations.runNow('sync.inventory', {
      ip: '10.0.0.99',
      actor: 'operator@example.com',
      userId: 99,
      permissions: ['scheduler.run'],
    });
    expect(runRes.executionId).toMatch(/^manual:sync\.inventory:/);
    expect(runRes.record.result).toBe('success');

    // 4. Có quyền `scheduler.toggle` -> tạm dừng (disable) và bật lại (enable) thành công + ghi AuditLog
    const disableRec = await schedulerOperations.disable('sync.inventory', {
      ip: '10.0.0.99',
      actor: 'operator@example.com',
      userId: 99,
      permissions: ['scheduler.toggle'],
    });
    expect(disableRec.action).toBe('disable');
    expect(disableRec.result).toBe('success');
    expect(upsertedSchedulers.has('sync.inventory')).toBe(false);

    const enableRec = await schedulerOperations.enable('sync.inventory', {
      ip: '10.0.0.99',
      actor: 'operator@example.com',
      userId: 99,
      permissions: ['scheduler.toggle'],
    });
    expect(enableRec.action).toBe('enable');
    expect(enableRec.result).toBe('success');
    expect(upsertedSchedulers.has('sync.inventory')).toBe(true);

    // Kiểm tra cả Redis operations log và DB AuditLogService
    const opsList = await schedulerOperations.getOperations();
    expect(opsList.map((o) => o.action)).toEqual(['enable', 'disable', 'run']);
    expect(recordedAudits).toEqual([
      {
        action: 'SCHEDULER_RUN',
        resourceId: 'sync.inventory',
        actorIdentifier: 'operator@example.com',
      },
      {
        action: 'SCHEDULER_DISABLE',
        resourceId: 'sync.inventory',
        actorIdentifier: 'operator@example.com',
      },
      {
        action: 'SCHEDULER_ENABLE',
        resourceId: 'sync.inventory',
        actorIdentifier: 'operator@example.com',
      },
    ]);
  });

  it('7.4.7: tự động gửi cảnh báo cho người phụ trách khi công việc định kỳ thất bại', async () => {
    taskRegistry.register({
      id: 'finance.settlement',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'finance.settlement.run',
      pattern: '0 2 * * *',
      ownerEmail: 'finance-owner@example.com',
      notifyEmails: ['cto@example.com'],
      notifyOnFailure: true,
    });
    await scheduleSync.sync();

    const metrics = new MetricsRegistryService(config, 'worker', 0);
    const failingProcessor = new SystemProcessor(config, metrics, progressTracker, {
      purgeExpiredTrash: async () => {
        throw new Error('Upstream settlement gateway 503');
      },
    } as never);

    const failingScheduledJob = {
      id: 'repeat:finance.settlement:fail_1',
      name: 'system.maintenance.tick',
      queueName: QUEUES.SYSTEM_EVENTS,
      repeatJobKey: 'finance.settlement',
      data: { triggeredBy: 'scheduler' },
      timestamp: Date.now(),
      attemptsMade: 0,
      attemptsStarted: 1,
      opts: { attempts: 1 },
      log: async () => 1,
      updateProgress: async () => undefined,
    } as unknown as Job;

    await expect(failingProcessor.process(failingScheduledJob)).rejects.toThrow(
      'Upstream settlement gateway 503',
    );

    // Kiểm tra bản ghi cảnh báo lỗi đã lưu trong Redis `scheduler:failure-alerts`
    const alerts = await schedulerOps.getFailureAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.taskId).toBe('finance.settlement');
    expect(alerts[0]!.executionId).toBe('repeat:finance.settlement:fail_1');
    expect(alerts[0]!.error).toContain('Upstream settlement gateway 503');
    expect(alerts[0]!.recipients).toEqual(
      expect.arrayContaining([
        'finance-owner@example.com',
        'cto@example.com',
        'ops-lead@example.com',
      ]),
    );

    // Kiểm tra job thông báo khẩn cấp đã được publish vào `system.critical` gửi tới người phụ trách
    expect(publishedMessages).toHaveLength(1);
    expect(publishedMessages[0]!.queue).toBe(QUEUES.SYSTEM_CRITICAL);
    expect(publishedMessages[0]!.topic).toBe('scheduler.task.failed');
    const payload = publishedMessages[0]!.payload as {
      templateCode: string;
      recipients: Array<{ recipientAddress: string }>;
    };
    expect(payload.templateCode).toBe('SCHEDULER_TASK_FAILED');
    expect(payload.recipients.map((r) => r.recipientAddress)).toEqual(
      expect.arrayContaining([
        'finance-owner@example.com',
        'cto@example.com',
        'ops-lead@example.com',
      ]),
    );
  });

  it('7.4.8: phát hiện công việc bị bỏ lỡ khi server tắt trong thời gian dài, sinh cảnh báo MISSED_RUN và chạy bù theo misfirePolicy', async () => {
    taskRegistry.register({
      id: 'cleanup.expired_tokens',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'cleanup.expired_tokens.tick',
      pattern: '*/10 * * * *',
      misfirePolicy: 'run_once',
    });

    const nowMs = Date.parse('2026-10-25T10:35:00.000Z');
    const thirtyFiveMinutesAgo = Date.parse('2026-10-25T10:00:00.000Z');

    // Giả lập server lần cuối hoạt động lúc 10:00:00Z và bị tắt tới 10:35:00Z (bỏ lỡ 3 mốc: 10:10, 10:20, 10:30)
    await redis.client.hset(
      schedulerKeys(redis).checkpoints(),
      'cleanup.expired_tokens',
      String(thirtyFiveMinutesAgo),
    );
    await redis.client.hset(
      schedulerKeys(redis).definitions(),
      'cleanup.expired_tokens',
      JSON.stringify(taskRegistry.get('cleanup.expired_tokens')),
    );

    const detected = await scheduleSync.detectAndCompensateMissedRuns(
      taskRegistry.get('cleanup.expired_tokens')!,
      fakeQueueRegistry.getQueue(QUEUES.SYSTEM_EVENTS),
      nowMs,
    );

    // Phải phát hiện đúng 3 lần bị bỏ lỡ (10:10, 10:20, 10:30)
    expect(detected).toHaveLength(3);
    expect(detected.map((d) => new Date(d.scheduledAt).toISOString())).toEqual([
      '2026-10-25T10:10:00.000Z',
      '2026-10-25T10:20:00.000Z',
      '2026-10-25T10:30:00.000Z',
    ]);

    // Do misfirePolicy = 'run_once', hệ thống tự động đẩy đúng 1 job chạy bù (catch-up)
    const catchupId = `${CATCHUP_RUN_PREFIX}cleanup.expired_tokens:${nowMs}`;
    expect(detected[2]!.compensatedExecutionId).toBe(catchupId);
    expect(dispatchedJobs.some((j) => j.id === catchupId)).toBe(true);

    // Kiểm tra helper resolveScheduledTaskId và scheduledEnvelope nhận diện đúng job catch-up
    const catchupJob = dispatchedJobs.find((j) => j.id === catchupId)!;
    expect(resolveScheduledTaskId({ id: catchupJob.id })).toBe('cleanup.expired_tokens');
    const env = scheduledEnvelope({
      id: catchupJob.id,
      name: catchupJob.name,
      data: catchupJob.data,
      timestamp: catchupJob.timestamp,
    });
    expect(env?.meta?.source.detail).toBe('catchup');

    // Kiểm tra danh sách missed executions và cảnh báo MISSED_RUN trên Dashboard
    const missedList = await schedulerOps.getMissedExecutions();
    expect(missedList).toHaveLength(3);
  });
});
