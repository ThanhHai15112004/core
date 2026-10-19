import { Injectable, Optional } from '@nestjs/common';
import {
  DatabaseSeederService,
  type SeederContract,
  type SeederScope,
} from '@packages/database/index.js';
import { type CodeTypeManifestItem, discoverManifestCodeTypes } from '@packages/kernel/index.js';
import {
  type CliCommandDescriptor,
  type ICliCommandProvider,
} from '../../dispatcher/cli-dispatcher.service.js';
import { ManifestService } from '../../services/manifest.service.js';
import {
  MasterPermissionSeeder,
  type PermissionSeedItem,
} from '../../../../database/seeders/master-permission.seeder.js';
import { DevelopmentDataSeeder } from '../../../../database/seeders/development.seeder.js';
import { IamMasterSeeder } from '../../../../database/seeders/iam-master.seeder.js';
import { IamThousandUsersSeeder } from '../../../../database/seeders/iam-thousand-users.seeder.js';

@Injectable()
export class SeedCommand implements ICliCommandProvider {
  constructor(
    @Optional() private readonly seederService?: DatabaseSeederService,
    @Optional() private readonly manifestService?: ManifestService,
  ) {}

  /** Khai báo lệnh CLI thực thi Seeder dữ liệu */
  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'seed:run',
        domain: 'Database',
        description:
          'Đồng bộ dữ liệu nền tảng (Permissions, Code Lookup Tables, Master Data, IAM Admins) và Seed 1.000 Users mẫu Development',
        usage: 'npm run cli -- seed:run [--scope=all|master|development]',
        execute: (args) => this.runSeed(args),
      },
    ];
  }

  /** Thu thập danh sách quyền hạn và danh mục động từ manifest của các module và kích hoạt DatabaseSeederService. */
  public async runSeed(args: string[]): Promise<void> {
    if (!this.seederService) {
      throw new Error(
        'DatabaseSeederService is not available. Please ensure DatabaseModule is loaded.',
      );
    }

    const scopeArg = args.find((a) => a.startsWith('--scope='))?.split('=')[1] as
      'all' | SeederScope | undefined;
    const scope =
      scopeArg === 'master' || scopeArg === 'development' || scopeArg === 'all' ? scopeArg : 'all';

    const [permissions, codeTypes] = await Promise.all([
      this.collectManifestPermissions(),
      this.collectManifestCodeTypes(),
    ]);
    const seeders: SeederContract[] = [
      new MasterPermissionSeeder(permissions, undefined, codeTypes),
      new IamMasterSeeder(),
      new DevelopmentDataSeeder(),
      new IamThousandUsersSeeder(),
    ];

    console.log(`\n--- RUNNING DATABASE SEEDERS (scope: ${scope}) ---`);
    const summary = await this.seederService.runSeeders(seeders, { scope });

    console.log(
      '┌──────────────────────────────────────────┬─────────────┬───────────┬──────────┐',
    );
    console.log(
      '│ Seeder Name                              │ Scope       │ Status    │ Affected │',
    );
    console.log(
      '├──────────────────────────────────────────┼─────────────┼───────────┼──────────┤',
    );
    for (const item of summary.items) {
      const name = item.name.padEnd(40).slice(0, 40);
      const sc = item.scope.padEnd(11).slice(0, 11);
      const st = item.status.toUpperCase().padEnd(9).slice(0, 9);
      const aff = String(item.affected).padEnd(8).slice(0, 8);
      console.log(`│ ${name} │ ${sc} │ ${st} │ ${aff} │`);
    }
    console.log(
      '└──────────────────────────────────────────┴─────────────┴───────────┴──────────┘',
    );
    console.log(
      `Summary (${summary.environment}): ${summary.completed} completed, ${summary.skipped} skipped, ${summary.failed} failed.\n`,
    );
  }

  /** Quét toàn bộ module.manifest.json để trích xuất danh sách quyền hạn cần đồng bộ. */
  private async collectManifestPermissions(): Promise<PermissionSeedItem[]> {
    if (!this.manifestService) return [];
    const modules = await this.manifestService.discoverAllModules();
    const result = new Map<string, PermissionSeedItem>();

    for (const mod of modules) {
      for (const code of mod.manifest.permissions ?? []) {
        if (!code || result.has(code)) continue;
        result.set(code, {
          code,
          module: mod.name,
          description: `Permission "${code}" declared by module ${mod.manifest.displayName} (${mod.name})`,
        });
      }
    }
    return [...result.values()];
  }

  /** Quét toàn bộ module.manifest.json để trích xuất danh sách codeTypes cần đồng bộ. */
  private async collectManifestCodeTypes(): Promise<CodeTypeManifestItem[]> {
    const result = new Map<string, CodeTypeManifestItem>();
    for (const item of discoverManifestCodeTypes()) {
      result.set(item.code.trim().toLowerCase(), item);
    }
    if (!this.manifestService) return [...result.values()];

    const modules = await this.manifestService.discoverAllModules();
    for (const mod of modules) {
      for (const ct of mod.manifest.codeTypes ?? []) {
        if (!ct?.code) continue;
        const normalizedCode = ct.code.trim().toLowerCase();
        result.set(normalizedCode, {
          ...ct,
          code: normalizedCode,
          module: ct.module ?? mod.name,
        });
      }
    }
    return [...result.values()];
  }
}
