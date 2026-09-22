import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Phiên bản thật của package đã cài (đọc package.json), `null` nếu không tìm thấy. */
export function packageVersion(name: string): string | null {
  try {
    return (require(`${name}/package.json`) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/** "NestJS 11.1.0" — bỏ phần phiên bản nếu không đọc được. */
export function withVersion(label: string, pkg: string): string {
  const version = packageVersion(pkg);
  return version ? `${label} ${version}` : label;
}
