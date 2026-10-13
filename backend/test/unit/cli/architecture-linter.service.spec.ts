import { describe, it, expect } from '@jest/globals';
import { ArchitectureLinterService } from '../../../src/apps/cli/services/architecture-linter.service.js';
import { ManifestService } from '../../../src/apps/cli/services/manifest.service.js';

describe('ArchitectureLinterService', () => {
  const manifestService = new ManifestService();
  const linter = new ArchitectureLinterService(manifestService);

  /** Kiểm thử việc quét mã nguồn và xác nhận không có bất kỳ tệp test nào đặt trong thư mục src/ (Rule 3) */
  it('scans codebase and ensures no tests in src/', async () => {
    const report = await linter.check();

    // Hệ thống hiện tại phải tuân thủ Rule 3 (No tests in src)
    const rule3Violations = report.violations.filter((v) => v.rule === 'RULE_3_NO_TEST_IN_SRC');
    expect(rule3Violations).toHaveLength(0);
    expect(report.totalFilesScanned).toBeGreaterThan(10);
  });

  /** Kiểm thử việc đảm bảo các package hạ tầng hoàn toàn độc lập và không import từ modules (Rule 2) */
  it('ensures packages do not import from modules (Rule 2)', async () => {
    const report = await linter.check();
    const rule2Violations = report.violations.filter((v) => v.rule === 'RULE_2_PACKAGES_PURITY');
    expect(rule2Violations).toHaveLength(0);
  });
});
