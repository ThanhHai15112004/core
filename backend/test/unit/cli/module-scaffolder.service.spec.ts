import { describe, it, expect } from '@jest/globals';
import { ModuleScaffolderService } from '../../../src/apps/cli/services/module-scaffolder.service.js';
import { ManifestService } from '../../../src/apps/cli/services/manifest.service.js';

describe('ModuleScaffolderService', () => {
  const manifestService = new ManifestService();
  const scaffolder = new ModuleScaffolderService(manifestService);

  /** Kiểm thử hàm định dạng tên module dạng kebab thành camel, pascal, constant và title case */
  it('correctly formats names to camel, pascal, constant, title', () => {
    const names = scaffolder.formatNames('order-tracking');
    expect(names.kebab).toBe('order-tracking');
    expect(names.camel).toBe('orderTracking');
    expect(names.pascal).toBe('OrderTracking');
    expect(names.constant).toBe('ORDER_TRACKING');
    expect(names.title).toBe('Order Tracking');
  });

  /** Kiểm thử định dạng tên module chỉ gồm một từ đơn lẻ */
  it('handles single word module names', () => {
    const names = scaffolder.formatNames('billing');
    expect(names.kebab).toBe('billing');
    expect(names.camel).toBe('billing');
    expect(names.pascal).toBe('Billing');
    expect(names.constant).toBe('BILLING');
    expect(names.title).toBe('Billing');
  });
});
