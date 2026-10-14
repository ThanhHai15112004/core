import { Injectable } from '@nestjs/common';
import { ArchitectureLinterService } from '../../services/architecture-linter.service.js';
import {
  type CliCommandDescriptor,
  type ICliCommandProvider,
} from '../../dispatcher/cli-dispatcher.service.js';

@Injectable()
export class ArchitectureCommand implements ICliCommandProvider {
  constructor(private readonly linter: ArchitectureLinterService) {}

  /** Khai báo danh mục các lệnh kiểm tra kiến trúc hệ thống */
  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'arch:check',
        domain: 'Architecture',
        description: 'Kiểm tra tuân thủ quy tắc kiến trúc Modular Monolith và ranh giới module',
        usage: 'npm run cli -- arch:check',
        execute: () => this.checkArchitecture(),
      },
      {
        name: 'architecture:check',
        domain: 'Architecture',
        description: 'Alias cho arch:check',
        usage: 'npm run cli -- architecture:check',
        execute: () => this.checkArchitecture(),
      },
    ];
  }

  /** Thực thi kiểm tra các quy tắc kiến trúc và in báo cáo vi phạm */
  public async checkArchitecture(): Promise<void> {
    console.log('\n======================================================');
    console.log('       Core Architecture & Boundary Validator         ');
    console.log('======================================================\n');
    console.log('Scanning codebase for architectural rule violations...');

    const report = await this.linter.check();

    console.log(`\nScanned ${report.totalFilesScanned} source files in backend/src/\n`);

    if (report.passed) {
      console.log('------------------------------------------------------');
      console.log('✓ ALL ARCHITECTURE CHECKS PASSED: 0 VIOLATIONS FOUND');
      console.log('  [Rule 1] Cross-Module Isolation: OK');
      console.log('  [Rule 2] Packages Purity: OK');
      console.log('  [Rule 3] Test Separation (No tests in src): OK');
      console.log('  [Rule 4] No Circular Dependencies: OK');
      console.log('  [Rule 5] No Direct ORM Entity/Repository Exposure: OK');
      console.log('  [Rule 6] Foreign Key & Cascade Delete Safety: OK');
      console.log('------------------------------------------------------\n');
      return;
    }

    console.log('------------------------------------------------------');
    console.log(`✗ FOUND ${report.violations.length} ARCHITECTURAL VIOLATION(S):\n`);

    for (let i = 0; i < report.violations.length; i++) {
      const v = report.violations[i]!;
      console.log(`[VIOLATION #${i + 1}] Rule: ${v.rule}`);
      console.log(`  File: ${v.file}${v.line ? `:${v.line}` : ''}`);
      console.log(`  Detail: ${v.message}\n`);
    }

    console.log('------------------------------------------------------');
    console.log(
      'Failed! Please fix the architectural violations listed above before proceeding.\n',
    );
    throw new Error(`Architecture validation failed with ${report.violations.length} violations.`);
  }
}
