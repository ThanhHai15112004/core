import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { ArchitectureCommand } from '../../../src/apps/cli/commands/architecture/architecture.command.js';
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

  /** Kiểm thử việc đảm bảo không có lỗi hardcode cấu hình hoặc khóa setting chưa khai báo trong module.manifest.json (Rule 9) */
  it('ensures dynamic settings hygiene and no hardcoded module config (Rule 9)', async () => {
    const report = await linter.check();
    const rule9Violations = report.violations.filter(
      (v) => v.rule === 'RULE_9_CONFIG_AND_SETTINGS_HYGIENE',
    );
    expect(rule9Violations).toHaveLength(0);
    expect(report.passed).toBe(true);
  });

  /** Kiểm thử xuất báo cáo JSON của arch:check phục vụ tổng hợp CI Report */
  it('writes JSON report when ArchitectureCommand runs with --report', async () => {
    const command = new ArchitectureCommand(linter, manifestService);
    const reportPath = join(os.tmpdir(), `core-arch-report-${Date.now()}.json`);
    try {
      await expect(command.checkArchitecture(['--report', reportPath])).resolves.toBeUndefined();
      expect(existsSync(reportPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        passed: boolean;
        totalFilesScanned: number;
        violationCount: number;
      };
      expect(parsed.passed).toBe(true);
      expect(parsed.totalFilesScanned).toBeGreaterThan(10);
      expect(parsed.violationCount).toBe(0);
    } finally {
      rmSync(reportPath, { force: true });
    }
  });
});
