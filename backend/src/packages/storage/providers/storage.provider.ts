import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import type { StorageContract } from '../contracts/storage.contract.js';

@Injectable()
export class BaseStorageProvider implements StorageContract {
  private readonly memoryStorage = new Map<string, Buffer>();
  private readonly driver: string;
  private readonly localPath: string;

  constructor(private readonly configService: CoreConfigService) {
    this.driver = this.configService.storage.driver;
    this.localPath = this.configService.storage.localPath;
  }

  public async upload(path: string, content: Buffer | Uint8Array): Promise<string> {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    this.memoryStorage.set(path, buf);
    return path;
  }

  public async download(path: string): Promise<Buffer> {
    const file = this.memoryStorage.get(path);
    if (!file) {
      throw new Error(`[StorageError] File not found at path: ${path} (driver: ${this.driver})`);
    }
    return file;
  }

  public async delete(path: string): Promise<void> {
    this.memoryStorage.delete(path);
  }

  public async getUrl(path: string): Promise<string> {
    return `${this.localPath}/${path}`;
  }

  public async exists(path: string): Promise<boolean> {
    return this.memoryStorage.has(path);
  }
}
