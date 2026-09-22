import { promises as fs } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { HEALTHCHECK_PREFIX } from '../constants/storage.keys.js';
import { LOCAL_TMP_PREFIX, type LocalStorageDriver } from '../drivers/local-storage.driver.js';
import { ROOT_CONTAINER, containerOf, kindOf, mimeOf } from '../utils/object-kind.js';
import { StorageObjectError } from '../utils/storage-errors.js';
import { matchesFilter } from './usage.js';
import type {
  Capacity,
  LifecycleInfo,
  MultipartUpload,
  ObjectDetail,
  ObjectFilter,
  ObjectPage,
  ProviderInfo,
  ScannedObject,
  StorageCapability,
  StorageMonitoringProvider,
} from './monitoring.types.js';

/** Số entry tối đa duyệt cho một trang Object Explorer (lọc chặt thì trang có thể ít hơn). */
const PAGE_MAX_EXAMINED = 20_000;

/** So sánh key theo từng segment — trùng thứ tự duyệt cây thư mục (đã sort tên). */
export function compareKeys(a: string, b: string): number {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  }
  return x.length - y.length;
}

const skip = (name: string) => name.startsWith(LOCAL_TMP_PREFIX);

/**
 * Theo dõi storage local: duyệt thư mục có thứ tự + cursor (key cuối đã trả), capacity thật của
 * filesystem (`statfs`). Không có bucket/multipart/signed URL/lifecycle.
 */
export class LocalMonitoringProvider implements StorageMonitoringProvider {
  public readonly capabilities: ReadonlySet<StorageCapability> = new Set<StorageCapability>([
    'listObjects',
    'usage',
    'capacity',
    'containers',
    'download',
    'preview',
  ]);

  constructor(private readonly driver: LocalStorageDriver) {}

  public info(): ProviderInfo {
    return {
      driver: 'local',
      product: 'Local Filesystem',
      location: this.driver.root,
      endpoint: null,
      region: null,
    };
  }

  public async ping(): Promise<number> {
    const started = performance.now();
    await this.driver.ping();
    return Number((performance.now() - started).toFixed(2));
  }

  /** Duyệt theo thứ tự (DFS, tên đã sort), bỏ qua nhánh toàn bộ ≤ cursor. */
  private async *walk(rel: string, after: string | null): AsyncGenerator<ScannedObject> {
    const dir = rel ? path.join(this.driver.root, rel) : this.driver.root;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return;
      throw err;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (skip(e.name)) continue;
      const key = rel ? `${rel}/${e.name}` : e.name;
      if (key === HEALTHCHECK_PREFIX.slice(0, -1)) continue;
      if (e.isDirectory()) {
        // Mọi key trong nhánh đều < cursor → bỏ qua cả nhánh.
        if (after !== null) {
          const depth = key.split('/').length;
          const cursorHead = after.split('/').slice(0, depth).join('/');
          if (compareKeys(key, cursorHead) < 0) continue;
        }
        yield* this.walk(key, after);
      } else if (e.isFile()) {
        if (after !== null && compareKeys(key, after) <= 0) continue;
        const stat = await fs.stat(path.join(dir, e.name)).catch(() => null);
        if (!stat) continue;
        yield { key, size: stat.size, lastModified: stat.mtimeMs, contentType: mimeOf(key) };
      }
    }
  }

  public async scan(limit: number) {
    const objects: ScannedObject[] = [];
    let total = 0;
    for await (const o of this.walk('', null)) {
      total++;
      if (objects.length < limit) objects.push(o);
      else if (total >= limit * 5) break;
    }
    return { objects, total, truncated: total > objects.length };
  }

  public async listPage(filter: ObjectFilter, cursor: string, count: number): Promise<ObjectPage> {
    const now = Date.now();
    const objects: ScannedObject[] = [];
    let examined = 0;
    let last = cursor || null;
    const base = filter.container && filter.container !== ROOT_CONTAINER ? filter.container : '';
    const source =
      filter.container === ROOT_CONTAINER
        ? this.rootFiles(cursor || null)
        : this.walk(base, cursor || null);
    let exhausted = true;
    for await (const o of source) {
      examined++;
      last = o.key;
      const rel = base ? o.key.slice(base.length + 1) : o.key;
      if ((!filter.prefix || rel.startsWith(filter.prefix)) && matchesFilter(o, filter, now))
        objects.push(o);
      if (objects.length >= count || examined >= PAGE_MAX_EXAMINED) {
        exhausted = false;
        break;
      }
    }
    return { objects, cursor: exhausted ? '' : (last ?? ''), examined };
  }

  private async *rootFiles(after: string | null): AsyncGenerator<ScannedObject> {
    for await (const o of this.walk('', after)) if (!o.key.includes('/')) yield o;
  }

  public async detail(key: string): Promise<ObjectDetail | null> {
    const meta = await this.driver.head(key);
    if (!meta) return null;
    return {
      ...meta,
      container: containerOf(key),
      kind: kindOf(key, meta.contentType),
      versions: null,
      retention: null,
    };
  }

  public async capacity(): Promise<Capacity> {
    const s = await fs.statfs(this.driver.root);
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize, source: 'filesystem' };
  }

  public async multipart(): Promise<MultipartUpload[]> {
    throw new StorageObjectError('UNSUPPORTED', 'multipart');
  }

  public async lifecycle(): Promise<LifecycleInfo> {
    throw new StorageObjectError('UNSUPPORTED', 'lifecycle');
  }

  public async abortMultipart(): Promise<void> {
    throw new StorageObjectError('UNSUPPORTED', 'multipart');
  }

  public async signedUrl(): Promise<string> {
    throw new StorageObjectError('UNSUPPORTED', 'signedUrl');
  }

  public async readHead(key: string, bytes: number): Promise<Buffer> {
    const handle = await fs.open(await this.driver.resolve(key), 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}
