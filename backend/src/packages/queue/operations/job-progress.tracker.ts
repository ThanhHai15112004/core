import { Injectable, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { safeJsonParse } from '@packages/kernel/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  JOB_CANCELLED,
  JobError,
  logLifecycle,
  type JobDependency,
} from '@packages/messaging/index.js';
import {
  CANCEL_SIGNAL_TTL_SEC,
  FAILED_JOB_ARCHIVE_SIZE,
  PROGRESS_SNAPSHOT_TTL_SEC,
  queueKeys,
} from '../constants/queue.keys.js';
import type { JobProgressInfo } from '../contracts/job.types.js';
import { progressOf } from '../providers/bullmq-job.provider.js';

export interface JobCancelSignal {
  readonly queue: string;
  readonly jobId: string;
  readonly reason: string | null;
  readonly actor: string | null;
  readonly requestedAt: number;
}

export interface JobProgressUpdateInput {
  readonly percent?: number | null;
  readonly processed?: number | null;
  readonly total?: number | null;
  readonly step?: string | null;
  readonly phases?: JobProgressInfo['phases'];
  readonly activePhase?: string;
  readonly completedPhases?: readonly string[];
  readonly failedPhase?: string;
}

export interface FailedJobArchiveEntry {
  readonly id: string;
  readonly queue: string;
  readonly type: string;
  readonly errorType: string;
  readonly error: string;
  readonly stacktrace: string[];
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly dependency: JobDependency | null;
  readonly retryable: boolean | null;
  readonly correlationId: string | null;
  readonly producer: string | null;
  readonly failedAt: number;
}

/**
 * Dịch vụ theo dõi tiến độ công việc nền (Import, Export, Xử lý Media/File, Gửi thông báo lô),
 * điều phối huỷ hợp tác (Cooperative Cancellation) cho job đang chạy và lưu trữ danh sách job thất bại.
 */
@Injectable()
export class JobProgressTrackerService {
  constructor(
    private readonly redis: RedisService,
    @Optional() private readonly config?: CoreConfigService,
  ) {}

  /** Khởi tạo cấu trúc các pha (phases) của một job nhiều bước */
  public async initPhases(
    job: Pick<Job, 'id' | 'queueName' | 'updateProgress' | 'progress' | 'log'>,
    phaseNames: readonly string[],
    total: number | null = null,
  ): Promise<JobProgressInfo> {
    const phases: JobProgressInfo['phases'] = phaseNames.map((name, index) => ({
      name: name.slice(0, 80),
      state: index === 0 ? 'active' : 'pending',
    }));
    return this.updateProgress(job, {
      percent: 0,
      processed: 0,
      total,
      step: phaseNames[0] ?? null,
      phases,
    });
  }

  /**
   * Cập nhật tiến độ của job đang chạy (percent, processed/total, step, phases)
   * và tự động kiểm tra tín hiệu huỷ hợp tác để dừng ngay nếu có lệnh huỷ.
   */
  public async updateProgress(
    job: Pick<Job, 'id' | 'queueName' | 'updateProgress' | 'progress' | 'log'>,
    input: JobProgressUpdateInput,
  ): Promise<JobProgressInfo> {
    const jobId = String(job.id ?? '');
    const queue = job.queueName;

    await this.assertNotCancelled(queue, jobId, job);

    const current = progressOf(job.progress);
    const processed =
      input.processed !== undefined ? input.processed : (current?.processed ?? null);
    const total = input.total !== undefined ? input.total : (current?.total ?? null);

    let percent = input.percent !== undefined ? input.percent : (current?.percent ?? null);
    if (input.percent === undefined && processed !== null && total !== null && total > 0) {
      percent = Math.min(100, Math.max(0, Math.round((processed / total) * 100)));
    } else if (percent !== null) {
      percent = Math.min(100, Math.max(0, Math.round(percent)));
    }

    const basePhases = input.phases ?? current?.phases ?? [];
    const completedSet = new Set(input.completedPhases ?? []);
    const phases: JobProgressInfo['phases'] = basePhases.map((p) => {
      if (input.failedPhase && p.name === input.failedPhase) {
        return { name: p.name, state: 'failed' };
      }
      if (completedSet.has(p.name)) {
        return { name: p.name, state: 'done' };
      }
      if (input.activePhase && p.name === input.activePhase) {
        return { name: p.name, state: 'active' };
      }
      return p;
    });

    const nextProgress: JobProgressInfo = {
      percent,
      processed,
      total,
      step:
        input.step !== undefined
          ? input.step
            ? input.step.slice(0, 120)
            : null
          : (current?.step ?? null),
      phases,
    };

    await Promise.resolve(job.updateProgress(nextProgress)).catch(() => undefined);

    if (jobId) {
      const key = queueKeys(this.redis).progressSnapshot(queue, jobId);
      await this.redis.client
        .set(
          key,
          JSON.stringify({ ...nextProgress, updatedAt: Date.now() }),
          'EX',
          PROGRESS_SNAPSHOT_TTL_SEC,
        )
        .catch(() => undefined);
    }

    return nextProgress;
  }

  /** Đọc snapshot tiến độ gần nhất của job từ Redis */
  public async getProgressSnapshot(
    queue: string,
    jobId: string,
  ): Promise<(JobProgressInfo & { updatedAt: number }) | null> {
    const raw = await this.redis.client
      .get(queueKeys(this.redis).progressSnapshot(queue, jobId))
      .catch(() => null);
    return safeJsonParse<(JobProgressInfo & { updatedAt: number }) | null>(raw, null);
  }

  /** Phát tín hiệu yêu cầu huỷ hợp tác (Cooperative Cancellation) tới job đang chạy */
  public async requestCancel(
    queue: string,
    jobId: string,
    opts: { reason?: string | null; actor?: string | null } = {},
  ): Promise<JobCancelSignal> {
    const signal: JobCancelSignal = {
      queue,
      jobId,
      reason: opts.reason?.trim() || null,
      actor: opts.actor ?? null,
      requestedAt: Date.now(),
    };
    const key = queueKeys(this.redis).cancelSignal(queue, jobId);
    await this.redis.client.set(key, JSON.stringify(signal), 'EX', CANCEL_SIGNAL_TTL_SEC);
    return signal;
  }

  /** Đọc tín hiệu huỷ hợp tác của một job (nếu có) */
  public async getCancelSignal(queue: string, jobId: string): Promise<JobCancelSignal | null> {
    const raw = await this.redis.client
      .get(queueKeys(this.redis).cancelSignal(queue, jobId))
      .catch(() => null);
    return safeJsonParse<JobCancelSignal | null>(raw, null);
  }

  /**
   * Kiểm tra xem job có đang bị yêu cầu huỷ hay không; nếu có thì ghi lifecycle `cancelled`
   * và ném lỗi `JobCancelled` không retry để kết thúc job ngay lập tức.
   */
  public async assertNotCancelled(
    queue: string,
    jobId: string,
    job?: Pick<Job, 'log'>,
  ): Promise<void> {
    if (!jobId) return;
    const signal = await this.getCancelSignal(queue, jobId);
    if (!signal) return;
    const reason = signal.reason ?? 'Cancelled by operator';
    if (job) {
      logLifecycle(job, 'cancelled', {
        actor: signal.actor,
        error: reason,
        errorType: JOB_CANCELLED,
        retryable: false,
      });
    }
    throw new JobError(JOB_CANCELLED, reason, { retryable: false });
  }

  /** Lưu trữ thông tin chi tiết của job thất bại cuối cùng vào Failed Archive bền vững */
  public async recordFailedJob(entry: FailedJobArchiveEntry): Promise<void> {
    const key = queueKeys(this.redis).failedArchive();
    const maxLen = this.config?.jobs?.failedArchiveMax ?? FAILED_JOB_ARCHIVE_SIZE;
    await this.redis.client
      .multi()
      .lpush(key, JSON.stringify(entry))
      .ltrim(key, 0, Math.max(1, maxLen) - 1)
      .exec()
      .catch(() => undefined);
  }

  /** Truy vấn danh sách các job thất bại đã lưu trữ kèm bộ lọc theo queue và loại lỗi */
  public async listFailedArchive(
    options: { queue?: string | null; errorType?: string | null; limit?: number } = {},
  ): Promise<FailedJobArchiveEntry[]> {
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    const rows = await this.redis.client
      .lrange(queueKeys(this.redis).failedArchive(), 0, FAILED_JOB_ARCHIVE_SIZE - 1)
      .catch(() => [] as string[]);
    const result: FailedJobArchiveEntry[] = [];
    for (const row of rows) {
      const parsed = safeJsonParse<FailedJobArchiveEntry | null>(row, null);
      if (!parsed) continue;
      if (options.queue && parsed.queue !== options.queue) continue;
      if (options.errorType && parsed.errorType !== options.errorType) continue;
      result.push(parsed);
      if (result.length >= limit) break;
    }
    return result;
  }
}

/**
 * Thực thi hàm xử lý job với giới hạn thời gian chờ (Timeout) nghiêm ngặt.
 * Quá thời gian `timeoutMs` sẽ ném `JobError('Timeout', ...)` để BullMQ xử lý retry có giới hạn.
 */
export async function withJobExecutionTimeout<T>(
  task: () => Promise<T>,
  timeoutMs: number,
  label = 'Job execution',
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return task();
  }
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new JobError('Timeout', `${label} timed out after ${timeoutMs}ms`, {
          retryable: true,
        }),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([task(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
