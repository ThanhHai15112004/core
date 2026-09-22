import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
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

  constructor(
    private readonly cfg: StorageConfig['s3'],
    resolveCredentials: CredentialsResolver,
    client?: S3Client,
  ) {
    this.bucket = cfg.bucket;
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

  public async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

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

  public async delete(key: string, versionId?: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(versionId ? { VersionId: versionId } : {}),
      }),
    );
  }

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

  public async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  public url(key: string): string {
    const base = this.cfg.endpoint ?? `https://${this.bucket}.s3.${this.cfg.region}.amazonaws.com`;
    return this.cfg.endpoint || this.cfg.forcePathStyle
      ? `${base.replace(/\/$/, '')}/${this.bucket}/${key}`
      : `${base}/${key}`;
  }
}
