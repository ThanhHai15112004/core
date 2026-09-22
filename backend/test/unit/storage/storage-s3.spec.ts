import { describe, it, expect, beforeEach } from '@jest/globals';
import { mockClient } from 'aws-sdk-client-mock';
import {
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  GetObjectLockConfigurationCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3MonitoringProvider, S3StorageDriver } from '@packages/storage/index.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { CoreConfigService } from '@packages/config/index.js';

const filter = {
  container: null,
  prefix: '',
  kind: null,
  minSize: null,
  maxSize: null,
  minAgeMs: null,
  maxAgeMs: null,
};

describe('S3 driver + monitoring provider (SDK mock)', () => {
  const s3 = mockClient(S3Client);
  let provider: S3MonitoringProvider;
  let driver: S3StorageDriver;

  beforeEach(() => {
    s3.reset();
    applyTestEnv({
      STORAGE_DRIVER: 's3',
      STORAGE_S3_BUCKET: 'core-dev',
      STORAGE_S3_ENDPOINT: 'http://127.0.0.1:1',
    });
    const cfg = new CoreConfigService().storage;
    driver = new S3StorageDriver(
      cfg.s3,
      async () => ({ accessKeyId: 'a', secretAccessKey: 'b' }),
      new S3Client({}),
    );
    provider = new S3MonitoringProvider(driver, cfg);
    delete process.env['STORAGE_DRIVER'];
  });

  it('phân trang ListObjectsV2 theo continuation token, lọc prefix container, bỏ object healthcheck', async () => {
    s3.on(ListObjectsV2Command, { Prefix: 'uploads/' })
      .resolvesOnce({
        Contents: [
          { Key: 'uploads/a.png', Size: 10, LastModified: new Date() },
          { Key: 'uploads/', Size: 0 },
        ],
        IsTruncated: true,
        NextContinuationToken: 't1',
      })
      .resolvesOnce({ Contents: [{ Key: 'uploads/b.txt', Size: 5 }], IsTruncated: false });
    const page = await provider.listPage({ ...filter, container: 'uploads' }, '', 100);
    expect(page.objects.map((o) => o.key)).toEqual(['uploads/a.png', 'uploads/b.txt']);
    expect(page.cursor).toBe('');

    s3.on(ListObjectsV2Command, {}).resolves({
      Contents: [
        { Key: '.core-healthcheck/x.txt', Size: 1 },
        { Key: 'z.txt', Size: 1 },
      ],
    });
    const scan = await provider.scan(10);
    expect(scan.objects.map((o) => o.key)).toEqual(['z.txt']);
  });

  it('head 404 → null; lifecycle/versioning/object lock chỉ đọc', async () => {
    s3.on(HeadObjectCommand).rejects(
      Object.assign(new Error('NotFound'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    expect(await driver.head('missing.txt')).toBeNull();
    s3.on(GetBucketLifecycleConfigurationCommand).resolves({
      Rules: [
        {
          ID: 'temp-cleanup',
          Status: 'Enabled',
          Filter: { Prefix: 'temp/' },
          Expiration: { Days: 7 },
        },
      ],
    });
    s3.on(GetBucketVersioningCommand).resolves({ Status: 'Enabled' });
    s3.on(GetObjectLockConfigurationCommand).rejects(
      Object.assign(new Error('x'), { name: 'ObjectLockConfigurationNotFoundError' }),
    );
    expect(await provider.lifecycle()).toEqual({
      rules: [
        {
          id: 'temp-cleanup',
          status: 'enabled',
          prefix: 'temp/',
          actions: [{ type: 'expire', days: 7, storageClass: null }],
        },
      ],
      versioning: 'enabled',
      objectLock: false,
    });
  });

  it('multipart dở: số part và dung lượng đã tải; capacity không biết khi không cấu hình', async () => {
    s3.on(ListMultipartUploadsCommand).resolves({
      Uploads: [
        { Key: 'video/a.mp4', UploadId: 'u1', Initiated: new Date(Date.now() - 2 * 3600_000) },
      ],
    });
    s3.on(ListPartsCommand).resolves({ Parts: [{ Size: 100 }, { Size: 50 }] });
    expect(await provider.multipart()).toMatchObject([
      { key: 'video/a.mp4', container: 'video', parts: 2, uploadedBytes: 150 },
    ]);
    expect(await provider.capacity()).toEqual({ totalBytes: null, freeBytes: null, source: null });
    expect(provider.info()).toMatchObject({
      driver: 's3',
      product: 'S3-compatible',
      location: 'core-dev',
    });
  });
});
