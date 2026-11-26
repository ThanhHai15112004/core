import { performance } from 'node:perf_hooks';
import { createHash, randomBytes } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService, type StorageDriverName } from '@packages/config/index.js';
import {
  PROVIDER_TYPE,
  ProviderRegistryService,
  defaultProviderRegistry,
} from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { SecretService } from '@packages/security/index.js';
import type { StorageContract } from '../contracts/storage.contract.js';
import type {
  ActiveUpload,
  StorageErrorRecord,
  StorageOp,
} from '../contracts/storage-events.types.js';
import { STORAGE_ERROR_LOG_SIZE, storageKeys } from '../constants/storage.keys.js';
import type { ObjectStream, StorageDriver } from '../drivers/storage-driver.js';
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

/**
 * Storage của Core. Driver chọn theo `STORAGE_DRIVER` (local filesystem / S3-compatible), `StorageContract`
 * không đổi. Lỗi được phân loại và lưu theo container; upload đang chạy được
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
  private readonly providerRegistry: ProviderRegistryService;

  constructor(
    private readonly configService: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly secrets?: SecretService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
    @Optional() providerRegistry?: ProviderRegistryService,
  ) {
    this.providerRegistry = providerRegistry ?? defaultProviderRegistry;
    const cfg = this.configService.storage;
    this.driver =
      cfg.driver === 's3'
        ? new S3StorageDriver(
            cfg.s3,
            async () => ({
              accessKeyId: await this.secret(cfg.s3.accessKeySecret, cfg.s3.accessKey),
              secretAccessKey: await this.secret(cfg.s3.secretKeySecret, cfg.s3.secretKey),
            }),
            undefined,
            cfg.cdnUrl,
          )
        : new LocalStorageDriver(cfg.localPath, cfg.cdnUrl);
  }

  /** Lấy giá trị secret đã giải mã hoặc kiểm tra cấu hình */
  private async secret(name: string, fallbackValue: string = ''): Promise<string> {
    const fromSecrets = await this.secrets?.getSecret(name).catch(() => null);
    return fromSecrets || fallbackValue;
  }

  /** Thực thi tác vụ khởi động sau khi toàn bộ ứng dụng hoàn tất bootstrap */
  public onApplicationBootstrap(): void {
    if (this.configService.isTest) return;
    this.timer = setInterval(() => void this.publishActive(), ACTIVE_PUBLISH_MS);
    this.timer.unref();
  }

  /** Dọn dẹp tài nguyên và ngắt kết nối khi module bị hủy */
  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Lấy container lưu trữ đang được theo dõi */
  private trackedContainer(key: string): string {
    const c = containerOf(key);
    if (this.containers.has(c)) return c;
    if (this.containers.size >= MAX_TRACKED_CONTAINERS) return '(other)';
    this.containers.add(c);
    return c;
  }

  /** Kiểm tra tính hợp lệ và độ an toàn của khóa tệp tin */
  private assertKey(key: string): void {
    if (!isValidKey(key))
      throw new StorageObjectError('INVALID_KEY', `Invalid storage key: ${key}`);
  }

  /** Chạy một thao tác; lỗi được phân loại, lưu rồi ném lại cho caller. */
  private async measure<T>(
    op: StorageOp,
    key: string,
    size: number | null,
    fn: () => Promise<T>,
    _bytesOf?: (r: T) => number,
  ): Promise<T> {
    const started = performance.now();
    const container = this.trackedContainer(key);
    try {
      const result = await fn();
      const latencyMs = performance.now() - started;
      if (this.providerRegistry.hasProvidersOfType(PROVIDER_TYPE.STORAGE)) {
        void this.providerRegistry.recordInvocation({
          providerType: PROVIDER_TYPE.STORAGE,
          driverCode: this.configService.storage.driver,
          success: true,
          latencyMs,
        });
      }
      return result;
    } catch (err) {
      const latencyMs = performance.now() - started;
      if (this.providerRegistry.hasProvidersOfType(PROVIDER_TYPE.STORAGE)) {
        void this.providerRegistry.recordInvocation({
          providerType: PROVIDER_TYPE.STORAGE,
          driverCode: this.configService.storage.driver,
          success: false,
          latencyMs,
          errorCode: storageErrorCode(err) ?? 'STORAGE_ERROR',
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      this.fail(op, key, container, size, err, latencyMs);
      throw err;
    }
  }

  /** Ghi nhận lỗi vận hành và ném ra ngoại lệ tương ứng */
  private fail(
    op: StorageOp,
    key: string,
    container: string,
    size: number | null,
    err: unknown,
    _ms: number,
  ): void {
    const kind = classifyStorageError(err);
    const status = storageHttpStatus(err);
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

  /** Tải tệp tin lên hệ thống lưu trữ đối tượng */
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
      await this.measure(
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
      return path;
    } finally {
      this.active.delete(id);
      this.activeDirty = true;
    }
  }

  /** Tên driver lưu trữ hiện hành (`local` | `s3`) để tầng nghiệp vụ đọc qua Adapter mà không chạm trực tiếp driver */
  public get driverName(): StorageDriverName {
    return this.driver.name;
  }

  /** Kiểm tra trạng thái Bucket Versioning (hỗ trợ S3/MinIO; Local trả về unsupported). */
  public async getBucketVersioningStatus(): Promise<{
    driver: StorageDriverName;
    supported: boolean;
    status: 'enabled' | 'suspended' | 'disabled' | 'unsupported';
    bucket: string | null;
  }> {
    if (this.driver instanceof S3StorageDriver) {
      const status = await this.driver.getBucketVersioning();
      return {
        driver: 's3',
        supported: true,
        status,
        bucket: this.driver.bucket,
      };
    }
    return {
      driver: this.driver.name,
      supported: false,
      status: 'unsupported',
      bucket: null,
    };
  }

  /** Bật Bucket Versioning cho S3/MinIO để bảo vệ file người dùng khỏi ghi đè/xóa nhầm. */
  public async enableBucketVersioning(): Promise<{
    driver: StorageDriverName;
    supported: boolean;
    status: 'enabled' | 'suspended' | 'unsupported';
    bucket: string | null;
  }> {
    if (this.driver instanceof S3StorageDriver) {
      const status = await this.driver.setBucketVersioning(true);
      return {
        driver: 's3',
        supported: true,
        status,
        bucket: this.driver.bucket,
      };
    }
    return {
      driver: this.driver.name,
      supported: false,
      status: 'unsupported',
      bucket: null,
    };
  }

  /** Tải xuống nội dung tệp tin từ hệ thống lưu trữ */
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

  /** Mở luồng đọc dữ liệu (stream / Byte-Range) qua Storage Adapter */
  public async stream(path: string, range?: { start: number; end: number }): Promise<ObjectStream> {
    this.assertKey(path);
    const requestedSize = range ? Math.max(0, range.end - range.start + 1) : null;
    return this.measure(
      'get',
      path,
      requestedSize,
      () => this.driver.stream(path, range),
      (s) => s.size ?? 0,
    );
  }

  /** Xóa bản ghi khỏi hệ thống theo mã định danh */
  public async delete(path: string): Promise<void> {
    this.assertKey(path);
    await this.measure('delete', path, null, () => this.driver.delete(path));
  }

  /** Lấy đường dẫn URL truy cập tới tệp tin lưu trữ */
  public async getUrl(path: string): Promise<string> {
    this.assertKey(path);
    return this.driver.url(path);
  }

  /** Kiểm tra sự tồn tại của tệp tin trong hệ thống lưu trữ */
  public async exists(path: string): Promise<boolean> {
    this.assertKey(path);
    return (await this.measure('head', path, null, () => this.driver.head(path))) !== null;
  }

  /** Ghi nối tiếp một mảnh dữ liệu (chunk) vào tệp tạm trên Storage */
  public async appendChunk(tempKey: string, chunk: Buffer): Promise<number> {
    this.assertKey(tempKey);
    if (typeof this.driver.appendChunk === 'function') {
      return this.measure(
        'put',
        tempKey,
        chunk.length,
        () => this.driver.appendChunk!(tempKey, chunk),
        () => chunk.length,
      );
    }
    throw new StorageObjectError('UNSUPPORTED', 'Storage driver does not support appendChunk');
  }

  /** Hoàn tất phiên tải lên theo chunk bằng cách chuyển tệp tạm sang khóa lưu trữ đích */
  public async finalizeChunkedUpload(
    tempKey: string,
    targetKey: string,
    mimeType?: string,
  ): Promise<string> {
    this.assertKey(tempKey);
    this.assertKey(targetKey);
    if (typeof this.driver.finalizeTempObject === 'function') {
      await this.measure('put', targetKey, null, () =>
        this.driver.finalizeTempObject!(tempKey, targetKey, {
          contentType: mimeType ?? mimeOf(targetKey),
        }),
      );
      return targetKey;
    }
    const fullBuf = await this.driver.get(tempKey);
    await this.upload(targetKey, fullBuf, mimeType);
    await this.driver.delete(tempKey).catch(() => undefined);
    return targetKey;
  }

  /** Dọn dẹp tệp tạm của phiên tải lên theo chunk */
  public async abortChunkedUpload(tempKey: string): Promise<void> {
    if (!isValidKey(tempKey)) return;
    if (typeof this.driver.abortTempObject === 'function') {
      await this.driver.abortTempObject(tempKey).catch(() => undefined);
      return;
    }
    await this.driver.delete(tempKey).catch(() => undefined);
  }

  /** Ghi một mảnh dữ liệu độc lập (`<tempPrefix>.part.XXXXXX`) phục vụ chunked upload stateless. */
  public async putChunkPart(
    tempPrefix: string,
    chunkIndex: number,
    chunk: Buffer,
  ): Promise<number> {
    const partKey = `${tempPrefix}.part.${String(chunkIndex).padStart(6, '0')}`;
    this.assertKey(partKey);
    if (typeof this.driver.putChunkPart === 'function') {
      return this.measure(
        'put',
        partKey,
        chunk.length,
        () => this.driver.putChunkPart!(tempPrefix, chunkIndex, chunk),
        () => chunk.length,
      );
    }
    await this.upload(partKey, chunk, 'application/octet-stream');
    return chunk.length;
  }

  /** Ghép các mảnh `.part.*` thành khóa lưu trữ đích và trả về SHA-256 + tổng byte. */
  public async finalizeChunkedParts(
    tempPrefix: string,
    totalChunks: number,
    targetKey: string,
    mimeType?: string,
  ): Promise<{ checksumSha256: string; sizeBytes: number }> {
    this.assertKey(tempPrefix);
    this.assertKey(targetKey);
    if (typeof this.driver.finalizeChunkedParts === 'function') {
      return this.measure('put', targetKey, null, () =>
        this.driver.finalizeChunkedParts!(tempPrefix, totalChunks, targetKey, {
          contentType: mimeType ?? mimeOf(targetKey),
        }),
      );
    }
    const buffers: Buffer[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const partKey = `${tempPrefix}.part.${String(i).padStart(6, '0')}`;
      buffers.push(await this.download(partKey));
    }
    const combined = Buffer.concat(buffers);
    const checksumSha256 = createHash('sha256').update(combined).digest('hex');
    await this.upload(targetKey, combined, mimeType);
    await this.abortChunkedParts(tempPrefix, totalChunks);
    return { checksumSha256, sizeBytes: combined.length };
  }

  /** Xóa toàn bộ mảnh tạm `.part.*` của phiên tải lên. */
  public async abortChunkedParts(tempPrefix: string, totalChunks?: number): Promise<void> {
    if (!isValidKey(tempPrefix)) return;
    if (typeof this.driver.abortChunkedParts === 'function') {
      await this.driver.abortChunkedParts(tempPrefix, totalChunks).catch(() => undefined);
      return;
    }
    if (typeof totalChunks === 'number' && totalChunks > 0) {
      await Promise.all(
        Array.from({ length: totalChunks }, (_, idx) =>
          this.driver
            .delete(`${tempPrefix}.part.${String(idx).padStart(6, '0')}`)
            .catch(() => undefined),
        ),
      );
    }
  }

  /** Upload đang chạy trong process này. */
  public activeUploads(): ActiveUpload[] {
    return [...this.active.values()];
  }

  /** Phát hành thông báo kích hoạt sự kiện tới hệ thống */
  private async publishActive(): Promise<void> {
    const instance = `${process.pid}`;
    if (!this.redis?.isReady()) return;
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
