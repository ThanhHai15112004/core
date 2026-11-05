import type { StorageDriverName } from '@packages/config/index.js';
import type { ObjectStream } from '../drivers/storage-driver.js';

export interface StorageFile {
  filename: string;
  buffer: Buffer;
  mimeType?: string;
  size?: number;
}

export interface StorageContract {
  readonly driverName: StorageDriverName;
  upload(path: string, content: Buffer | Uint8Array, mimeType?: string): Promise<string>;
  download(path: string): Promise<Buffer>;
  stream(path: string, range?: { start: number; end: number }): Promise<ObjectStream>;
  delete(path: string): Promise<void>;
  getUrl(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  appendChunk?(tempKey: string, chunk: Buffer): Promise<number>;
  finalizeChunkedUpload?(tempKey: string, targetKey: string, mimeType?: string): Promise<string>;
  abortChunkedUpload?(tempKey: string): Promise<void>;
}
