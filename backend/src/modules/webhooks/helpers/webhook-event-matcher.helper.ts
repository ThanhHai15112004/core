import { scanModuleManifests } from '@packages/kernel/index.js';
import type { WebhookEventCatalogItem } from '../types/webhooks.types.js';

const EVENT_PATTERN_REGEX = /^(\*|[a-z0-9-]+(?:\.[a-z0-9_-]+)*(?:\.\*)?)$/;

export function normalizeWebhookEventPatterns(patterns: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const raw of patterns) {
    const clean = raw.trim().toLowerCase();
    if (clean) {
      unique.add(clean);
    }
  }
  return [...unique];
}

export function isValidWebhookEventPattern(pattern: string): boolean {
  const clean = pattern.trim().toLowerCase();
  if (!clean || clean.length > 160) return false;
  return EVENT_PATTERN_REGEX.test(clean);
}

/**
 * Kiểm tra tên sự kiện có khớp với danh sách mẫu đăng ký hay không:
 * - `*`: nhận toàn bộ sự kiện
 * - `user.*`: nhận tất cả sự kiện có tiền tố `user.` (vd `user.created`, `user.updated`)
 * - `user.created`: khớp chính xác
 */
export function matchesWebhookEvent(patterns: readonly string[], eventName: string): boolean {
  const target = eventName.trim().toLowerCase();
  if (!target) return false;

  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim().toLowerCase();
    if (!pattern) continue;
    if (pattern === '*' || pattern === target) {
      return true;
    }
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -1); // giữ dấu "." ở cuối: "user."
      if (target.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Quét tập trung toàn bộ `module.manifest.json` thông qua `scanModuleManifests()` (`@packages/kernel`)
 * để tổng hợp danh mục sự kiện hệ thống có sẵn (vd `user.created`, `role.created`, ...).
 */
export function collectWebhookEventCatalog(): WebhookEventCatalogItem[] {
  const manifests = scanModuleManifests();
  const seen = new Set<string>();
  const items: WebhookEventCatalogItem[] = [];

  for (const entry of manifests) {
    const published = entry.raw.events?.published;
    if (!Array.isArray(published)) continue;
    const moduleDisplayName = entry.raw.displayName ?? entry.moduleName;
    for (const rawName of published) {
      if (typeof rawName !== 'string') continue;
      const eventName = rawName.trim().toLowerCase();
      if (!eventName || seen.has(eventName)) continue;
      seen.add(eventName);
      items.push({
        eventName,
        module: entry.moduleName,
        moduleDisplayName,
        description: `Event emitted by module ${moduleDisplayName}`,
      });
    }
  }

  return items.sort((a, b) => a.eventName.localeCompare(b.eventName));
}
