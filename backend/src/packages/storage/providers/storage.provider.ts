import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { SecretService } from '@packages/security/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import type { StorageContract } from '../contracts/storage.contract.js';
import type {
  ActiveUpload,
  StorageErrorRecord,
  StorageOp,
} from '../contracts/storage-events.types.js';
import { STORAGE_ERROR_LOG_SIZE, storageKeys } from '../constants/storage.keys.js';
import type { StorageDriver } from '../drivers/storage-driver.js';
import { LocalStorageDriver } from '../drivers/local-storage.driver.js';
import { S3StorageDriver } from '../drivers/s3-storage.driver.js';
import { containerOf, isValidKey, mimeOf } from '../utils/object-kind.js';
import {
  StorageObjectError,
  classifyStorageError,
  sanitizeStorageMessage,
  storageErrorCode,
  storageHttpStatus,
} from '../utils/storage-errors.js';

/** Số container tối đa có bộ đếm riêng (phần dư gộp vào `(other)`). */
export const MAX_TRACKED_CONTAINERS = 100;
const ERROR_RECORDS_PER_SEC = 5;
const ACTIVE_PUBLISH_MS = 2000;
const ACTIVE_TTL_SEC = 10;

/** Metric theo container, vd. `storage.c.uploads.put`. */
export const containerMetric = (container: string, kind: string) =>
  `storage.c.${container.replace(/\|/g, '_')}.${kind}`;

/**
 * Storage của Core. Driver chọn theo `STORAGE_DRIVER` (local filesystem / S3-compatible), `StorageContract`
 * không đổi. Mọi thao tác được đo (latency, bytes, lỗi theo loại, theo container) và upload đang chạy được
 * báo lên Redis để trang Storage thấy tiến độ.
 */
@Injectable()
export class BaseStorageProvider
  implements StorageContract, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger('Storage');
  public readonly driver: StorageDriver;
  private readonly containers = new Set<string>();
  private readonly active = new Map<string, ActiveUpload>();
  private activeDirty = false;
  private timer: NodeJS.Timeout | null = null;
  private errorWindow = { at: 0, n: 0 };
  private lastLoggedError: string | null = null;

  constructor(
    private readonly configService: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly recorder?: MetricRecorder,
    @Optional() private readonly secrets?: SecretService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {
    const cfg = this.configService.storage;
    this.driver =
      cfg.driver === 's3'
        ? new S3StorageDriver(cfg.s3, async () => ({
            accessKeyId: await this.secret(cfg.s3.accessKeySecret),
            secretAccessKey: await this.secret(cfg.s3.secretKeySecret),
          }))
        : new LocalStorageDriver(cfg.localPath);
  }

  private async secret(name: string): Promise<string> {
    const fromSecrets = await this.secrets?.getSecret(name).catch(() => null);
    return fromSecrets || process.env[name] || '';
  }

  public onApplicationBootstrap(): void {
    if (!this.recorder?.instance || this.configService.isTest) return;
    this.timer = setInterval(() => void this.publishActive(), ACTIVE_PUBLISH_MS);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private trackedContainer(key: string): string {
    const c = containerOf(key);
    if (this.containers.has(c)) return c;
    if (this.containers.size >= MAX_TRACKED_CONTAINERS) return '(other)';
    this.containers.add(c);
    return c;
  }

  private assertKey(key: string): void {
    if (!isValidKey(key))
      throw new StorageObjectError('INVALID_KEY', `Invalid storage key: ${key}`);
  }

  /** Chạy một thao tác và ghi số đo; lỗi được phân loại, lưu rồi ném lại cho caller. */
  private async measure<T>(
    op: StorageOp,
    key: string,
    size: number | null,
    fn: () => Promise<T>,
    bytesOf?: (r: T) => number,
  ): Promise<T> {
    const started = performance.now();
    const container = this.trackedContainer(key);
    try {
      const result = await fn();
      const ms = performance.now() - started;
      this.recorder?.timing(`storage.${op}`, ms);
      this.recorder?.count(containerMetric(container, op));
      if (this.driver.name === 's3') this.recorder?.count('storage.http.2xx');
      const bytes = bytesOf?.(result) ?? 0;
      if (bytes > 0) {
        const dir = op === 'put' ? 'up' : 'down';
        this.recorder?.count(`storage.bytes.${dir}`, bytes);
        this.recorder?.count(containerMetric(container, `bytes.${dir}`), bytes);
      }
      return result;
    } catch (err) {
      this.fail(op, key, container, size, err, performance.now() - started);
      throw err;
    }
  }

  private fail(
    op: StorageOp,
    key: string,
    container: string,
    size: number | null,
    err: unknown,
    ms: number,
  ): void {
    const kind = classifyStorageError(err);
    const status = storageHttpStatus(err);
    this.recorder?.count('storage.errors');
    this.recorder?.count(`storage.errors.${op}`);
    this.recorder?.count(`storage.err.${kind}`);
    this.recorder?.count(containerMetric(container, 'errors'));
    this.recorder?.timing(`storage.${op}.failed`, ms);
    if (status !== null) this.recorder?.count(`storage.http.${Math.floor(status / 100)}xx`);
    const root = this.driver instanceof LocalStorageDriver ? this.driver.root : undefined;
    const message = sanitizeStorageMessage(err, root);
    if (this.lastLoggedError !== message)
      this.logger.warn(`Storage ${op} ${key} failed: ${message}`);
    this.lastLoggedError = message;

    const now = Date.now();
    if (now - this.errorWindow.at >= 1000) this.errorWindow = { at: now, n: 0 };
    if (++this.errorWindow.n > ERROR_RECORDS_PER_SEC || !this.redis?.isReady()) return;
    const record: StorageErrorRecord = {
      at: now,
      op,
      key,
      container,
      size,
      kind,
      code: storageErrorCode(err),
      httpStatus: status,
      message,
      runtime: this.identity?.id ?? null,
      correlationId: RequestContextService.currentCorrelationId() ?? null,
    };
    const listKey = storageKeys(this.redis).errors();
    void this.redis.client
      .multi()
      .lpush(listKey, JSON.stringify(record))
      .ltrim(listKey, 0, STORAGE_ERROR_LOG_SIZE - 1)
      .exec()
      .catch(() => undefined);
  }

  public async upload(
    path: string,
    content: Buffer | Uint8Array,
    mimeType?: string,
  ): Promise<string> {
    this.assertKey(path);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const id = randomBytes(6).toString('hex');
    this.active.set(id, {
      id,
      key: path,
      container: containerOf(path),
      size: buf.length,
      sentBytes: 0,
      startedAt: Date.now(),
      multipart: false,
      runtime: this.identity?.id ?? null,
    });
    this.activeDirty = true;
    try {
      const res = await this.measure(
        'put',
        path,
        buf.length,
        () =>
          this.driver.put(path, buf, {
            contentType: mimeType ?? mimeOf(path),
            onProgress: (sent) => {
              const a = this.active.get(id);
              if (a) a.sentBytes = sent;
            },
          }),
        () => buf.length,
      );
      if (res.multipart) this.recorder?.count('storage.multipart');
      return path;
    } finally {
      this.active.delete(id);
      this.activeDirty = true;
    }
  }

  public async download(path: string): Promise<Buffer> {
    this.assertKey(path);
    return this.measure(
      'get',
      path,
      null,
      () => this.driver.get(path),
      (b) => b.length,
    );
  }

  public async delete(path: string): Promise<void> {
    this.assertKey(path);
    await this.measure('delete', path, null, () => this.driver.delete(path));
  }

  public async getUrl(path: string): Promise<string> {
    this.assertKey(path);
    return this.driver.url(path);
  }

  public async exists(path: string): Promise<boolean> {
    this.assertKey(path);
    return (await this.measure('head', path, null, () => this.driver.head(path))) !== null;
  }

  /** Upload đang chạy trong process này. */
  public activeUploads(): ActiveUpload[] {
    return [...this.active.values()];
  }

  private async publishActive(): Promise<void> {
    const instance = this.recorder?.instance;
    if (!instance || !this.redis?.isReady()) return;
    if (!this.activeDirty && this.active.size === 0) return;
    this.activeDirty = false;
    const key = storageKeys(this.redis).active(instance);
    await (
      this.active.size
        ? this.redis.client.set(key, JSON.stringify(this.activeUploads()), 'EX', ACTIVE_TTL_SEC)
        : this.redis.client.del(key)
    ).catch(() => undefined);
  }
}
