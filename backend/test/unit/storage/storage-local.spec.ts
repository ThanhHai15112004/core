import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LocalMonitoringProvider,
  LocalStorageDriver,
  buildUsageSnapshot,
  classifyStorageError,
  compareKeys,
  containerOf,
  growthSince,
  isValidKey,
  kindOf,
  type UsagePoint,
} from '@packages/storage/index.js';

const filter = {
  container: null,
  prefix: '',
  kind: null,
  minSize: null,
  maxSize: null,
  minAgeMs: null,
  maxAgeMs: null,
};

describe('LocalStorageDriver + LocalMonitoringProvider', () => {
  let dir: string;
  let driver: LocalStorageDriver;
  let provider: LocalMonitoringProvider;
  const put = (key: string, body = 'x') =>
    driver.put(key, Buffer.from(body), { contentType: 'text/plain' });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'core-storage-spec-'));
    driver = new LocalStorageDriver(path.join(dir, 'root'));
    provider = new LocalMonitoringProvider(driver);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('ghi file thật (không để lại file tạm), đọc, head, xoá', async () => {
    await put('uploads/a/b.txt', 'hello');
    expect((await driver.get('uploads/a/b.txt')).toString()).toBe('hello');
    expect(await fs.readdir(path.join(dir, 'root/uploads/a'))).toEqual(['b.txt']);
    expect(await driver.head('uploads/a/b.txt')).toMatchObject({
      size: 5,
      contentType: 'text/plain',
    });
    await driver.delete('uploads/a/b.txt');
    expect(await driver.head('uploads/a/b.txt')).toBeNull();
  });

  it('chặn path traversal và symlink thoát khỏi root', async () => {
    await expect(put('../escape.txt')).rejects.toMatchObject({ code: 'INVALID_KEY' });
    await expect(put('/abs.txt')).rejects.toMatchObject({ code: 'INVALID_KEY' });
    await fs.mkdir(path.join(dir, 'root'), { recursive: true });
    await fs.mkdir(path.join(dir, 'outside'));
    await fs.symlink(path.join(dir, 'outside'), path.join(dir, 'root', 'link'));
    await expect(put('link/x.txt')).rejects.toMatchObject({ code: 'INVALID_KEY' });
    expect(await fs.readdir(path.join(dir, 'outside'))).toEqual([]);
  });

  it('liệt kê theo cursor, đúng thứ tự, không trùng; lọc container và (root)', async () => {
    for (const k of ['a.txt', 'a/b.txt', 'a/c/d.txt', 'b/e.png', 'z.json']) await put(k);
    const all: string[] = [];
    let cursor = '';
    do {
      const page = await provider.listPage(filter, cursor, 2);
      all.push(...page.objects.map((o) => o.key));
      cursor = page.cursor;
    } while (cursor);
    expect(all).toEqual(['a/b.txt', 'a/c/d.txt', 'a.txt', 'b/e.png', 'z.json']);
    expect([...all].sort(compareKeys)).toEqual(all);
    const inA = await provider.listPage({ ...filter, container: 'a' }, '', 10);
    expect(inA.objects.map((o) => o.key)).toEqual(['a/b.txt', 'a/c/d.txt']);
    const root = await provider.listPage({ ...filter, container: '(root)' }, '', 10);
    expect(root.objects.map((o) => o.key)).toEqual(['a.txt', 'z.json']);
    const images = await provider.listPage({ ...filter, kind: 'image' }, '', 10);
    expect(images.objects.map((o) => o.key)).toEqual(['b/e.png']);
  });

  it('quét usage và capacity thật của filesystem', async () => {
    await put('uploads/1.png', '12345');
    await put('docs/2.pdf', '123');
    const scan = await provider.scan(100);
    expect(scan).toMatchObject({ total: 2, truncated: false });
    const cap = await provider.capacity();
    expect(cap.source).toBe('filesystem');
    expect(cap.totalBytes).toBeGreaterThan(0);
    await expect(provider.signedUrl()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});

describe('usage & tiện ích', () => {
  it('gom usage theo container, loại file, tuổi, object lớn nhất', () => {
    const now = Date.UTC(2026, 8, 22, 12);
    const s = buildUsageSnapshot({
      objects: [
        { key: 'uploads/a.png', size: 100, lastModified: now - 1000, contentType: null },
        {
          key: 'uploads/b.mp4',
          size: 5000,
          lastModified: now - 10 * 86_400_000,
          contentType: null,
        },
        { key: 'readme.txt', size: 10, lastModified: null, contentType: null },
      ],
      total: 3,
      truncated: false,
      driver: 'local',
      at: now,
      startOfDay: now - 3600_000,
      durationMs: 1,
    });
    expect(s.totalBytes).toBe(5110);
    expect(s.createdToday).toBe(1);
    expect(s.containers[0]).toMatchObject({
      name: 'uploads',
      objects: 2,
      bytes: 5100,
      createdToday: 1,
    });
    expect(s.containers[0]!.byKind).toMatchObject({ image: { objects: 1 }, video: { objects: 1 } });
    expect(s.byKind.text.objects).toBe(1);
    expect(s.byAge.lt1d.objects).toBe(1);
    expect(s.byAge.unknown.objects).toBe(1);
    expect(s.largest[0]!.key).toBe('uploads/b.mp4');
  });

  it('tăng trưởng từ điểm lịch sử gần nhất trước mốc', () => {
    const points: UsagePoint[] = [
      { at: 3000, bytes: 300, objects: 3, containers: {} },
      { at: 1000, bytes: 100, objects: 1, containers: {} },
    ];
    expect(growthSince(points, { bytes: 500, objects: 5 }, 2000)).toEqual({
      bytes: 400,
      objects: 4,
      from: 1000,
    });
    expect(growthSince(points, { bytes: 500, objects: 5 }, 500)).toBeNull();
  });

  it('key hợp lệ, container, loại file, phân loại lỗi', () => {
    expect(isValidKey('a/b.txt')).toBe(true);
    for (const bad of ['', '../a', 'a/../b', '/a', 'a//b', 'a/', 'a\nb'])
      expect(isValidKey(bad)).toBe(false);
    expect(containerOf('uploads/x/y.png')).toBe('uploads');
    expect(containerOf('file.txt')).toBe('(root)');
    expect(kindOf('x.bin', 'image/png')).toBe('image');
    expect(kindOf('report.pdf')).toBe('document');
    expect(classifyStorageError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(
      'not_found',
    );
    expect(classifyStorageError({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })).toBe(
      'permission',
    );
    expect(classifyStorageError({ name: 'SlowDown' })).toBe('throttled');
    expect(classifyStorageError(Object.assign(new Error('x'), { code: 'ENOSPC' }))).toBe(
      'no_space',
    );
    expect(
      classifyStorageError(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      ),
    ).toBe('connection');
  });
});
