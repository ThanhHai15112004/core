import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
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
  private readonly cdnUrl: string | null;

  constructor(localPath: string, cdnUrl: string | null = null) {
    this.root = path.resolve(localPath);
    this.cdnUrl = cdnUrl ? cdnUrl.trim().replace(/\/+$/, '') : null;
  }

  /** Xác định đường dẫn thư mục gốc thực tế trên đĩa cứng */
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

  /** Lưu trữ một đối tượng hoặc tệp tin vào hệ thống lưu trữ */
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

  /** Lấy dữ liệu hoặc đối tượng theo khóa định danh */
  public async get(key: string): Promise<Buffer> {
    return fs.readFile(await this.resolve(key));
  }

  /** Mở luồng đọc dữ liệu (stream) của tệp tin lưu trữ */
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

  /** Xóa bản ghi khỏi hệ thống theo mã định danh */
  public async delete(key: string): Promise<void> {
    await fs.unlink(await this.resolve(key));
  }

  /** Lấy thông tin metadata của đối tượng lưu trữ mà không tải nội dung */
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

  /** Kiểm tra trạng thái sẵn sàng và đo độ trễ kết nối */
  public async ping(): Promise<void> {
    const root = await this.realRoot();
    await fs.access(root, fs.constants.R_OK | fs.constants.W_OK);
  }

  /** Lấy đường dẫn URL truy cập công khai của tệp tin lưu trữ */
  public url(key: string): string {
    if (this.cdnUrl) {
      return `${this.cdnUrl}/${key.replace(/^\/+/, '')}`;
    }
    return path.join(this.root, key);
  }

  /** Ghi nối tiếp một mảnh dữ liệu (chunk) vào tệp tạm trên đĩa mà không giữ trong RAM */
  public async appendChunk(tempKey: string, chunk: Buffer): Promise<number> {
    const full = await this.resolve(tempKey, true);
    await fs.appendFile(full, chunk);
    const stat = await fs.stat(full);
    return stat.size;
  }

  /** Đổi tên nguyên tử từ tệp tạm sang khóa lưu trữ đích chính thức */
  public async finalizeTempObject(tempKey: string, targetKey: string): Promise<void> {
    const tempFull = await this.resolve(tempKey, false);
    const targetFull = await this.resolve(targetKey, true);
    try {
      await fs.rename(tempFull, targetFull);
    } catch (err) {
      await fs.rm(tempFull, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  /** Xóa tệp tạm khi hủy phiên hoặc khi phiên tải lên theo mảnh thất bại */
  public async abortTempObject(tempKey: string): Promise<void> {
    const tempFull = await this.resolve(tempKey, false);
    await fs.rm(tempFull, { force: true }).catch(() => undefined);
  }

  private partKey(tempPrefix: string, chunkIndex: number): string {
    return `${tempPrefix}.part.${String(chunkIndex).padStart(6, '0')}`;
  }

  /** Ghi một mảnh dữ liệu độc lập (`<tempPrefix>.part.XXXXXX`) xuống local disk. */
  public async putChunkPart(
    tempPrefix: string,
    chunkIndex: number,
    chunk: Buffer,
  ): Promise<number> {
    await this.put(this.partKey(tempPrefix, chunkIndex), chunk, {
      contentType: 'application/octet-stream',
    });
    return chunk.length;
  }

  /** Ghép các mảnh `.part.*` theo thứ tự vào file đích, tính SHA-256 streaming và dọn `.part.*`. */
  public async finalizeChunkedParts(
    tempPrefix: string,
    totalChunks: number,
    targetKey: string,
  ): Promise<{ checksumSha256: string; sizeBytes: number }> {
    const targetFull = await this.resolve(targetKey, true);
    const tmp = path.join(
      path.dirname(targetFull),
      `${LOCAL_TMP_PREFIX}${randomBytes(6).toString('hex')}`,
    );
    const hash = createHash('sha256');
    let sizeBytes = 0;

    const handle = await fs.open(tmp, 'w');
    try {
      for (let i = 0; i < totalChunks; i++) {
        const partFull = await this.resolve(this.partKey(tempPrefix, i), false);
        const stream = createReadStream(partFull);
        for await (const piece of stream) {
          const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
          hash.update(buf);
          sizeBytes += buf.length;
          await handle.write(buf);
        }
      }
    } catch (err) {
      await handle.close().catch(() => undefined);
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
    await handle.close();

    try {
      await fs.rename(tmp, targetFull);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }

    await this.abortChunkedParts(tempPrefix, totalChunks);
    return {
      checksumSha256: hash.digest('hex'),
      sizeBytes,
    };
  }

  /** Xóa các mảnh `.part.*` trên local disk. */
  public async abortChunkedParts(tempPrefix: string, totalChunks?: number): Promise<void> {
    if (typeof totalChunks === 'number' && totalChunks > 0) {
      await Promise.all(
        Array.from({ length: totalChunks }, async (_, idx) => {
          const partFull = await this.resolve(this.partKey(tempPrefix, idx), false).catch(() => null);
          if (partFull) await fs.rm(partFull, { force: true }).catch(() => undefined);
        }),
      );
      return;
    }
    try {
      const sampleFull = await this.resolve(`${tempPrefix}.part.000000`, false);
      const dir = path.dirname(sampleFull);
      const prefix = `${path.basename(tempPrefix)}.part.`;
      const entries = await fs.readdir(dir).catch(() => []);
      await Promise.all(
        entries
          .filter((name) => name.startsWith(prefix))
          .map((name) => fs.rm(path.join(dir, name), { force: true }).catch(() => undefined)),
      );
    } catch {
      // Best-effort cleanup
    }
  }
}
