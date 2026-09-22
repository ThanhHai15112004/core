import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isValidKey, mimeOf } from '../utils/object-kind.js';
import { StorageObjectError } from '../utils/storage-errors.js';
import type { ObjectMeta, ObjectStream, PutOptions, StorageDriver } from './storage-driver.js';

/** File tạm khi ghi (rename nguyên tử) — bị bỏ qua khi liệt kê. */
export const LOCAL_TMP_PREFIX = '.tmp-';

/**
 * Lưu file thật dưới `root`. Mọi key đều được kiểm tra: tương đối, không `..`,
 * và thư mục thật (sau khi giải symlink) phải nằm trong root.
 */
export class LocalStorageDriver implements StorageDriver {
  public readonly name = 'local' as const;
  public readonly root: string;

  constructor(localPath: string) {
    this.root = path.resolve(localPath);
  }

  private async realRoot(): Promise<string> {
    await fs.mkdir(this.root, { recursive: true });
    return fs.realpath(this.root);
  }

  /** Đường dẫn tuyệt đối an toàn của key (ném INVALID_KEY nếu thoát khỏi root). */
  public async resolve(key: string, createDir = false): Promise<string> {
    if (!isValidKey(key)) throw new StorageObjectError('INVALID_KEY', `Invalid key: ${key}`);
    const root = await this.realRoot();
    const full = path.join(root, key);
    const dir = path.dirname(full);
    if (createDir) await fs.mkdir(dir, { recursive: true });
    let realDir: string;
    try {
      realDir = await fs.realpath(dir);
    } catch {
      // Thư mục chưa tồn tại → object chắc chắn không tồn tại (không cần kiểm symlink).
      return full;
    }
    if (realDir !== root && !realDir.startsWith(root + path.sep))
      throw new StorageObjectError('INVALID_KEY', `Key escapes storage root: ${key}`);
    return full;
  }

  public async put(key: string, body: Buffer, opts: PutOptions): Promise<{ multipart: boolean }> {
    const full = await this.resolve(key, true);
    const tmp = path.join(
      path.dirname(full),
      `${LOCAL_TMP_PREFIX}${randomBytes(6).toString('hex')}`,
    );
    const handle = await fs.open(tmp, 'w');
    try {
      const CHUNK = 1024 * 1024;
      for (let i = 0; i < body.length; i += CHUNK) {
        await handle.write(body.subarray(i, i + CHUNK));
        opts.onProgress?.(Math.min(body.length, i + CHUNK));
      }
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tmp, full);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    return { multipart: false };
  }

  public async get(key: string): Promise<Buffer> {
    return fs.readFile(await this.resolve(key));
  }

  public async stream(key: string, range?: { start: number; end: number }): Promise<ObjectStream> {
    const full = await this.resolve(key);
    const stat = await fs.stat(full);
    if (!stat.isFile()) throw Object.assign(new Error(`Not a file: ${key}`), { code: 'ENOENT' });
    return {
      body: createReadStream(full, range),
      size: range ? Math.min(stat.size, range.end + 1) - range.start : stat.size,
      contentType: mimeOf(key),
    };
  }

  public async delete(key: string): Promise<void> {
    await fs.unlink(await this.resolve(key));
  }

  public async head(key: string): Promise<ObjectMeta | null> {
    try {
      const stat = await fs.lstat(await this.resolve(key));
      if (!stat.isFile()) return null;
      return {
        key,
        size: stat.size,
        contentType: mimeOf(key),
        lastModified: stat.mtimeMs,
        createdAt: stat.birthtimeMs || null,
        etag: null,
        storageClass: null,
        versionId: null,
        checksum: null,
      };
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      throw err;
    }
  }

  public async ping(): Promise<void> {
    const root = await this.realRoot();
    await fs.access(root, fs.constants.R_OK | fs.constants.W_OK);
  }

  public url(key: string): string {
    return path.join(this.root, key);
  }
}
