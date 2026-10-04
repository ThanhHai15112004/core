import { describe, it, expect } from '@jest/globals';
import { CoreConfigService } from '@packages/config/index.js';
import { ConfigInspectorService } from '@packages/config/config-inspector.service.js';

describe('ConfigInspectorService', () => {
  it('duyệt cấu hình và tự động che các key nhạy cảm (password, secret, token)', () => {
    const configService = new CoreConfigService();
    const inspector = new ConfigInspectorService(configService);

    const all = inspector.inspectAll();
    expect(all.length).toBeGreaterThan(0);

    const sensitiveItems = all.filter((i) => i.sensitive);
    expect(sensitiveItems.length).toBeGreaterThan(0);

    for (const item of sensitiveItems) {
      if (item.value !== null && item.value !== undefined && item.value !== '') {
        expect(item.value).toBe('••••••••');
      }
    }

    const dbItems = inspector.inspectDomain('database');
    expect(dbItems.length).toBeGreaterThan(0);
    const passwordItem = dbItems.find((i) => i.key.toLowerCase().includes('password'));
    if (passwordItem && passwordItem.value) {
      expect(passwordItem.value).toBe('••••••••');
    }
  });
});
