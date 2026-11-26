import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { PassThrough, type Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { StorageConfig } from '@packages/config/index.js';
import type { ObjectMeta, ObjectStream, PutOptions, StorageDriver } from './storage-driver.js';

/** Object lớn hơn ngưỡng này đi qua multipart upload (có tiến độ). */
export const MULTIPART_THRESHOLD = 8 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;

export type CredentialsResolver = () => Promise<{ accessKeyId: string; secretAccessKey: string }>;

/**
 * S3-compatible (AWS S3, MinIO…) trên một bucket. Credentials lấy lười qua `resolveCredentials`
 * (SecretService) — không bao giờ nằm trong cấu hình trả ra ngoài.
 */
export class S3StorageDriver implements StorageDriver {
  public readonly name = 's3' as const;
  public readonly client: S3Client;
  public readonly bucket: string;
  private readonly cdnUrl: string | null;

  constructor(
    private readonly cfg: StorageConfig['s3'],
    resolveCredentials: CredentialsResolver,
    client?: S3Client,
    cdnUrl: string | null = null,
  ) {
    this.bucket = cfg.bucket;
    this.cdnUrl = cdnUrl ? cdnUrl.trim().replace(/\/+$/, '') : null;
    this.client =
      client ??
      new S3Client({
        region: cfg.region,
        ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
        forcePathStyle: cfg.forcePathStyle,
        credentials: resolveCredentials,
        maxAttempts: 2,
        requestHandler: { requestTimeout: cfg.timeoutMs, connectionTimeout: 5000 },
      });
  }

  /** Lưu trữ một đối tượng hoặc tệp tin vào hệ thống lưu trữ */
  public async put(key: string, body: Buffer, opts: PutOptions): Promise<{ multipart: boolean }> {
    if (body.length <= MULTIPART_THRESHOLD) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: opts.contentType,
        }),
      );
      opts.onProgress?.(body.length);
      return { multipart: false };
    }
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: opts.contentType },
      partSize: PART_SIZE,
      queueSize: 2,
      leavePartsOnError: false,
    });
    upload.on('httpUploadProgress', (p) => {
      if (typeof p.loaded === 'number') opts.onProgress?.(p.loaded);
    });
    await upload.done();
    return { multipart: true };
  }

  /** Lấy dữ liệu hoặc đối tượng theo khóa định danh */
  public async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  /** Mở luồng đọc dữ liệu (stream) của tệp tin lưu trữ */
  public async stream(key: string, range?: { start: number; end: number }): Promise<ObjectStream> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    return {
      body: res.Body as Readable,
      size: res.ContentLength ?? null,
      contentType: res.ContentType ?? null,
    };
  }

  /** Xóa bản ghi khỏi hệ thống theo mã định danh */
  public async delete(key: string, versionId?: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(versionId ? { VersionId: versionId } : {}),
      }),
    );
  }

  /** Lấy thông tin metadata của đối tượng lưu trữ mà không tải nội dung */
  public async head(key: string, versionId?: string): Promise<ObjectMeta | null> {
    try {
      const r = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
        }),
      );
      return {
        key,
        size: r.ContentLength ?? 0,
        contentType: r.ContentType ?? null,
        lastModified: r.LastModified?.getTime() ?? null,
        createdAt: null,
        etag: r.ETag?.replace(/"/g, '') ?? null,
        storageClass: r.StorageClass ?? 'STANDARD',
        versionId: r.VersionId ?? null,
        checksum: r.ChecksumSHA256 ?? r.ChecksumCRC32 ?? r.ChecksumCRC32C ?? null,
      };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404)
        return null;
      throw err;
    }
  }

  /** Kiểm tra trạng thái sẵn sàng và đo độ trễ kết nối */
  public async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** Kiểm tra trạng thái Versioning của bucket S3/MinIO */
  public async getBucketVersioning(): Promise<'enabled' | 'suspended' | 'disabled'> {
    const res = await this.client.send(new GetBucketVersioningCommand({ Bucket: this.bucket }));
    if (res.Status === 'Enabled') return 'enabled';
    if (res.Status === 'Suspended') return 'suspended';
    return 'disabled';
  }

  /** Bật hoặc tạm dừng Versioning trên bucket S3/MinIO */
  public async setBucketVersioning(enabled: boolean): Promise<'enabled' | 'suspended'> {
    const status = enabled ? 'Enabled' : 'Suspended';
    await this.client.send(
      new PutBucketVersioningCommand({
        Bucket: this.bucket,
        VersioningConfiguration: { Status: status },
      }),
    );
    return enabled ? 'enabled' : 'suspended';
  }

  /** Lấy đường dẫn URL truy cập công khai của tệp tin lưu trữ */
  public url(key: string): string {
    const cleanKey = key.replace(/^\/+/, '');
    if (this.cdnUrl) {
      return `${this.cdnUrl}/${cleanKey}`;
    }
    const base = this.cfg.endpoint ?? `https://${this.bucket}.s3.${this.cfg.region}.amazonaws.com`;
    return this.cfg.endpoint || this.cfg.forcePathStyle
      ? `${base.replace(/\/$/, '')}/${this.bucket}/${cleanKey}`
      : `${base}/${cleanKey}`;
  }

  private partKey(tempPrefix: string, chunkIndex: number): string {
    return `${tempPrefix}.part.${String(chunkIndex).padStart(6, '0')}`;
  }

  /** Ghi một mảnh dữ liệu độc lập lên S3 (`<tempPrefix>.part.XXXXXX`) — stateless đa instance. */
  public async putChunkPart(
    tempPrefix: string,
    chunkIndex: number,
    chunk: Buffer,
  ): Promise<number> {
    const key = this.partKey(tempPrefix, chunkIndex);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: chunk,
        ContentType: 'application/octet-stream',
      }),
    );
    return chunk.length;
  }

  /**
   * Stream tuần tự các mảnh `.part.*` từ S3 qua `PassThrough` vào `Upload` sang `targetKey`,
   * đồng thời tính SHA-256 streaming với bộ nhớ hằng số, sau đó dọn sạch `.part.*`.
   */
  public async finalizeChunkedParts(
    tempPrefix: string,
    totalChunks: number,
    targetKey: string,
    opts?: PutOptions,
  ): Promise<{ checksumSha256: string; sizeBytes: number }> {
    const passThrough = new PassThrough();
    const hash = createHash('sha256');
    let sizeBytes = 0;

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: targetKey,
        Body: passThrough,
        ContentType: opts?.contentType ?? 'application/octet-stream',
      },
      partSize: PART_SIZE,
      queueSize: 2,
      leavePartsOnError: false,
    });

    const uploadPromise = upload.done();

    try {
      for (let i = 0; i < totalChunks; i++) {
        const res = await this.client.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: this.partKey(tempPrefix, i),
          }),
        );
        const body = res.Body as AsyncIterable<Uint8Array> | undefined;
        if (!body) {
          throw new Error(`Missing S3 chunk part body at index ${i}`);
        }
        for await (const piece of body) {
          const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
          hash.update(buf);
          sizeBytes += buf.length;
          if (!passThrough.write(buf)) {
            await once(passThrough, 'drain');
          }
        }
      }
      passThrough.end();
      await uploadPromise;
    } catch (err) {
      passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
      await uploadPromise.catch(() => undefined);
      throw err;
    }

    await this.abortChunkedParts(tempPrefix, totalChunks);
    return {
      checksumSha256: hash.digest('hex'),
      sizeBytes,
    };
  }

  /** Xóa các mảnh `.part.*` đã tạo trên S3 khi hoàn tất hoặc hủy bỏ. */
  public async abortChunkedParts(tempPrefix: string, totalChunks?: number): Promise<void> {
    if (typeof totalChunks === 'number' && totalChunks > 0) {
      await Promise.all(
        Array.from({ length: totalChunks }, (_, idx) =>
          this.delete(this.partKey(tempPrefix, idx)).catch(() => undefined),
        ),
      );
      return;
    }
    try {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${tempPrefix}.part.`,
        }),
      );
      const keys = (listed.Contents ?? []).map((item) => item.Key).filter((k): k is string => Boolean(k));
      await Promise.all(keys.map((k) => this.delete(k).catch(() => undefined)));
    } catch {
      // Best-effort cleanup
    }
  }
}
