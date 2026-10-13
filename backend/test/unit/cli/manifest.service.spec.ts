import { describe, it, expect } from '@jest/globals';
import { ManifestService } from '../../../src/apps/cli/services/manifest.service.js';

describe('ManifestService', () => {
  const service = new ManifestService();

  /** Kiểm thử việc tìm đường dẫn gốc backend và đọc tệp project.manifest.json */
  it('locates backend root and reads project manifest', async () => {
    const root = service.getBackendRoot();
    expect(root).toBeDefined();

    const manifest = await service.loadProjectManifest();
    expect(manifest.name).toBe('core-backend');
    expect(manifest.enabledModules).toBeInstanceOf(Array);
    expect(manifest.enabledModules.length).toBeGreaterThan(0);
  });

  /** Kiểm thử việc tự động quét phát hiện tất cả các module và nạp module manifest */
  it('discovers modules and loads their manifests', async () => {
    const modules = await service.discoverAllModules();
    expect(modules.length).toBeGreaterThan(0);

    const healthModule = modules.find((m) => m.name === 'health');
    expect(healthModule).toBeDefined();
    expect(healthModule?.type).toBe('core');
    expect(healthModule?.isEnabled).toBe(true);
    expect(healthModule?.manifest.name).toBe('health');
  });
});
