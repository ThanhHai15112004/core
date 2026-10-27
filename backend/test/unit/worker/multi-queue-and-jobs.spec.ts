import { describe, it, expect, beforeEach } from '@jest/globals';
import { UnrecoverableError, type Job } from 'bullmq';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import {
  ExportRegistryService,
  ForbiddenAppException,
  ImportRegistryService,
  ReportRegistryService,
  SearchRegistryService,
} from '@packages/kernel/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { RedisService } from '@packages/redis/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  BaseMessagePublisherProvider,
  JOB_PRIORITIES,
  MAX_JOB_ATTEMPTS_CAP,
  QUEUE_PROFILES,
  QUEUES,
  QueueRegistry,
  serializeMessage,
  type QueueName,
} from '@packages/messaging/index.js';
import {
  BullMqJobProvider,
  JobMonitoringService,
  JobOperationsService,
  JobProgressTrackerService,
  QueueOperationsService,
  priorityLevel,
  progressOf,
  toJobRecord,
  withJobExecutionTimeout,
  type QueueMonitoringService,
} from '@packages/queue/index.js';
import { CriticalProcessor } from '@apps/worker/processors/critical/critical.processor.js';
import { NotificationsProcessor } from '@apps/worker/processors/notifications/notifications.processor.js';
import { HeavyJobProcessor } from '@apps/worker/processors/heavy/heavy-job.processor.js';
import { SystemProcessor } from '@apps/worker/processors/system/system.processor.js';
import { DefaultEmailNotificationAdapter } from '@modules/auth/index.js';
import { UserImportService, type UsersService } from '@modules/users/index.js';
import type { FilesService } from '@modules/files/index.js';
import type { NotificationChannelsService } from '@modules/notifications/index.js';

describe('Phase 7.3 — Hàng đợi công việc (Multi-Queue, Worker Concurrency, Retry/Timeout, Priority, Progress, Cancel & RBAC Audit)', () => {
  let redis: RedisService;
  let config: CoreConfigService;
  let auditLogService: AuditLogService;
  let progressTracker: JobProgressTrackerService;

  beforeEach(async () => {
    applyTestEnv();
    config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
    auditLogService = new AuditLogService();
    progressTracker = new JobProgressTrackerService(redis, config);
  });

  it('7.3.1 & 7.3.2 & 7.3.5: tách 4 Queue theo loại công việc (critical, notifications, heavy, events) kèm mức ưu tiên chuẩn', async () => {
    expect(Object.values(QUEUES)).toEqual([
      'system.events',
      'system.critical',
      'system.notifications',
      'system.heavy',
    ]);

    expect(priorityLevel(JOB_PRIORITIES.CRITICAL)).toBe('critical');
    expect(priorityLevel(JOB_PRIORITIES.HIGH)).toBe('high');
    expect(priorityLevel(JOB_PRIORITIES.NORMAL)).toBe('normal');
    expect(priorityLevel(JOB_PRIORITIES.LOW)).toBe('low');

    expect(QUEUE_PROFILES[QUEUES.SYSTEM_CRITICAL].defaultPriority).toBe(JOB_PRIORITIES.CRITICAL);
    expect(QUEUE_PROFILES[QUEUES.SYSTEM_NOTIFICATIONS].defaultPriority).toBe(JOB_PRIORITIES.HIGH);
    expect(QUEUE_PROFILES[QUEUES.SYSTEM_EVENTS].defaultPriority).toBe(JOB_PRIORITIES.NORMAL);
    expect(QUEUE_PROFILES[QUEUES.SYSTEM_HEAVY].defaultPriority).toBe(JOB_PRIORITIES.LOW);

    const addedJobs: Array<{ queue: string; topic: string; opts: Record<string, unknown> }> = [];
    const fakeRegistry = {
      names: () => Object.values(QUEUES),
      isKnown: (n: string) => (Object.values(QUEUES) as string[]).includes(n),
      get: (qName: QueueName) => ({
        add: async (topic: string, _env: unknown, opts: Record<string, unknown>) => {
          addedJobs.push({ queue: qName, topic, opts });
        },
      }),
      jobOptions: (jobId: string, qName?: QueueName) => ({
        jobId,
        attempts: qName ? QUEUE_PROFILES[qName].defaultAttempts : 3,
      }),
      withTimeout: <T>(p: Promise<T>) => p,
    } as unknown as QueueRegistry;

    const publisher = new BaseMessagePublisherProvider(fakeRegistry);
    await publisher.publish('auth.otp.send', { code: '123456' }, QUEUES.SYSTEM_CRITICAL);
    await publisher.publish(
      'notifications.dispatch_batch',
      { count: 200 },
      QUEUES.SYSTEM_NOTIFICATIONS,
    );
    await publisher.publish('users.import', { rows: 5000 }, QUEUES.SYSTEM_HEAVY);

    expect(addedJobs).toHaveLength(3);
    expect(addedJobs[0]).toMatchObject({
      queue: 'system.critical',
      topic: 'auth.otp.send',
      opts: { priority: JOB_PRIORITIES.CRITICAL, attempts: 3 },
    });
    expect(addedJobs[1]).toMatchObject({
      queue: 'system.notifications',
      topic: 'notifications.dispatch_batch',
      opts: { priority: JOB_PRIORITIES.HIGH, attempts: 4 },
    });
    expect(addedJobs[2]).toMatchObject({
      queue: 'system.heavy',
      topic: 'users.import',
      opts: { priority: JOB_PRIORITIES.LOW, attempts: 2 },
    });
  });

  it('7.3.3: thiết lập số lượng worker xử lý (concurrency) riêng cho từng Queue theo biến môi trường', () => {
    process.env['WORKER_CRITICAL_CONCURRENCY'] = '16';
    process.env['WORKER_NOTIFICATIONS_CONCURRENCY'] = '12';
    process.env['WORKER_HEAVY_CONCURRENCY'] = '3';
    process.env['WORKER_EVENTS_CONCURRENCY'] = '6';

    const customConfig = new CoreConfigService();
    const metrics = new MetricsRegistryService({ runtime: 'worker' });

    const criticalProcessor = new CriticalProcessor(customConfig, metrics, progressTracker);
    const notificationsProcessor = new NotificationsProcessor(
      customConfig,
      metrics,
      progressTracker,
    );
    const heavyProcessor = new HeavyJobProcessor(customConfig, metrics, progressTracker);
    const systemProcessor = new SystemProcessor(customConfig, metrics, progressTracker);

    expect(criticalProcessor.concurrency).toBe(16);
    expect(notificationsProcessor.concurrency).toBe(12);
    expect(heavyProcessor.concurrency).toBe(3);
    expect(systemProcessor.concurrency).toBe(6);

    delete process.env['WORKER_CRITICAL_CONCURRENCY'];
    delete process.env['WORKER_NOTIFICATIONS_CONCURRENCY'];
    delete process.env['WORKER_HEAVY_CONCURRENCY'];
    delete process.env['WORKER_EVENTS_CONCURRENCY'];
  });

  it('7.3.4: thiết lập retry và thời gian chờ — chặn trần maxAttempts chống retry vô hạn và ngắt job quá giờ (Timeout)', async () => {
    const reg = new QueueRegistry(null as never, config);
    const capped = reg.retentionOptions(QUEUES.SYSTEM_NOTIFICATIONS, {
      attempts: 999_999,
      backoff: 'exponential',
      backoffDelayMs: 2500,
    });
    expect(capped.attempts).toBe(MAX_JOB_ATTEMPTS_CAP);
    expect(capped.backoff).toEqual({ type: 'exponential', delay: 2500 });

    await expect(
      withJobExecutionTimeout(
        () => new Promise((resolve) => setTimeout(resolve, 150)),
        25,
        'users.import',
      ),
    ).rejects.toThrow('Timeout: users.import timed out after 25ms');
  });

  it('7.3.6 & 7.3.8: theo dõi tiến độ job (Import/Export/Media/Batch) qua các phase và lưu trữ danh sách job thất bại', async () => {
    const metrics = new MetricsRegistryService({ runtime: 'worker' });
    const heavyProcessor = new HeavyJobProcessor(config, metrics, progressTracker);

    const progressUpdates: unknown[] = [];
    const logs: string[] = [];
    const fakeHeavyJob = {
      id: 'job-heavy-101',
      name: 'users.import',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: serializeMessage(
        'users.import',
        { operation: 'import', totalItems: 100, chunkSize: 50 },
        { producer: 'api', correlationId: 'corr-import-101' },
      ),
      opts: { attempts: 2 },
      timestamp: Date.now() - 1000,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async (p: unknown) => {
        fakeHeavyJob.progress = p as number;
        progressUpdates.push(p);
      },
      log: async (row: string) => {
        logs.push(row);
      },
    } as unknown as Job;

    const res = await heavyProcessor.process(fakeHeavyJob);
    expect(res).toMatchObject({
      queue: QUEUES.SYSTEM_HEAVY,
      topic: 'users.import',
      processed: 100,
      total: 100,
    });

    const finalProgress = progressOf(fakeHeavyJob.progress);
    expect(finalProgress).toEqual({
      percent: 100,
      processed: 100,
      total: 100,
      remaining: 0,
      step: 'Completed users.import (100 items)',
      phases: [
        { name: 'Validate Input', state: 'done' },
        { name: 'Process Items', state: 'done' },
        { name: 'Finalize Output', state: 'done' },
      ],
    });

    const snapshot = await progressTracker.getProgressSnapshot(
      QUEUES.SYSTEM_HEAVY,
      'job-heavy-101',
    );
    expect(snapshot).toBeDefined();
    expect(snapshot!.percent).toBe(100);

    // Kiểm tra lưu trữ job thất bại vào FailedJobArchive khi gặp lỗi không phục hồi được
    await progressTracker.recordFailedJob({
      id: 'job-fail-500',
      queue: QUEUES.SYSTEM_NOTIFICATIONS,
      type: 'notifications.dispatch_single',
      errorType: 'ValidationError',
      error: 'ValidationError: Invalid recipient address',
      stacktrace: ['Error: Invalid recipient address'],
      attempts: 1,
      maxAttempts: 4,
      dependency: null,
      retryable: false,
      correlationId: 'corr-fail-500',
      producer: 'api',
      failedAt: Date.now(),
    });

    const archive = await progressTracker.listFailedArchive({
      queue: QUEUES.SYSTEM_NOTIFICATIONS,
      errorType: 'ValidationError',
    });
    expect(archive).toHaveLength(1);
    expect(archive[0]).toMatchObject({
      id: 'job-fail-500',
      queue: QUEUES.SYSTEM_NOTIFICATIONS,
      errorType: 'ValidationError',
      retryable: false,
    });
  });

  it('7.3.7: cho phép chạy lại (retry) hoặc hủy hợp tác (cooperative cancel) job đang chạy, có kiểm tra Permission RBAC và ghi AuditLogService', async () => {
    const now = Date.now();
    let jobState: 'active' | 'failed' | 'waiting' = 'active';
    const rawBullJob = {
      id: 'job-active-77',
      name: 'users.export',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: serializeMessage('users.export', { totalItems: 500 }, { producer: 'api' }),
      opts: { attempts: 2, priority: JOB_PRIORITIES.LOW },
      timestamp: now - 5000,
      processedOn: now - 2000,
      attemptsMade: 0,
      attemptsStarted: 1,
      failedReason: '',
      processedBy: 'worker@node-1',
      progress: { percent: 40, processed: 200, total: 500, step: 'Exporting rows', phases: [] },
      getState: async () => jobState,
      retry: async () => {
        jobState = 'waiting';
      },
      remove: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const fakeQueue = {
      name: QUEUES.SYSTEM_HEAVY,
      keys: { delayed: 'delayed' },
      toKey: (id: string) => `bull:heavy:${id}`,
      getJob: async (id: string) => (id === 'job-active-77' ? rawBullJob : undefined),
      getBackend: () => ({
        client: Promise.resolve({
          pipeline: () => ({ exec: async () => [[null, 25_000]] }),
        }),
      }),
    };

    const fakeRegistry = {
      names: () => [QUEUES.SYSTEM_HEAVY],
      isKnown: (q: string) => q === QUEUES.SYSTEM_HEAVY,
      get: () => fakeQueue,
      withTimeout: <T>(p: Promise<T>) => p,
    } as unknown as QueueRegistry;

    const jobProvider = new BullMqJobProvider(fakeRegistry, redis);
    const jobMonitoring = {
      provider: jobProvider,
      usable: () => true,
      get: (id: string, q?: string | null) => jobProvider.get(id, q),
      detail: (id: string, q?: string | null) => jobProvider.detail(id, q),
    } as unknown as JobMonitoringService;

    const jobOps = new JobOperationsService(
      jobMonitoring,
      config,
      redis,
      progressTracker,
      auditLogService,
    );

    // 1. Người dùng thiếu quyền `jobs.cancel` → bị chặn 403 ForbiddenAppException
    await expect(
      jobOps.cancel(QUEUES.SYSTEM_HEAVY, 'job-active-77', 'User requested stop', {
        ip: '10.0.0.x',
        actor: 'viewer@system.local',
        userId: 15,
        permissions: ['jobs.view'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenAppException);

    // 2. Người dùng có quyền `jobs.cancel` → gửi tín hiệu hủy hợp tác (cooperative) thành công và ghi AuditLog
    const cancelRes = await jobOps.cancel(
      QUEUES.SYSTEM_HEAVY,
      'job-active-77',
      'Stop heavy export',
      {
        ip: '10.0.0.x',
        actor: 'admin@system.local',
        userId: 1,
        permissions: ['jobs.cancel'],
      },
    );
    expect(cancelRes).toMatchObject({
      mode: 'cooperative',
      delivered: true,
      instance: 'worker@node-1',
    });

    // Khi Worker đang chạy bước tiếp theo, `updateProgress` phát hiện tín hiệu hủy và ném lỗi JobCancelled không retry
    const metrics = new MetricsRegistryService({ runtime: 'worker' });
    const heavyProcessor = new HeavyJobProcessor(config, metrics, progressTracker);
    await expect(
      heavyProcessor.process({
        ...rawBullJob,
        updateProgress: async () => undefined,
      } as unknown as Job),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    // Kiểm tra bản ghi AuditLog đã được lưu vào AuditLogService
    const audits = await auditLogService.listPaginated({ module: 'jobs-ops' });
    expect(audits.data.length).toBeGreaterThanOrEqual(1);
    expect(audits.data[0]).toMatchObject({
      module: 'jobs-ops',
      action: 'JOB_CANCEL',
      actorUserId: 1,
      reason: 'Stop heavy export',
    });

    // 3. Kiểm tra RBAC trên QueueOperationsService
    const queueOps = new QueueOperationsService(
      {
        provider: {} as never,
        supports: () => true,
        usable: () => true,
        invalidate: () => undefined,
      } as unknown as QueueMonitoringService,
      config,
      redis,
      undefined,
      auditLogService,
    );
    await expect(
      queueOps.pause(QUEUES.SYSTEM_HEAVY, {
        ip: '10.0.0.x',
        actor: 'viewer@system.local',
        userId: 15,
        permissions: ['queues.view'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenAppException);

    // Kiểm tra trạng thái job sau khi bị hủy hợp tác
    const cancelledRecord = toJobRecord(
      {
        ...rawBullJob,
        failedReason: 'JobCancelled: Stop heavy export',
        finishedOn: now,
        attemptsMade: 1,
      } as unknown as Job,
      'failed',
      { now },
    );
    expect(cancelledRecord.status).toBe('cancelled');
    expect(cancelledRecord.cancelReason).toBe('Stop heavy export');
  });

  it('7.3.1 & 7.3.8 (Thực thi thật): UserImportService đẩy job vào system.heavy và HeavyJobProcessor / NotificationsProcessor / CriticalProcessor thực thi nghiệp vụ thật', async () => {
    const metrics = new MetricsRegistryService({ runtime: 'worker' });
    const publishedEnvelopes: Array<{
      queue: string;
      topic: string;
      payload: unknown;
      opts: Record<string, unknown>;
    }> = [];

    const fakeRegistry = {
      names: () => Object.values(QUEUES),
      isKnown: (n: string) => (Object.values(QUEUES) as string[]).includes(n),
      get: (qName: QueueName) => ({
        add: async (topic: string, env: unknown, opts: Record<string, unknown>) => {
          publishedEnvelopes.push({
            queue: qName,
            topic,
            payload: (env as { payload: unknown }).payload,
            opts,
          });
        },
      }),
      jobOptions: (jobId: string, qName?: QueueName) => ({
        jobId,
        attempts: qName ? QUEUE_PROFILES[qName].defaultAttempts : 3,
      }),
      withTimeout: <T>(p: Promise<T>) => p,
    } as unknown as QueueRegistry;

    const publisher = new BaseMessagePublisherProvider(fakeRegistry);

    // 1. UserImportService đẩy job thật vào system.heavy và HeavyJobProcessor gọi thật UserImportService theo từng chunk
    let createdCount = 0;
    const fakeUsersService = {
      create: async (input: { username: string; email: string }) => {
        createdCount++;
        return { id: createdCount, username: input.username, email: input.email };
      },
    } as unknown as UsersService;
    const fakeUserRepo = {
      findByEmail: async () => null,
      findByUsername: async () => null,
    };
    const fakeRolesPublic = {
      findByCodes: async () => [],
    };

    const userImportService = new UserImportService(
      fakeUsersService,
      fakeUserRepo as never,
      fakeRolesPublic as never,
      null,
      undefined,
      publisher,
    );

    const enqueued = await userImportService.enqueueBulkImport(
      {
        items: [
          {
            username: 'worker_u1',
            email: 'worker_u1@example.com',
            fullName: 'Worker One',
            status: 1,
            roleCodes: [],
            organizationCodes: [],
          },
          {
            username: 'worker_u2',
            email: 'worker_u2@example.com',
            fullName: 'Worker Two',
            status: 1,
            roleCodes: [],
            organizationCodes: [],
          },
        ],
        skipDuplicates: true,
      },
      1,
    );
    expect(enqueued).not.toBeNull();
    expect(publishedEnvelopes).toHaveLength(1);
    expect(publishedEnvelopes[0]).toMatchObject({
      queue: QUEUES.SYSTEM_HEAVY,
      topic: 'users.import',
      opts: { priority: JOB_PRIORITIES.LOW },
    });

    let verifiedFileId: number | null = null;
    const fakeFilesService = {
      verifyFileIntegrity: async (fileId: number) => {
        verifiedFileId = fileId;
        return { fileId, intact: true };
      },
      purgeExpiredTrash: async () => ({ purgedCount: 3, purgedIds: [10, 11, 12] }),
    } as unknown as FilesService;

    const heavyProcessor = new HeavyJobProcessor(
      config,
      metrics,
      progressTracker,
      userImportService,
      fakeFilesService,
    );

    const importJob = {
      id: enqueued!.id,
      name: 'users.import',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: enqueued,
      opts: { attempts: 2 },
      timestamp: Date.now() - 500,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async (p: unknown) => {
        importJob.progress = p as number;
      },
      log: async () => undefined,
    } as unknown as Job;

    const importRes = await heavyProcessor.process(importJob);
    expect(createdCount).toBe(2);
    expect(importRes).toMatchObject({
      queue: QUEUES.SYSTEM_HEAVY,
      topic: 'users.import',
      processed: 2,
      total: 2,
      importedCount: 2,
      skippedCount: 0,
      failedCount: 0,
    });

    // 2. HeavyJobProcessor xử lý thật kiểm tra file/ảnh (files.media_process)
    const mediaJob = {
      id: 'job-media-202',
      name: 'files.media_process',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: serializeMessage('files.media_process', {
        operation: 'media_process',
        fileId: 88,
        totalItems: 1,
      }),
      opts: { attempts: 2 },
      timestamp: Date.now() - 200,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const mediaRes = await heavyProcessor.process(mediaJob);
    expect(verifiedFileId).toBe(88);
    expect(mediaRes).toMatchObject({
      queue: QUEUES.SYSTEM_HEAVY,
      topic: 'files.media_process',
      integrityIntact: true,
    });

    // 3. NotificationsProcessor gọi thật Adapter gửi Email/SMS và xử lý lỗi Permanent (UnrecoverableError)
    const notificationsProcessor = new NotificationsProcessor(config, metrics, progressTracker);
    const notifJob = {
      id: 'job-notif-303',
      name: 'notifications.dispatch_batch',
      queueName: QUEUES.SYSTEM_NOTIFICATIONS,
      data: serializeMessage('notifications.dispatch_batch', {
        channel: 'EMAIL',
        templateCode: 'WELCOME_USER',
        recipients: [
          { userId: 1, recipientAddress: 'u1@example.com' },
          { userId: 2, recipientAddress: 'u2@example.com' },
        ],
        batchSize: 1,
      }),
      opts: { attempts: 4 },
      timestamp: Date.now() - 200,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const notifRes = (await notificationsProcessor.process(notifJob)) as {
      deliveredCount: number;
      failedCount: number;
      providerMessageIds: string[];
    };
    expect(notifRes.deliveredCount).toBe(2);
    expect(notifRes.failedCount).toBe(0);
    expect(notifRes.providerMessageIds).toHaveLength(2);

    // 4. CriticalProcessor gửi OTP khẩn cấp thật qua Adapter
    const criticalProcessor = new CriticalProcessor(config, metrics, progressTracker);
    const criticalJob = {
      id: 'job-crit-404',
      name: 'auth.otp.send',
      queueName: QUEUES.SYSTEM_CRITICAL,
      data: serializeMessage('auth.otp.send', {
        channel: 'SMS',
        destination: '+84901234567',
        code: '654321',
      }),
      opts: { attempts: 3 },
      timestamp: Date.now() - 100,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const critRes = (await criticalProcessor.process(criticalJob)) as {
      deliveredCount: number;
      providerMessageId: string | null;
    };
    expect(critRes.deliveredCount).toBe(1);
    expect(critRes.providerMessageId).toContain('sms-');

    // 5. DefaultEmailNotificationAdapter đẩy job OTP / Password Reset vào system.critical với priority CRITICAL
    const authEmailAdapter = new DefaultEmailNotificationAdapter(publisher);
    await authEmailAdapter.sendOtpEmail({
      userId: 99,
      email: 'security@example.com',
      otpCode: '112233',
      expiresInSeconds: 300,
      purpose: 'PASSWORD_RESET',
    });
    expect(publishedEnvelopes).toHaveLength(2);
    expect(publishedEnvelopes[1]).toMatchObject({
      queue: QUEUES.SYSTEM_CRITICAL,
      topic: 'auth.password_reset.send',
      opts: { priority: JOB_PRIORITIES.CRITICAL },
    });

    // 6. SystemProcessor khi nhận system.maintenance.tick gọi thật purgeExpiredTrash, retryDueDeliveries, dọn file Export/Report hết hạn (8.3.8/8.4.6) và tự động kích hoạt Lịch gửi báo cáo đến hạn (8.4.5)
    const fakeNotificationChannelsService = {
      retryDueDeliveries: async () => ({ retriedCount: 4 }),
    } as unknown as NotificationChannelsService;
    const maintExportRegistry = new ExportRegistryService();
    const maintReportRegistry = new ReportRegistryService(maintExportRegistry);

    maintExportRegistry.storeTemporaryArtifact({
      profileCode: 'users',
      module: 'users',
      fileName: 'expired_export.csv',
      format: 'csv',
      totalExported: 10,
      buffer: Buffer.from('id,name\n1,A', 'utf8'),
      ttlSeconds: 60,
      now: new Date(Date.now() - 120_000),
    });

    maintReportRegistry.registerReport({
      code: 'users.daily_summary',
      module: 'users',
      name: 'Báo cáo nhân sự định kỳ',
      requiredPermission: 'users.report',
    });
    maintReportRegistry.registerWorkerExecutor({
      module: 'users',
      topic: 'users.report',
      reportCodes: ['users.daily_summary'],
      executeReport: async (input) => ({
        reportCode: input.reportCode,
        historyId: 701,
        totalRecords: 12,
        dataSourceUsed: 'REPLICA',
        cacheHit: false,
        downloadToken: 'sched_rep_701',
        downloadUrl: '/api/v1/reports/downloads/sched_rep_701',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        notifiedChannels: ['EMAIL', 'IN_APP'],
      }),
    });
    const createdSchedule = maintReportRegistry.createSchedule({
      reportCode: 'users.daily_summary',
      module: 'users',
      name: 'Lịch gửi báo cáo nhân sự 08:00 hàng ngày',
      frequency: 'DAILY',
      hour: 8,
      minute: 0,
      format: 'xlsx',
      channels: ['EMAIL', 'IN_APP'],
      recipientEmails: ['director@core.vn'],
      recipientUserIds: [1],
      isActive: true,
    });

    const systemProcessor = new SystemProcessor(
      config,
      metrics,
      progressTracker,
      fakeFilesService,
      fakeNotificationChannelsService,
      maintExportRegistry,
      maintReportRegistry,
    );
    const futureTickNow = new Date(Date.parse(createdSchedule.nextRunAt) + 60_000).toISOString();
    const maintenanceJob = {
      id: 'job-maint-505',
      name: 'system.maintenance.tick',
      queueName: QUEUES.SYSTEM_EVENTS,
      data: serializeMessage('system.maintenance.tick', {
        triggeredBy: 'scheduler',
        now: futureTickNow,
      }),
      opts: { attempts: 3 },
      timestamp: Date.now() - 100,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const maintRes = await systemProcessor.process(maintenanceJob);
    expect(maintRes).toMatchObject({
      handled: true,
      topic: 'system.maintenance.tick',
      purgedTrashCount: 3,
      retriedDeliveriesCount: 4,
      purgedExportArtifactsCount: 1,
      triggeredReportSchedulesCount: 1,
    });
    expect(
      (maintRes as { triggeredReportSchedules: Array<{ scheduleId: number; downloadUrl: string }> })
        .triggeredReportSchedules[0],
    ).toMatchObject({
      scheduleId: createdSchedule.id,
      reportCode: 'users.daily_summary',
      historyId: 701,
      downloadUrl: '/api/v1/reports/downloads/sched_rep_701',
    });

    // 7. HeavyJobProcessor chạy Export lớn (users.export) thực sự trong Worker, lưu file tạm và trả về downloadUrl (Mục 8.3.4 & 8.3.5)
    const fakeUserExportService = {
      exportUsersCsv: async () => ({
        fileName: 'danh_sach_nhan_vien_2026-10-26.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        format: 'xlsx' as const,
        totalExported: 250,
        csvContent: '',
        xlsxBase64: 'UEsDBBQAAAAIA===',
        historyId: 77,
        jobId: 'job-heavy-export-707',
        status: 'COMPLETED' as const,
        downloadToken: 'exp_tok_707',
        downloadUrl: '/api/v1/exports/downloads/exp_tok_707',
        expiresAt: '2026-10-26T15:00:00.000Z',
        notifiedAt: '2026-10-26T14:00:00.000Z',
      }),
    };

    const heavyExportProcessor = new HeavyJobProcessor(
      config,
      metrics,
      progressTracker,
      userImportService,
      fakeFilesService,
      fakeUserExportService as never,
    );

    const heavyExportJob = {
      id: 'job-heavy-export-707',
      name: 'users.export',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: serializeMessage('users.export', {
        operation: 'export',
        executeInWorker: true,
        format: 'xlsx',
        historyId: 77,
        actorId: 1,
        notifyOnComplete: true,
      }),
      opts: { attempts: 2 },
      timestamp: Date.now() - 100,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const exportJobRes = await heavyExportProcessor.process(heavyExportJob);
    expect(exportJobRes).toMatchObject({
      queue: QUEUES.SYSTEM_HEAVY,
      topic: 'users.export',
      operation: 'export',
      processed: 250,
      total: 250,
      fileName: 'danh_sach_nhan_vien_2026-10-26.xlsx',
      format: 'xlsx',
      totalExported: 250,
      historyId: 77,
      downloadToken: 'exp_tok_707',
      downloadUrl: '/api/v1/exports/downloads/exp_tok_707',
    });

    // 8. HeavyJobProcessor chạy Báo cáo nặng (users.report) thực sự trong Worker, lưu file tạm và trả về downloadUrl (Mục 8.4.4 & 8.4.6)
    const fakeUserReportService = {
      runReport: async () => ({
        reportCode: 'users.security_compliance',
        reportName: 'Báo cáo tuân thủ bảo mật & phiên đăng nhập nhân sự',
        module: 'users',
        category: 'REPORT' as const,
        requiredPermission: 'users.report',
        historyId: 99,
        jobId: 'job-heavy-report-808',
        status: 'COMPLETED' as const,
        executionMode: 'QUEUE' as const,
        dataSourceUsed: 'REPLICA' as const,
        cacheHit: false,
        cacheKey: 'rep_cache_808',
        parameters: {
          fromDate: null,
          toDate: null,
          statuses: [],
          organizationUnitId: 10,
          includeSubUnits: false,
          filters: {},
        },
        totalRecords: 180,
        summary: { totalUsers: 180, compliantCount: 150 },
        rows: [],
        format: 'xlsx' as const,
        fileName: 'bao_cao_users_security_compliance_2026-10-26.xlsx',
        downloadToken: 'rep_tok_808',
        downloadUrl: '/api/v1/reports/downloads/rep_tok_808',
        expiresAt: '2026-10-26T16:00:00.000Z',
        notifiedChannels: ['EMAIL', 'IN_APP'] as const,
        startedAt: '2026-10-26T15:00:00.000Z',
        completedAt: '2026-10-26T15:00:02.000Z',
        durationMs: 2000,
      }),
    };

    const heavyReportProcessor = new HeavyJobProcessor(
      config,
      metrics,
      progressTracker,
      userImportService,
      fakeFilesService,
      fakeUserExportService as never,
      fakeUserReportService as never,
    );

    const heavyReportJob = {
      id: 'job-heavy-report-808',
      name: 'users.report',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: serializeMessage('users.report', {
        operation: 'report',
        executeInWorker: true,
        reportCode: 'users.security_compliance',
        format: 'xlsx',
        historyId: 99,
        actorId: 1,
      }),
      opts: { attempts: 2 },
      timestamp: Date.now() - 100,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const reportJobRes = await heavyReportProcessor.process(heavyReportJob);
    expect(reportJobRes).toMatchObject({
      queue: QUEUES.SYSTEM_HEAVY,
      topic: 'users.report',
      operation: 'report',
      processed: 180,
      total: 180,
      reportCode: 'users.security_compliance',
      historyId: 99,
      totalRecords: 180,
      dataSourceUsed: 'REPLICA',
      downloadToken: 'rep_tok_808',
      downloadUrl: '/api/v1/reports/downloads/rep_tok_808',
    });

    // 9. HeavyJobProcessor chạy đồng bộ & tạo lại Search Index (users.search_sync & users.search_rebuild — Mục 8.5.4 & 8.5.5)
    const fakeUserSearchService = {
      syncUsersToSearchIndex: async () => ({
        id: 105,
        operation: 'SYNC' as const,
        module: 'users',
        entityType: 'user',
        entityCode: 'users.account',
        driverUsed: 'DATABASE' as const,
        executionMode: 'QUEUE' as const,
        status: 'COMPLETED' as const,
        indexedCount: 320,
        removedCount: 0,
        jobId: 'job-heavy-search-sync-909',
        actorId: 1,
        errorMessage: null,
        startedAt: '2026-10-26T15:10:00.000Z',
        completedAt: '2026-10-26T15:10:01.000Z',
      }),
      rebuildSearchIndex: async () => ({
        id: 106,
        operation: 'REBUILD' as const,
        module: 'users',
        entityType: 'user',
        entityCode: 'users.account',
        driverUsed: 'OPENSEARCH' as const,
        executionMode: 'QUEUE' as const,
        status: 'COMPLETED' as const,
        indexedCount: 500,
        removedCount: 480,
        jobId: 'job-heavy-search-rebuild-910',
        actorId: 1,
        errorMessage: null,
        startedAt: '2026-10-26T15:12:00.000Z',
        completedAt: '2026-10-26T15:12:03.000Z',
      }),
    };

    const heavySearchProcessor = new HeavyJobProcessor(
      config,
      metrics,
      progressTracker,
      userImportService,
      fakeFilesService,
      fakeUserExportService as never,
      fakeUserReportService as never,
      fakeUserSearchService as never,
    );

    const heavySearchSyncJob = {
      id: 'job-heavy-search-sync-909',
      name: 'users.search_sync',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: serializeMessage('users.search_sync', {
        operation: 'search_sync',
        executeInWorker: true,
        historyId: 105,
        actorId: 1,
        userIds: [1, 2, 3],
      }),
      opts: { attempts: 2 },
      timestamp: Date.now() - 100,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const searchSyncRes = await heavySearchProcessor.process(heavySearchSyncJob);
    expect(searchSyncRes).toMatchObject({
      queue: QUEUES.SYSTEM_HEAVY,
      topic: 'users.search_sync',
      operation: 'search_sync',
      processed: 320,
      total: 320,
      historyId: 105,
      driverUsed: 'DATABASE',
      indexedCount: 320,
    });

    const heavySearchRebuildJob = {
      id: 'job-heavy-search-rebuild-910',
      name: 'users.search_rebuild',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: serializeMessage('users.search_rebuild', {
        operation: 'search_rebuild',
        executeInWorker: true,
        historyId: 106,
        actorId: 1,
        module: 'users',
        entityType: 'user',
      }),
      opts: { attempts: 2 },
      timestamp: Date.now() - 100,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const searchRebuildRes = await heavySearchProcessor.process(heavySearchRebuildJob);
    expect(searchRebuildRes).toMatchObject({
      queue: QUEUES.SYSTEM_HEAVY,
      topic: 'users.search_rebuild',
      operation: 'search_rebuild',
      processed: 500,
      total: 500,
      historyId: 106,
      driverUsed: 'OPENSEARCH',
      indexedCount: 500,
      removedCount: 480,
    });

    // 10. HeavyJobProcessor điều phối động qua Registry cho bất kỳ module nào (vd: organizations.import / export / report / search_sync) không cần hardcode service
    const customImportRegistry = new ImportRegistryService();
    const customExportRegistry = new ExportRegistryService();
    const customReportRegistry = new ReportRegistryService(customExportRegistry);
    const customSearchRegistry = new SearchRegistryService();

    customImportRegistry.registerWorkerExecutor({
      profileCode: 'organizations',
      module: 'organizations',
      topic: 'organizations.import',
      parseImportRows: (input) => input.items ?? [],
      executeChunkImport: async (input) => ({
        importedCount: (input.items ?? []).length,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        errors: [],
      }),
    });

    customExportRegistry.registerWorkerExecutor({
      profileCode: 'organizations',
      module: 'organizations',
      topic: 'organizations.export',
      executeExport: async (input) => ({
        fileName: 'danh_sach_don_vi.xlsx',
        format: (input.format as 'xlsx') ?? 'xlsx',
        totalExported: 45,
        historyId: input.historyId ?? 301,
        downloadToken: 'org_exp_301',
        downloadUrl: '/api/v1/organizations/export/downloads/org_exp_301',
        expiresAt: '2026-10-26T18:00:00.000Z',
        notifiedAt: '2026-10-26T17:00:00.000Z',
      }),
    });

    customReportRegistry.registerWorkerExecutor({
      module: 'organizations',
      topic: 'organizations.report',
      reportCodes: ['organizations.structure_summary'],
      executeReport: async (input) => ({
        reportCode: input.reportCode,
        historyId: input.historyId ?? 401,
        totalRecords: 45,
        dataSourceUsed: 'REPLICA',
        cacheHit: false,
        downloadToken: 'org_rep_401',
        downloadUrl: '/api/v1/organizations/reports/downloads/org_rep_401',
        expiresAt: '2026-10-26T18:00:00.000Z',
        notifiedChannels: ['IN_APP'],
      }),
    });

    customSearchRegistry.registerWorkerExecutor({
      module: 'organizations',
      entityCode: 'organizations.unit',
      syncTopic: 'organizations.search_sync',
      rebuildTopic: 'organizations.search_rebuild',
      executeSearchJob: async (input) => ({
        id: input.historyId ?? 501,
        operation: input.operation === 'search_rebuild' ? 'REBUILD' : 'SYNC',
        module: 'organizations',
        entityType: 'unit',
        entityCode: 'organizations.unit',
        driverUsed: 'DATABASE',
        executionMode: 'QUEUE',
        status: 'COMPLETED',
        indexedCount: 45,
        removedCount: 0,
        jobId: input.jobId,
        actorId: input.actorId ?? null,
        errorMessage: null,
        startedAt: '2026-10-26T17:00:00.000Z',
        completedAt: '2026-10-26T17:00:01.000Z',
      }),
    });

    // Khởi tạo HeavyJobProcessor KHÔNG tiêm bất kỳ User*Service nào, chỉ dùng 4 Registry động
    const dynamicHeavyProcessor = new HeavyJobProcessor(
      config,
      metrics,
      progressTracker,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      customImportRegistry,
      customExportRegistry,
      customReportRegistry,
      customSearchRegistry,
    );

    const orgImportJob = {
      id: 'job-org-import-1',
      name: 'organizations.import',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: serializeMessage('organizations.import', {
        operation: 'import',
        module: 'organizations',
        profileCode: 'organizations',
        items: [{ code: 'OU_01' }, { code: 'OU_02' }, { code: 'OU_03' }],
      }),
      opts: { attempts: 2 },
      timestamp: Date.now() - 100,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const orgImportRes = await dynamicHeavyProcessor.process(orgImportJob);
    expect(orgImportRes).toMatchObject({
      topic: 'organizations.import',
      processed: 3,
      total: 3,
      importedCount: 3,
    });

    const orgExportJob = {
      id: 'job-org-export-1',
      name: 'organizations.export',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: serializeMessage('organizations.export', {
        operation: 'export',
        executeInWorker: true,
        module: 'organizations',
        format: 'xlsx',
        historyId: 301,
      }),
      opts: { attempts: 2 },
      timestamp: Date.now() - 100,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const orgExportRes = await dynamicHeavyProcessor.process(orgExportJob);
    expect(orgExportRes).toMatchObject({
      topic: 'organizations.export',
      totalExported: 45,
      downloadToken: 'org_exp_301',
    });

    const orgReportJob = {
      id: 'job-org-report-1',
      name: 'organizations.report',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: serializeMessage('organizations.report', {
        operation: 'report',
        executeInWorker: true,
        module: 'organizations',
        reportCode: 'organizations.structure_summary',
        historyId: 401,
      }),
      opts: { attempts: 2 },
      timestamp: Date.now() - 100,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const orgReportRes = await dynamicHeavyProcessor.process(orgReportJob);
    expect(orgReportRes).toMatchObject({
      topic: 'organizations.report',
      reportCode: 'organizations.structure_summary',
      totalRecords: 45,
      downloadToken: 'org_rep_401',
    });

    const orgSearchJob = {
      id: 'job-org-search-1',
      name: 'organizations.search_sync',
      queueName: QUEUES.SYSTEM_HEAVY,
      data: serializeMessage('organizations.search_sync', {
        operation: 'search_sync',
        executeInWorker: true,
        module: 'organizations',
        entityCode: 'organizations.unit',
        historyId: 501,
      }),
      opts: { attempts: 2 },
      timestamp: Date.now() - 100,
      attemptsMade: 0,
      attemptsStarted: 1,
      progress: 0,
      updateProgress: async () => undefined,
      log: async () => undefined,
    } as unknown as Job;

    const orgSearchRes = await dynamicHeavyProcessor.process(orgSearchJob);
    expect(orgSearchRes).toMatchObject({
      topic: 'organizations.search_sync',
      indexedCount: 45,
      historyId: 501,
    });
  });
});
