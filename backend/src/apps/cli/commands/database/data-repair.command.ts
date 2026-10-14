import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { DataRepairRunnerService } from '@packages/database/index.js';
import { RedisService } from '@packages/redis/index.js';
import { MigrationChecksumRepairScript } from '../../../../database/repairs/migration-checksum.repair.js';
import {
  type CliCommandDescriptor,
  type ICliCommandProvider,
} from '../../dispatcher/cli-dispatcher.service.js';

@Injectable()
export class DataRepairCommand implements ICliCommandProvider {
  constructor(
    private readonly repairRunner: DataRepairRunnerService,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis: RedisService | null = null,
  ) {
    this.repairRunner.register(new MigrationChecksumRepairScript(this.config, this.redis));
  }

  /** Khai báo lệnh CLI sửa dữ liệu có hỗ trợ Dry-Run */
  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'data:repair',
        domain: 'Database',
        description:
          'Chạy công cụ kiểm tra và sửa dữ liệu có chế độ chạy thử tự động rollback (--dry-run mặc định, --apply để ghi thật)',
        usage: 'npm run cli -- data:repair [--list] [--name=<script-name>] [--dry-run | --apply]',
        execute: (args) => this.runDataRepair(args),
      },
    ];
  }

  /** Thực thi hoặc liệt kê các kịch bản sửa dữ liệu */
  public async runDataRepair(args: string[]): Promise<void> {
    const isList = args.includes('--list');
    const nameArg = args.find((a) => a.startsWith('--name='));
    const positionalName = args.find((a) => !a.startsWith('--'));
    const scriptName = nameArg ? nameArg.split('=')[1] : positionalName;
    const isApply = args.includes('--apply') || args.includes('--no-dry-run');
    const dryRun = !isApply;

    console.log('\n======================================================');
    console.log('       Core Safe Data Repair Runner (Dry-Run Guard)   ');
    console.log('======================================================\n');

    const scripts = this.repairRunner.list();

    if (isList || !scriptName) {
      console.log('Available data repair scripts:\n');
      for (const s of scripts) {
        console.log(`  - ${s.name.padEnd(28)} : ${s.description}`);
      }
      console.log(
        '\nUsage:\n  Dry-Run (default, safe rollback): npm run cli -- data:repair --name=<script-name>\n  Apply (commit changes)          : npm run cli -- data:repair --name=<script-name> --apply\n',
      );
      return;
    }

    console.log(
      `Mode   : ${dryRun ? 'DRY-RUN (Transaction will be ROLLED BACK automatically)' : 'APPLY (Transaction will be COMMITTED)'}`,
    );
    console.log(`Script : ${scriptName}\n`);

    const report = await this.repairRunner.run(scriptName, { dryRun });

    console.log('┌────────────────────────┬────────────────────────────────────────────────────┐');
    console.log(`│ Script Name            │ ${report.name.padEnd(50).slice(0, 50)} │`);
    console.log(`│ Execution Status       │ ${report.status.padEnd(50).slice(0, 50)} │`);
    console.log(`│ Scanned Records        │ ${String(report.scannedCount).padEnd(50)} │`);
    console.log(`│ Affected Records       │ ${String(report.affectedCount).padEnd(50)} │`);
    console.log(`│ Duration               │ ${(report.durationMs + 'ms').padEnd(50)} │`);
    console.log('└────────────────────────┴────────────────────────────────────────────────────┘');
    console.log(`\nSummary: ${report.summary}\n`);
  }
}
