import type { Readable } from 'node:stream';
import type { StorageDriverName } from '@packages/config/index.js';

export interface ObjectMeta {
  key: string;
  size: number;
  contentType: string | null;
  /** epoch ms */
  lastModified: number | null;
  /** epoch ms — local: birthtime; S3 không có (null). */
  createdAt: number | null;
  etag: string | null;
  storageClass: string | null;
  versionId: string | null;
  checksum: string | null;
}

export interface PutOptions {
  contentType: string;
  onProgress?: (sentBytes: number) => void;
}

export interface ObjectStream {
  body: Readable;
  size: number | null;
  contentType: string | null;
}

/** Lưu trữ thật phía sau `BaseStorageProvider`. Key là đường dẫn tương đối (đã kiểm tra hợp lệ). */
export interface StorageDriver {
  readonly name: StorageDriverName;
  put(key: string, body: Buffer, opts: PutOptions): Promise<{ multipart: boolean }>;
  get(key: string): Promise<Buffer>;
  stream(key: string, range?: { start: number; end: number }): Promise<ObjectStream>;
  delete(key: string, versionId?: string): Promise<void>;
  /** null khi object không tồn tại. */
  head(key: string): Promise<ObjectMeta | null>;
  /** Kiểm tra kết nối/quyền cơ bản (local: stat root; S3: HeadBucket). */
  ping(): Promise<void>;
  url(key: string): string;
}
