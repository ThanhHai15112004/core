import { performance } from 'node:perf_hooks';
import {
  AbortMultipartUploadCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLegalHoldCommand,
  GetObjectLockConfigurationCommand,
  GetObjectRetentionCommand,
  ListMultipartUploadsCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  type LifecycleRule as S3LifecycleRule,
  type _Object,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageConfig } from '@packages/config/index.js';
import { HEALTHCHECK_PREFIX } from '../constants/storage.keys.js';
import type { S3StorageDriver } from '../drivers/s3-storage.driver.js';
import { ROOT_CONTAINER, containerOf, kindOf } from '../utils/object-kind.js';
import { matchesFilter } from './usage.js';
import type {
  Capacity,
  LifecycleInfo,
  LifecycleRule,
  MultipartUpload,
  ObjectDetail,
  ObjectFilter,
  ObjectPage,
  ObjectRetention,
  ObjectVersion,
  ProviderInfo,
  ScannedObject,
  StorageCapability,
  StorageMonitoringProvider,
} from './monitoring.types.js';

const PAGE_MAX_ROUNDS = 10;
const MULTIPART_DETAIL_LIMIT = 50;
const BUCKET_INFO_TTL_MS = 60_000;

const errorName = (err: unknown) => (err as { name?: string })?.name ?? '';

/**
 * Theo dõi S3-compatible (AWS S3, MinIO…) trên bucket cấu hình: ListObjectsV2 theo continuation token,
 * multipart dở, lifecycle/versioning/object lock (chỉ đọc), signed URL. Container = prefix cấp 1.
 */
export class S3MonitoringProvider implements StorageMonitoringProvider {
  public readonly capabilities: ReadonlySet<StorageCapability> = new Set<StorageCapability>([
    'listObjects',
    'usage',
    'capacity',
    'containers',
    'multipart',
    'signedUrl',
    'lifecycle',
    'versioning',
    'retention',
    'download',
    'preview',
    'httpStatus',
  ]);
  private product: string;
  private probed = false;
  private bucketInfo: { at: number; value: LifecycleInfo } | null = null;

  constructor(
    private readonly driver: S3StorageDriver,
    private readonly cfg: StorageConfig,
  ) {
    const ep = cfg.s3.endpoint;
    this.product = !ep || /amazonaws\.com/.test(ep) ? 'AWS S3' : 'S3-compatible';
  }

  private get client() {
    return this.driver.client;
  }

  private get bucket() {
    return this.driver.bucket;
  }

  public info(): ProviderInfo {
    // Nhận diện MinIO chạy nền một lần; các lần gọi sau trả tên chính xác.
    void this.probeProduct();
    return {
      driver: 's3',
      product: this.product,
      location: this.bucket,
      endpoint: this.cfg.s3.endpoint,
      region: this.cfg.s3.region,
    };
  }

  /** Nhận diện MinIO qua health endpoint riêng của nó (một lần). */
  private async probeProduct(): Promise<void> {
    if (this.probed || !this.cfg.s3.endpoint || this.product === 'AWS S3') return;
    this.probed = true;
    try {
      const res = await fetch(`${this.cfg.s3.endpoint.replace(/\/$/, '')}/minio/health/live`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) this.product = 'MinIO';
    } catch {
      /* không phải MinIO / không truy cập được — giữ S3-compatible */
    }
  }

  public async ping(): Promise<number> {
    const started = performance.now();
    await this.driver.ping();
    const ms = Number((performance.now() - started).toFixed(2));
    await this.probeProduct();
    return ms;
  }

  private toScanned(c: _Object): ScannedObject | null {
    if (!c.Key || c.Key.startsWith(HEALTHCHECK_PREFIX) || c.Key.endsWith('/')) return null;
    return {
      key: c.Key,
      size: c.Size ?? 0,
      lastModified: c.LastModified?.getTime() ?? null,
      contentType: null,
    };
  }

  public async scan(limit: number) {
    const objects: ScannedObject[] = [];
    let token: string | undefined;
    let total = 0;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1000, ContinuationToken: token }),
      );
      for (const c of res.Contents ?? []) {
        const o = this.toScanned(c);
        if (!o) continue;
        total++;
        if (objects.length < limit) objects.push(o);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token && total < limit * 5);
    return { objects, total, truncated: Boolean(token) || total > objects.length };
  }

  public async listPage(filter: ObjectFilter, cursor: string, count: number): Promise<ObjectPage> {
    const now = Date.now();
    const root = filter.container === ROOT_CONTAINER;
    const prefix =
      filter.container && !root ? `${filter.container}/${filter.prefix}` : filter.prefix;
    const objects: ScannedObject[] = [];
    let token: string | undefined = cursor || undefined;
    let examined = 0;
    let rounds = 0;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix || undefined,
          // Container "(root)": chỉ object nằm ngay gốc bucket.
          ...(root ? { Delimiter: '/' } : {}),
          MaxKeys: Math.min(1000, Math.max(count, 100)),
          ContinuationToken: token,
        }),
      );
      for (const c of res.Contents ?? []) {
        const o = this.toScanned(c);
        examined++;
        if (o && matchesFilter(o, filter, now)) objects.push(o);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
      rounds++;
    } while (token && objects.length < count && rounds < PAGE_MAX_ROUNDS);
    return { objects, cursor: token ?? '', examined };
  }

  public async detail(key: string): Promise<ObjectDetail | null> {
    const meta = await this.driver.head(key);
    if (!meta) return null;
    const bucket = await this.lifecycle().catch(() => null);
    const [versions, retention] = await Promise.all([
      bucket?.versioning && bucket.versioning !== 'disabled'
        ? this.versions(key)
        : Promise.resolve(null),
      bucket?.objectLock ? this.retention(key) : Promise.resolve(null),
    ]);
    return {
      ...meta,
      container: containerOf(key),
      kind: kindOf(key, meta.contentType),
      versions,
      retention,
    };
  }

  private async versions(key: string): Promise<ObjectVersion[]> {
    const res = await this.client.send(
      new ListObjectVersionsCommand({ Bucket: this.bucket, Prefix: key, MaxKeys: 100 }),
    );
    const out: ObjectVersion[] = [];
    for (const v of res.Versions ?? [])
      if (v.Key === key)
        out.push({
          versionId: v.VersionId ?? 'null',
          size: v.Size ?? 0,
          lastModified: v.LastModified?.getTime() ?? null,
          isLatest: Boolean(v.IsLatest),
          deleteMarker: false,
        });
    for (const m of res.DeleteMarkers ?? [])
      if (m.Key === key)
        out.push({
          versionId: m.VersionId ?? 'null',
          size: 0,
          lastModified: m.LastModified?.getTime() ?? null,
          isLatest: Boolean(m.IsLatest),
          deleteMarker: true,
        });
    return out.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
  }

  private async retention(key: string): Promise<ObjectRetention> {
    const [ret, hold] = await Promise.all([
      this.client
        .send(new GetObjectRetentionCommand({ Bucket: this.bucket, Key: key }))
        .catch(() => null),
      this.client
        .send(new GetObjectLegalHoldCommand({ Bucket: this.bucket, Key: key }))
        .catch(() => null),
    ]);
    return {
      mode: ret?.Retention?.Mode ?? null,
      retainUntil: ret?.Retention?.RetainUntilDate?.getTime() ?? null,
      legalHold: hold?.LegalHold?.Status === 'ON',
    };
  }

  public async capacity(): Promise<Capacity> {
    return this.cfg.capacityGb > 0
      ? { totalBytes: this.cfg.capacityGb * 1024 ** 3, freeBytes: null, source: 'config' }
      : { totalBytes: null, freeBytes: null, source: null };
  }

  public async multipart(): Promise<MultipartUpload[]> {
    const res = await this.client.send(
      new ListMultipartUploadsCommand({ Bucket: this.bucket, MaxUploads: 1000 }),
    );
    const uploads = res.Uploads ?? [];
    return Promise.all(
      uploads.map(async (u, i) => {
        let parts: number | null = null;
        let bytes: number | null = null;
        if (i < MULTIPART_DETAIL_LIMIT && u.Key && u.UploadId) {
          const p = await this.client
            .send(
              new ListPartsCommand({
                Bucket: this.bucket,
                Key: u.Key,
                UploadId: u.UploadId,
                MaxParts: 1000,
              }),
            )
            .catch(() => null);
          if (p) {
            parts = p.Parts?.length ?? 0;
            bytes = (p.Parts ?? []).reduce((s, x) => s + (x.Size ?? 0), 0);
          }
        }
        return {
          uploadId: u.UploadId ?? '',
          key: u.Key ?? '',
          container: containerOf(u.Key ?? ''),
          initiated: u.Initiated?.getTime() ?? null,
          parts,
          uploadedBytes: bytes,
        };
      }),
    );
  }

  public async lifecycle(): Promise<LifecycleInfo> {
    if (this.bucketInfo && Date.now() - this.bucketInfo.at < BUCKET_INFO_TTL_MS)
      return this.bucketInfo.value;
    const [rules, versioning, lock] = await Promise.all([
      this.client
        .send(new GetBucketLifecycleConfigurationCommand({ Bucket: this.bucket }))
        .then((r) => (r.Rules ?? []).map(mapRule))
        .catch((err) => {
          if (errorName(err) === 'NoSuchLifecycleConfiguration') return [] as LifecycleRule[];
          throw err;
        }),
      this.client
        .send(new GetBucketVersioningCommand({ Bucket: this.bucket }))
        .then(
          (r) =>
            (r.Status === 'Enabled'
              ? 'enabled'
              : r.Status === 'Suspended'
                ? 'suspended'
                : 'disabled') as LifecycleInfo['versioning'],
        )
        .catch(() => null),
      this.client
        .send(new GetObjectLockConfigurationCommand({ Bucket: this.bucket }))
        .then((r) => r.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled')
        .catch((err) => (/ObjectLockConfigurationNotFound/.test(errorName(err)) ? false : null)),
    ]);
    const value: LifecycleInfo = { rules, versioning, objectLock: lock };
    this.bucketInfo = { at: Date.now(), value };
    return value;
  }

  public async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }

  public signedUrl(key: string, ttlSec: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSec,
    });
  }

  public async readHead(key: string, bytes: number): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${Math.max(0, bytes - 1)}`,
      }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }
}

function mapRule(r: S3LifecycleRule): LifecycleRule {
  const actions: LifecycleRule['actions'] = [];
  if (r.Expiration)
    actions.push({ type: 'expire', days: r.Expiration.Days ?? null, storageClass: null });
  for (const t of r.Transitions ?? [])
    actions.push({
      type: 'transition',
      days: t.Days ?? null,
      storageClass: t.StorageClass ?? null,
    });
  if (r.NoncurrentVersionExpiration)
    actions.push({
      type: 'noncurrentExpire',
      days: r.NoncurrentVersionExpiration.NoncurrentDays ?? null,
      storageClass: null,
    });
  if (r.AbortIncompleteMultipartUpload)
    actions.push({
      type: 'abortMultipart',
      days: r.AbortIncompleteMultipartUpload.DaysAfterInitiation ?? null,
      storageClass: null,
    });
  return {
    id: r.ID ?? '(no id)',
    status: r.Status === 'Enabled' ? 'enabled' : 'disabled',
    prefix: r.Filter?.Prefix ?? r.Filter?.And?.Prefix ?? r.Prefix ?? '',
    actions,
  };
}
