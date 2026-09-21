import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Optional } from '@nestjs/common';
import type { SecretProvider } from '../contracts/secret-provider.contract.js';

@Injectable()
export class FileSecretProvider implements SecretProvider {
  private readonly secretDir: string;

  constructor(@Optional() customDir?: string) {
    if (customDir) {
      this.secretDir = path.resolve(customDir);
    } else if (process.env.SECRET_DIR) {
      this.secretDir = path.resolve(process.env.SECRET_DIR);
    } else if (fs.existsSync('/run/secrets')) {
      // Chuẩn Linux Docker Swarm / Kubernetes Secrets mount
      this.secretDir = '/run/secrets';
    } else {
      // Local development fallback
      this.secretDir = path.resolve(process.cwd(), 'secrets');
    }
  }

  public getSecretDir(): string {
    return this.secretDir;
  }

  public async getSecret(key: string): Promise<string | null> {
    if (!key) return null;

    if (!fs.existsSync(this.secretDir)) {
      return null;
    }

    // Các biến thể tên file có thể có
    const candidates = this.generateKeyCandidates(key);

    for (const candidate of candidates) {
      const filePath = path.join(this.secretDir, candidate);
      try {
        if (fs.existsSync(filePath)) {
          const content = await fsp.readFile(filePath, 'utf8');
          return content.trim();
        }
      } catch {
        // Tiếp tục thử candidate khác nếu gặp lỗi truy cập file
        continue;
      }
    }

    return null;
  }

  public async getSecretsByPrefix(prefix: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    if (!fs.existsSync(this.secretDir)) {
      return result;
    }

    try {
      const files = await fsp.readdir(this.secretDir);
      const normalizedPrefix = prefix.toLowerCase().replace(/[.-]/g, '_');

      for (const file of files) {
        const normalizedFile = file.toLowerCase().replace(/[.-]/g, '_');
        if (normalizedFile.startsWith(normalizedPrefix)) {
          const filePath = path.join(this.secretDir, file);
          try {
            const stat = await fsp.stat(filePath);
            if (stat.isFile()) {
              const content = await fsp.readFile(filePath, 'utf8');
              result[file] = content.trim();
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      return result;
    }

    return result;
  }

  private generateKeyCandidates(key: string): string[] {
    const direct = key;
    const decamel = key.replace(/([a-z\d])([A-Z])/g, '$1_$2');
    const lowerSnake = decamel.toLowerCase().replace(/[.-]/g, '_');
    const upperSnake = decamel.toUpperCase().replace(/[.-]/g, '_');
    const kebab = decamel.toLowerCase().replace(/[._]/g, '-');

    return Array.from(new Set([direct, decamel, lowerSnake, upperSnake, kebab]));
  }
}
