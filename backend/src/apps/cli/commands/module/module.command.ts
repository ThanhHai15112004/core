import { Injectable, Logger } from '@nestjs/common';
import {
  type CliCommandDescriptor,
  type ICliCommandProvider,
} from '../../dispatcher/cli-dispatcher.service.js';
import { ManifestService } from '../../services/manifest.service.js';
import { ModuleScaffolderService } from '../../services/module-scaffolder.service.js';

@Injectable()
export class ModuleCommand implements ICliCommandProvider {
  private readonly logger = new Logger(ModuleCommand.name);

  constructor(
    private readonly manifestService: ManifestService,
    private readonly scaffolder: ModuleScaffolderService,
  ) {}

  /** Khai báo danh mục các lệnh thuộc domain Module Management */
  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'module:list',
        domain: 'Module Management',
        description: 'Liệt kê tất cả các module và trạng thái kích hoạt',
        usage: 'npm run cli -- module:list [--all]',
        execute: (args) => this.listModules(args),
      },
      {
        name: 'module:create',
        domain: 'Module Management',
        description: 'Tạo module mới theo chuẩn cấu trúc hệ thống',
        usage: 'npm run cli -- module:create <name> [--type=project|core] [--with-db]',
        execute: (args) => this.createModule(args),
      },
      {
        name: 'module:add',
        domain: 'Module Management',
        description: 'Kích hoạt và đăng ký module vào project manifest',
        usage: 'npm run cli -- module:add <name>',
        execute: (args) => this.addModule(args),
      },
    ];
  }

  /** 1.7.3: Liệt kê module đang dùng */
  public async listModules(_args: string[]): Promise<void> {
    const modules = await this.manifestService.discoverAllModules();

    console.log('\n--- CORE & PROJECT MODULES STATUS ---');
    console.log(
      '┌──────────────────────────────┬─────────┬─────────┬──────────┬──────────────────────────────┬────────────────────────┐',
    );
    console.log(
      '│ Module Name                  │ Type    │ Version │ Status   │ Dependencies                 │ Tables                 │',
    );
    console.log(
      '├──────────────────────────────┼─────────┼─────────┼──────────┼──────────────────────────────┼────────────────────────┤',
    );

    let enabledCount = 0;
    for (const m of modules) {
      if (m.isEnabled) enabledCount++;
      const name = m.name.padEnd(28).slice(0, 28);
      const type = m.type.padEnd(7);
      const ver = (m.manifest.version ?? '1.0.0').padEnd(7);
      const status = (m.isEnabled ? 'ENABLED ' : 'DISABLED').padEnd(8);
      const deps = (m.manifest.dependencies?.join(', ') || '-').padEnd(28).slice(0, 28);
      const tables = (m.manifest.database?.tables?.join(', ') || '-').padEnd(22).slice(0, 22);

      console.log(`│ ${name} │ ${type} │ ${ver} │ ${status} │ ${deps} │ ${tables} │`);
    }

    console.log(
      '└──────────────────────────────┴─────────┴─────────┴──────────┴──────────────────────────────┴────────────────────────┘',
    );
    console.log(
      `Total: ${modules.length} modules (${enabledCount} enabled, ${modules.length - enabledCount} disabled)\n`,
    );
  }

  /** 1.7.1: Tạo module mới */
  public async createModule(args: string[]): Promise<void> {
    const name = args.find((a) => !a.startsWith('--'));
    if (!name) {
      throw new Error(
        'Module name is required. Usage: npm run cli -- module:create <module-name> [--type=project|core] [--with-db]',
      );
    }

    const typeArg = args.find((a) => a.startsWith('--type='));
    const type = typeArg?.split('=')[1] === 'core' ? 'core' : 'project';
    const withDb = args.includes('--with-db');

    console.log(`\nScaffolding new ${type} module "${name}" (withDb=${withDb})...`);
    const result = await this.scaffolder.scaffold({
      name,
      type,
      withDb,
    });

    console.log(`\n✓ Module "${result.moduleName}" created successfully!`);
    console.log(`  Location: ${result.targetDirectory}`);
    console.log('  Created files:');
    for (const file of result.createdFiles) {
      console.log(`    - ${file}`);
    }
    console.log(
      `\nNext step: Run "npm run cli -- module:add ${result.moduleName}" to enable this module in project.manifest.json.\n`,
    );
  }

  /** 1.7.2: Thêm module vào dự án */
  public async addModule(args: string[]): Promise<void> {
    const name = args.find((a) => !a.startsWith('--'));
    if (!name) {
      throw new Error('Module name is required. Usage: npm run cli -- module:add <module-name>');
    }

    console.log(`\nEnabling module "${name}"...`);
    const result = await this.manifestService.enableModule(name);

    if (!result.success) {
      this.logger.error(result.message);
      throw new Error(result.message);
    }

    console.log(`✓ ${result.message}`);
    if (result.missingDependencies && result.missingDependencies.length > 0) {
      console.log(
        `\n[WARNING] This module has dependencies that are not yet enabled in project.manifest.json:`,
      );
      for (const dep of result.missingDependencies) {
        console.log(`  - ${dep}`);
      }
      console.log(
        `Please make sure to also enable them if needed: npm run cli -- module:add <dependency>\n`,
      );
    }
  }
}
