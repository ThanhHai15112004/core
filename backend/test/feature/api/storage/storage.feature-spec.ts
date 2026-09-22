import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { STORAGE_OPS_ROUTES } from '@modules/storage-ops/index.js';
import { BaseStorageProvider, StorageConnectionService } from '@packages/storage/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${STORAGE_OPS_ROUTES.PREFIX}`;
const ENV = {
  OPS_STORAGE_DELETE_ENABLED: 'true',
  OPS_STORAGE_DOWNLOAD_ENABLED: 'true',
  OPS_STORAGE_PREVIEW_ENABLED: 'false',
  OPS_STORAGE_SIGNED_URL_ENABLED: 'true',
  STORAGE_DRIVER: 'local',
};

/** Storage Monitor trên filesystem thật (thư mục tạm): số liệu từ object ghi qua BaseStorageProvider. */
describe('Storage Monitor (/ops/storage) — local', () => {
  let context: TestAppContext;
  let dir: string;
  const saved: Record<string, string | undefined> = {};

  const call = async <T>(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => {
    const res = await context.app.inject({
      method,
      url,
      headers: { 'accept-language': 'vi' },
      ...(payload ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.json<Envelope<T>>(), raw: res };
  };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'core-storage-feature-'));
    for (const [k, v] of Object.entries({ ...ENV, STORAGE_LOCAL_PATH: dir })) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    context = await createTestApp();
    await context.app.get(StorageConnectionService).check();
    const storage = context.app.get(BaseStorageProvider);
    await storage.upload('uploads/users/1/avatar.png', Buffer.alloc(2048, 1));
    await storage.upload('uploads/report.pdf', Buffer.alloc(4096, 2));
    await storage.upload('exports/users.csv', Buffer.from('id,email\n1,a@b.co\n'));
    await storage.upload('readme.txt', Buffer.from('hello'));
    await storage.download('uploads/report.pdf');
    await storage.download('uploads/missing.pdf').catch(() => undefined);
  });

  afterAll(async () => {
    await context.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('overview: provider local, sức khoẻ, usage & capacity thật', async () => {
    const { status, body } = await call<{
      provider: { driver: string; product: string };
      health: { status: string };
      kpis: { usedBytes: number; objects: number; containers: number };
      capacity: { available: boolean; data: { source: string; totalBytes: number } };
      settings: { signedUrl: boolean; preview: boolean };
    }>('GET', `${base}/overview?range=15m`);
    expect(status).toBe(200);
    expect(body.data.provider).toMatchObject({ driver: 'local', product: 'Local Filesystem' });
    expect(body.data.health.status).toBe('healthy');
    expect(body.data.kpis).toMatchObject({ objects: 4, containers: 3 });
    expect(body.data.kpis.usedBytes).toBe(2048 + 4096 + 18 + 5);
    expect(body.data.capacity.data.source).toBe('filesystem');
    // Local không có signed URL dù env bật.
    expect(body.data.settings).toMatchObject({ signedUrl: false, preview: false });
  });

  it('containers, object explorer (cursor), chi tiết, lỗi', async () => {
    const c = await call<{ containers: { name: string; objects: number }[] }>(
      'GET',
      `${base}/containers`,
    );
    expect(c.body.data.containers.map((x) => x.name).sort()).toEqual([
      '(root)',
      'exports',
      'uploads',
    ]);

    const p1 = await call<{ objects: { data: { key: string }[] }; cursor: string; done: boolean }>(
      'GET',
      `${base}/objects?container=uploads&count=10`,
    );
    expect(p1.body.data.objects.data.map((o) => o.key)).toEqual([
      'uploads/report.pdf',
      'uploads/users/1/avatar.png',
    ]);
    expect(p1.body.data.done).toBe(true);

    const d = await call<{ size: number; kind: string; contentType: string; versions: unknown }>(
      'GET',
      `${base}/objects/detail?key=${encodeURIComponent('uploads/report.pdf')}`,
    );
    expect(d.body.data).toMatchObject({
      size: 4096,
      kind: 'document',
      contentType: 'application/pdf',
      versions: null,
    });

    const e = await call<{ counts: { not_found: number }; items: { key: string; code: string }[] }>(
      'GET',
      `${base}/errors`,
    );
    expect(e.body.data.items[0]).toMatchObject({ key: 'uploads/missing.pdf', code: 'ENOENT' });
  });

  it('download stream + audit; delete cần xác nhận; preview đang tắt; test storage', async () => {
    const dl = await context.app.inject({
      method: 'GET',
      url: `${base}/objects/download?key=readme.txt`,
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe('hello');
    expect(dl.headers['content-disposition']).toContain('readme.txt');

    expect((await call('DELETE', `${base}/objects?key=readme.txt`, { confirm: 'NO' })).status).toBe(
      400,
    );
    expect(
      (
        await call<{ action: string }>('DELETE', `${base}/objects?key=readme.txt`, {
          confirm: 'DELETE',
        })
      ).body.data.action,
    ).toBe('delete_object');
    expect(
      (await call('DELETE', `${base}/objects?key=readme.txt`, { confirm: 'DELETE' })).status,
    ).toBe(404);

    const pv = await call('GET', `${base}/objects/preview?key=exports/users.csv`);
    expect(pv.status).toBe(409);
    expect(pv.body.error?.code).toBe('STORAGE_PREVIEW_DISABLED');

    const t = await call<{ ok: boolean; steps: { step: string }[] }>('POST', `${base}/test`);
    expect(t.body.data.ok).toBe(true);

    const ops = await call<{ action: string }[]>('GET', `${base}/operations`);
    expect(ops.body.data.map((o) => o.action)).toEqual(['test', 'delete_object', 'download']);
  });

  it('validation, traversal bị chặn, cấu hình không lộ credentials', async () => {
    expect(
      (await call('GET', `${base}/objects/detail?key=${encodeURIComponent('../etc/passwd')}`))
        .status,
    ).toBe(400);
    expect((await call('GET', `${base}/overview?range=2d`)).status).toBe(400);
    expect((await call('GET', `${base}/containers/${encodeURIComponent('a/b')}`)).status).toBe(400);
    const cfg = await call<{ items: { key: string; value: unknown }[] }>('GET', `${base}/config`);
    expect(cfg.body.data.items.find((i) => i.key === 'root')!.value).toBe(dir);
    expect(JSON.stringify(cfg.body.data)).not.toMatch(/accessKey|secretKey|SECRET_KEY|ACCESS_KEY/);
    const lc = await call<{ lifecycle: { available: boolean; reason: string } }>(
      'GET',
      `${base}/lifecycle`,
    );
    expect(lc.body.data.lifecycle).toMatchObject({ available: false, reason: 'unsupported' });
  });
});
