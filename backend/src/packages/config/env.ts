import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Tự động tìm và nạp các file .env dựa trên NODE_ENV
 */
export function loadEnvironmentFiles(cwd: string = process.cwd()): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRootDir = path.resolve(currentDir, '../../..');
  const nodeEnv = process.env.NODE_ENV || 'development';

  const filesToTry = [
    path.resolve(backendRootDir, `.env.${nodeEnv}`),
    path.resolve(cwd, `.env.${nodeEnv}`),
    path.resolve(backendRootDir, '.env'),
    path.resolve(cwd, '.env'),
  ];

  for (const filePath of filesToTry) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) {
          continue;
        }
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // Bỏ qua lỗi đọc file không hợp lệ
    }
  }
}

// Tự động kích hoạt nạp biến môi trường khi module được import
loadEnvironmentFiles();

/**
 * Đọc biến môi trường dạng string.
 * Mặc định bắt buộc phải có (required = true) để chống silent fallback.
 */
export function env(key: string, required: boolean = true): string {
  const value = process.env[key];
  if (required && (value === undefined || value.trim() === '')) {
    throw new Error(
      `[ConfigError] Biến môi trường [${key}] bắt buộc phải có nhưng chưa được định nghĩa trong file .env!`,
    );
  }
  return value ?? '';
}

/**
 * Đọc biến môi trường dạng number
 */
env.number = (key: string, required: boolean = true): number => {
  const val = env(key, required);
  if (!val && !required) {
    return 0;
  }
  const num = Number(val);
  if (isNaN(num)) {
    throw new Error(
      `[ConfigError] Biến môi trường [${key}] phải là một số hợp lệ, nhận được: "${val}"`,
    );
  }
  return num;
};

/**
 * Đọc biến môi trường dạng boolean
 */
env.boolean = (key: string, required: boolean = true): boolean => {
  const val = env(key, required);
  if (!val && !required) {
    return false;
  }
  const lower = val.toLowerCase();
  if (lower === 'true' || lower === '1') {
    return true;
  }
  if (lower === 'false' || lower === '0') {
    return false;
  }
  throw new Error(
    `[ConfigError] Biến môi trường [${key}] phải là kiểu boolean (true/false/1/0), nhận được: "${val}"`,
  );
};
