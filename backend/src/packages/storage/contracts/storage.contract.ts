export interface StorageFile {
  filename: string;
  buffer: Buffer;
  mimeType?: string;
  size?: number;
}

export interface StorageContract {
  upload(path: string, content: Buffer | Uint8Array, mimeType?: string): Promise<string>;
  download(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  getUrl(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}
