import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { HEALTHCHECK_PREFIX } from '../constants/storage.keys.js';
import type {
  StorageEventType,
  StorageOperationAction,
  StorageOperationRecord,
} from '../contracts/storage-events.types.js';
import type { ObjectStream } from '../drivers/storage-driver.js';
import { S3StorageDriver } from '../drivers/s3-storage.driver.js';
import { BaseStorageProvider } from '../providers/storage.provider.js';
import { StorageConnectionService } from '../providers/storage-connection.service.js';
import { StorageMonitoringService } from '../monitoring/storage-monitoring.service.js';
import type { ObjectDetail } from '../monitoring/monitoring.types.js';
import { isTextual, isValidKey, kindOf } from '../utils/object-kind.js';
import { recordStorageEvent, recordStorageOperation } from '../utils/storage-events.js';
import { storageErrorCode } from '../utils/storage-errors.js';

export type StorageOperationErrorCode =
  | 'DELETE_DISABLED'
  | 'DOWNLOAD_DISABLED'
  | 'SIGNED_URL_DISABLED'
  | 'PREVIEW_DISABLED'
  | 'ABORT_DISABLED'
  | 'UNSUPPORTED'
  | 'UNAVAILABLE'
  | 'NOT_FOUND'
  | 'INVALID_KEY'
  | 'RETENTION'
  | 'SENSITIVE'
  | 'TOO_LARGE'
  | 'INVALID_TTL'
  | 'FAILED';

export class StorageOperationError extends Error {
  constructor(
    public readonly code: StorageOperationErrorCode,
    message: string = code,
    public readonly params: Record<string, string | number> = {},
  ) {
    super(message);
  }
}

export interface OperationContext {
  ip: string | null;
  actor: string | null;
}

export type TestStep = 'connect' | 'write' | 'read' | 'verify' | 'delete';

export interface StorageTestResult {
  ok: boolean;
  steps: { step: TestStep; ok: boolean; ms: number | null; error: string | null }[];
  totalMs: number;
  failedStep: TestStep | null;
}

export type PreviewResult =
  | { kind: 'image'; contentType: string; base64: string; size: number }
  | { kind: 'text'; contentType: string; text: string; truncated: boolean; size: number };

/** Ảnh lớn hơn mức này không preview (tải qua Download). */
export const PREVIEW_IMAGE_MAX = 2 * 1024 * 1024;
export const PREVIEW_TEXT_BYTES = 4096;
const PREVIEWABLE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif)$/;
export const SIGNED_URL_MIN_SEC = 60;

/**
 * Thao tác quản trị storage: Test Storage (ghi–đọc–so khớp–xoá object tạm), xoá object/version,
 * tải về, signed URL, preview, huỷ multipart. Mọi thao tác bật/tắt bằng env và ghi audit.
 */
@Injectable()
export class StorageOperationsService {
  constructor(
    private readonly storage: BaseStorageProvider,
    private readonly connection: StorageConnectionService,
    private readonly monitoring: StorageMonitoringService,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {}

  private get cfg() {
    return this.config.storage;
  }

  private ensure(enabled: boolean, code: StorageOperationErrorCode): void {
    if (!enabled) throw new StorageOperationError(code);
    if (!this.monitoring.usable()) throw new StorageOperationError('UNAVAILABLE');
  }

  private assertKey(key: string): void {
    if (!isValidKey(key)) throw new StorageOperationError('INVALID_KEY', key);
  }

  private isSensitive(key: string): boolean {
    return this.cfg.sensitivePrefixes.some((p) => key.startsWith(p));
  }

  private async audit(
    action: StorageOperationAction,
    target: string,
    ctx: OperationContext,
    started: number,
    detail: string | null,
    error: string | null,
    event?: {
      type: StorageEventType;
      severity: 'info' | 'warning';
      params: Record<string, string | number>;
    },
  ): Promise<StorageOperationRecord> {
    const record = await recordStorageOperation(this.redis, {
      at: Date.now(),
      action,
      target,
      result: error ? 'failed' : 'success',
      detail,
      durationMs: Number((performance.now() - started).toFixed(1)),
      actor: ctx.actor,
      ip: ctx.ip,
      error,
    });
    if (!error && event)
      await recordStorageEvent(this.redis, { ...event, runtime: this.identity?.id ?? null });
    return record;
  }

  // ─── Test Storage ─────────────────────────────────────────────────────────

  public async test(ctx: OperationContext): Promise<StorageTestResult> {
    const started = performance.now();
    const key = `${HEALTHCHECK_PREFIX}${Date.now()}-${randomBytes(4).toString('hex')}.txt`;
    const payload = Buffer.from(`core storage healthcheck ${new Date().toISOString()}`);
    const steps: StorageTestResult['steps'] = [];
    const step = async (name: TestStep, fn: () => Promise<void>) => {
      const t = performance.now();
      try {
        await fn();
        steps.push({
          step: name,
          ok: true,
          ms: Number((performance.now() - t).toFixed(1)),
          error: null,
        });
        return true;
      } catch (err) {
        const code = storageErrorCode(err);
        steps.push({
          step: name,
          ok: false,
          ms: Number((performance.now() - t).toFixed(1)),
          error: `${code ? `${code}: ` : ''}${this.monitoring.errorMessage(err)}`,
        });
        return false;
      }
    };
    const d = this.storage.driver;
    let read: Buffer | null = null;
    let written = false;
    const ok =
      (await step('connect', () => d.ping())) &&
      (written = await step('write', () =>
        d.put(key, payload, { contentType: 'text/plain' }).then(() => undefined),
      )) &&
      (await step('read', async () => {
        read = await d.get(key);
      })) &&
      (await step('verify', async () => {
        if (!read || !read.equals(payload))
          throw new Error('Read content does not match written content');
      })) &&
      (await step('delete', () => d.delete(key)));
    // Ghi được mà bước sau lỗi → vẫn cố dọn object tạm.
    if (!ok && written) await d.delete(key).catch(() => undefined);
    if (ok) this.connection.markSuccess(steps[0]?.ms ?? null);
    else await this.connection.check();
    const failed = steps.find((s) => !s.ok) ?? null;
    const result: StorageTestResult = {
      ok: Boolean(ok),
      steps,
      totalMs: Number((performance.now() - started).toFixed(1)),
      failedStep: failed?.step ?? null,
    };
    await this.audit(
      'test',
      HEALTHCHECK_PREFIX,
      ctx,
      started,
      failed ? failed.step : null,
      failed?.error ?? null,
    );
    return result;
  }

  // ─── Object ───────────────────────────────────────────────────────────────

  private async detailOrThrow(key: string): Promise<ObjectDetail> {
    this.assertKey(key);
    const detail = await this.monitoring.provider.detail(key);
    if (!detail) throw new StorageOperationError('NOT_FOUND', key, { key });
    return detail;
  }

  /** Xoá object (bản hiện tại) hoặc một version cụ thể (xoá vĩnh viễn). Retention/legal hold → từ chối. */
  public async deleteObject(key: string, versionId: string | null, ctx: OperationContext) {
    this.ensure(this.cfg.delete, 'DELETE_DISABLED');
    const detail = await this.detailOrThrow(key);
    const r = detail.retention;
    if (r?.legalHold) throw new StorageOperationError('RETENTION', key, { until: 'legal hold' });
    if (r?.retainUntil && r.retainUntil > Date.now())
      throw new StorageOperationError('RETENTION', key, {
        until: new Date(r.retainUntil).toISOString(),
      });
    if (versionId && !(this.storage.driver instanceof S3StorageDriver))
      throw new StorageOperationError('UNSUPPORTED');
    const started = performance.now();
    try {
      await this.storage.driver.delete(key, versionId ?? undefined);
    } catch (err) {
      const message = this.monitoring.errorMessage(err);
      await this.audit(
        versionId ? 'delete_version' : 'delete_object',
        key,
        ctx,
        started,
        versionId,
        message,
      );
      throw new StorageOperationError('FAILED', message);
    }
    return this.audit(
      versionId ? 'delete_version' : 'delete_object',
      key,
      ctx,
      started,
      versionId,
      null,
      {
        type: 'object_deleted',
        severity: 'warning',
        params: { key, size: detail.size, version: versionId ?? '' },
      },
    );
  }

  /** Stream nội dung để tải về (ghi audit). */
  public async download(
    key: string,
    ctx: OperationContext,
  ): Promise<{ stream: ObjectStream; detail: ObjectDetail }> {
    this.ensure(this.cfg.download, 'DOWNLOAD_DISABLED');
    const detail = await this.detailOrThrow(key);
    const started = performance.now();
    const stream = await this.storage.driver.stream(key);
    await this.audit('download', key, ctx, started, String(detail.size), null, {
      type: 'object_downloaded',
      severity: 'info',
      params: { key, size: detail.size },
    });
    return { stream, detail };
  }

  public async signedUrl(key: string, ttlSec: number, ctx: OperationContext) {
    this.ensure(this.cfg.signedUrl, 'SIGNED_URL_DISABLED');
    if (!this.monitoring.supports('signedUrl')) throw new StorageOperationError('UNSUPPORTED');
    if (ttlSec < SIGNED_URL_MIN_SEC || ttlSec > this.cfg.signedUrlMaxSec)
      throw new StorageOperationError('INVALID_TTL', String(ttlSec), {
        min: SIGNED_URL_MIN_SEC,
        max: this.cfg.signedUrlMaxSec,
      });
    await this.detailOrThrow(key);
    const started = performance.now();
    const url = await this.monitoring.provider.signedUrl(key, ttlSec);
    await this.audit('signed_url', key, ctx, started, `${ttlSec}s`, null, {
      type: 'signed_url_created',
      severity: 'info',
      params: { key, minutes: Math.round(ttlSec / 60) },
    });
    return { url, expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString() };
  }

  /** Xem trước: ảnh nhỏ (base64) hoặc vài KB đầu của file text; prefix nhạy cảm không bao giờ preview. */
  public async preview(key: string, ctx: OperationContext): Promise<PreviewResult> {
    this.ensure(this.cfg.preview, 'PREVIEW_DISABLED');
    if (this.isSensitive(key)) throw new StorageOperationError('SENSITIVE', key);
    const detail = await this.detailOrThrow(key);
    const ct = detail.contentType ?? 'application/octet-stream';
    const started = performance.now();
    let result: PreviewResult;
    if (kindOf(key, ct) === 'image' && PREVIEWABLE_IMAGE.test(ct)) {
      if (detail.size > PREVIEW_IMAGE_MAX)
        throw new StorageOperationError('TOO_LARGE', key, { max: PREVIEW_IMAGE_MAX });
      const buf = await this.monitoring.provider.readHead(key, detail.size);
      result = {
        kind: 'image',
        contentType: ct,
        base64: buf.toString('base64'),
        size: detail.size,
      };
    } else if (isTextual(key, ct)) {
      const buf = await this.monitoring.provider.readHead(key, PREVIEW_TEXT_BYTES);
      result = {
        kind: 'text',
        contentType: ct,
        text: buf.toString('utf8'),
        truncated: detail.size > PREVIEW_TEXT_BYTES,
        size: detail.size,
      };
    } else throw new StorageOperationError('UNSUPPORTED');
    await this.audit('preview', key, ctx, started, result.kind, null);
    return result;
  }

  public async abortUpload(key: string, uploadId: string, ctx: OperationContext) {
    this.ensure(this.cfg.abortUpload, 'ABORT_DISABLED');
    if (!this.monitoring.supports('multipart')) throw new StorageOperationError('UNSUPPORTED');
    this.assertKey(key);
    const started = performance.now();
    try {
      await this.monitoring.provider.abortMultipart(key, uploadId);
    } catch (err) {
      const code = storageErrorCode(err);
      if (code === 'NoSuchUpload')
        throw new StorageOperationError('NOT_FOUND', uploadId, { key: uploadId });
      const message = this.monitoring.errorMessage(err);
      await this.audit('abort_upload', key, ctx, started, uploadId, message);
      throw new StorageOperationError('FAILED', message);
    }
    return this.audit('abort_upload', key, ctx, started, uploadId, null, {
      type: 'upload_aborted',
      severity: 'warning',
      params: { key },
    });
  }
}
