import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { BaseCacheProvider } from '@packages/cache/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  BaseStorageProvider,
  LocalStorageDriver,
  S3StorageDriver,
} from '@packages/storage/index.js';
import { FILE_CATEGORY, FILE_VISIBILITY } from '@modules/files/contracts/index.js';
import { ChunkedUploadSessionManager } from '@modules/files/helpers/chunked-upload-session.helper.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';

describe('Phase 13.1 — Stateless Chunked Upload (Multi-Instance & S3 Driver)', () => {
  let tempRoot: string;
  let redis: RedisService;
  let cache: BaseCacheProvider;

  beforeEach(async () => {
    applyTestEnv({
      NODE_ENV: 'production',
      CACHE_DRIVER: 'redis',
      STORAGE_DRIVER: 's3',
    });
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'core-stateless-chunk-'));
    const config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
    cache = BaseCacheProvider.createForEnvironment(config, redis);
  });

  afterEach(async () => {
    await redis.onApplicationShutdown();
    await fs.rm(tempRoot, { recursive: true, force: true });
    delete process.env['CACHE_DRIVER'];
    delete process.env['STORAGE_DRIVER'];
    applyTestEnv();
  });

  it('2 API instance khác nhau (không Sticky Session) xử lý init -> chunk 0 (instance A) -> chunk 1 (instance B) -> complete (instance A)', async () => {
    const driver = new LocalStorageDriver(tempRoot);
    const storageConfig = new CoreConfigService();
    const storage = new BaseStorageProvider(storageConfig, redis);
    // Dùng chung LocalStorageDriver trỏ vào shared volume để test part-based assembly
    Object.defineProperty(storage, 'driver', { value: driver, writable: true });

    const instanceA = new ChunkedUploadSessionManager(cache);
    const instanceB = new ChunkedUploadSessionManager(cache);

    const chunk0 = Buffer.alloc(4 * 1024 * 1024, 0x41);
    const chunk1 = Buffer.alloc(512 * 1024, 0x42);
    const totalBytes = chunk0.length + chunk1.length;
    const expectedSha256 = createHash('sha256')
      .update(Buffer.concat([chunk0, chunk1]))
      .digest('hex');

    // Instance A khởi tạo phiên upload
    const created = await instanceA.createSession({
      storagePrefix: 'courses',
      input: {
        fileName: 'lecture.mp4',
        sizeBytes: totalBytes,
        mimeType: 'video/mp4',
        visibility: FILE_VISIBILITY.INTERNAL,
      },
      originalName: 'lecture.mp4',
      displayName: 'lecture.mp4',
      extension: 'mp4',
      mimeType: 'video/mp4',
      category: FILE_CATEGORY.VIDEO,
      folderId: null,
      folderName: null,
      organizationUnitId: 1,
      actorUserId: 99,
    });

    // Instance A ghi chunk 0 + retry idempotent cùng chunk 0
    const sessionOnA = await instanceA.getActiveSession(created.uploadId, 99);
    const bytesAfter0 = await instanceA.appendChunkToStorage(sessionOnA, 0, chunk0, storage);
    expect(bytesAfter0).toBe(chunk0.length);
    const retryBytes0 = await instanceA.appendChunkToStorage(sessionOnA, 0, chunk0, storage);
    expect(retryBytes0).toBe(chunk0.length);

    // Request chunk 1 rơi sang Instance B (không có gì trong RAM của Instance B)
    const sessionOnB = await instanceB.getActiveSession(created.uploadId, 99);
    expect(sessionOnB.expectedChunkIndex).toBe(1);
    const bytesAfter1 = await instanceB.appendChunkToStorage(sessionOnB, 1, chunk1, storage);
    expect(bytesAfter1).toBe(totalBytes);

    // Request complete quay lại Instance A → đọc state mới nhất từ Shared Cache
    const finalizedSession = await instanceA.getActiveSession(created.uploadId, 99);
    expect(finalizedSession.receivedBytes).toBe(totalBytes);
    expect(finalizedSession.expectedChunkIndex).toBe(2);

    const result = await instanceA.finalizeToStorageKey(
      finalizedSession,
      'courses/2026/11/final-lecture.mp4',
      storage,
    );
    expect(result.sizeBytes).toBe(totalBytes);
    expect(result.checksumSha256).toBe(expectedSha256);

    const storedBuf = await storage.download('courses/2026/11/final-lecture.mp4');
    expect(storedBuf.length).toBe(totalBytes);
    expect(await storage.exists(`${created.tempStorageKey}.part.000000`)).toBe(false);
    expect(await storage.exists(`${created.tempStorageKey}.part.000001`)).toBe(false);
    await expect(instanceB.getActiveSession(created.uploadId, 99)).rejects.toThrow();
  });

  it('S3StorageDriver hỗ trợ putChunkPart, finalizeChunkedParts (tính SHA-256 streaming & xóa part) và abortChunkedParts', async () => {
    const s3 = mockClient(S3Client);
    const objects = new Map<string, Buffer>();

    s3.on(PutObjectCommand).callsFake(async (input) => {
      const key = String(input.Key);
      const raw = input.Body;
      const buf = Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw as Uint8Array);
      objects.set(key, buf);
      return { ETag: '"mock-etag"' };
    });

    s3.on(GetObjectCommand).callsFake(async (input) => {
      const key = String(input.Key);
      const buf = objects.get(key);
      if (!buf) {
        throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      }
      return {
        Body: Readable.from([buf]) as never,
        ContentLength: buf.length,
      };
    });

    s3.on(DeleteObjectCommand).callsFake(async (input) => {
      objects.delete(String(input.Key));
      return {};
    });

    s3.on(ListObjectsV2Command).callsFake(async (input) => {
      const prefix = String(input.Prefix ?? '');
      const matching = [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((Key) => ({ Key }));
      return { Contents: matching };
    });

    s3.on(CreateMultipartUploadCommand).resolves({ UploadId: 'mp-1' });
    s3.on(UploadPartCommand).resolves({ ETag: '"part-1"' });

    applyTestEnv({
      STORAGE_DRIVER: 's3',
      STORAGE_S3_BUCKET: 'core-stateless-test',
      STORAGE_S3_ENDPOINT: 'http://127.0.0.1:9000',
    });
    const cfg = new CoreConfigService().storage.s3;
    const s3Driver = new S3StorageDriver(
      cfg,
      async () => ({ accessKeyId: 'a', secretAccessKey: 'b' }),
      new S3Client({ region: 'us-east-1' }),
    );

    const p0 = Buffer.from('hello-s3-part-0-');
    const p1 = Buffer.from('and-part-1!');
    const expectedHash = createHash('sha256')
      .update(Buffer.concat([p0, p1]))
      .digest('hex');

    await s3Driver.putChunkPart('uploads/2026/.tmp-chunk-1', 0, p0);
    await s3Driver.putChunkPart('uploads/2026/.tmp-chunk-1', 1, p1);
    expect(objects.has('uploads/2026/.tmp-chunk-1.part.000000')).toBe(true);
    expect(objects.has('uploads/2026/.tmp-chunk-1.part.000001')).toBe(true);

    const finalized = await s3Driver.finalizeChunkedParts(
      'uploads/2026/.tmp-chunk-1',
      2,
      'uploads/2026/assembled.bin',
      { contentType: 'application/octet-stream' },
    );

    expect(finalized).toEqual({
      checksumSha256: expectedHash,
      sizeBytes: p0.length + p1.length,
    });
    expect(objects.get('uploads/2026/assembled.bin')?.toString('utf8')).toBe(
      'hello-s3-part-0-and-part-1!',
    );
    expect(objects.has('uploads/2026/.tmp-chunk-1.part.000000')).toBe(false);
    expect(objects.has('uploads/2026/.tmp-chunk-1.part.000001')).toBe(false);

    // Kiểm tra abortChunkedParts dọn sạch các part còn sót qua ListObjectsV2
    await s3Driver.putChunkPart('uploads/2026/.tmp-abort', 0, p0);
    await s3Driver.putChunkPart('uploads/2026/.tmp-abort', 1, p1);
    await s3Driver.abortChunkedParts('uploads/2026/.tmp-abort');
    expect(objects.has('uploads/2026/.tmp-abort.part.000000')).toBe(false);
    expect(objects.has('uploads/2026/.tmp-abort.part.000001')).toBe(false);
  });
});
