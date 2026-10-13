import { Injectable, Optional } from '@nestjs/common';
import { DatabaseOperationsService } from '@packages/database/index.js';
import {
  type CliCommandDescriptor,
  type ICliCommandProvider,
} from '../../dispatcher/cli-dispatcher.service.js';

@Injectable()
export class MigrationCommand implements ICliCommandProvider {
  constructor(@Optional() private readonly databaseOperations?: DatabaseOperationsService) {}

  /** Khai báo danh mục các lệnh liên quan đến di trú Database */
  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'migration:check',
        domain: 'Database',
        description: 'Kiểm tra trạng thái các bản di trú (applied và pending migrations)',
        usage: 'npm run cli -- migration:check [--run]',
        execute: (args) => this.checkMigrations(args),
      },
    ];
  }

  /** Kiểm tra danh sách các bản di trú (applied và pending) và thực thi nếu có cờ --run */
  public async checkMigrations(args: string[]): Promise<void> {
    if (!this.databaseOperations) {
      throw new Error(
        'DatabaseOperationsService is not available. Please ensure DatabaseModule is loaded.',
      );
    }

    console.log('\n--- CHECKING DATABASE MIGRATIONS STATUS ---');
    const { items, lastRun } = await this.databaseOperations.migrations();

    if (items.length === 0) {
      console.log('No migrations found or declared in system.\n');
      return;
    }

    console.log(
      '┌────────────────────────────────────────────────────────────┬──────────┬────────────────────────┐',
    );
    console.log(
      '│ Migration Name                                             │ Status   │ Timestamp              │',
    );
    console.log(
      '├────────────────────────────────────────────────────────────┼──────────┼────────────────────────┤',
    );

    let pendingCount = 0;
    for (const item of items) {
      if (item.status === 'pending') pendingCount++;
      const name = item.name.padEnd(58).slice(0, 58);
      const status = (item.status === 'applied' ? 'APPLIED ' : 'PENDING ').padEnd(8);
      const ts = (item.timestamp ? new Date(item.timestamp).toISOString() : '-').padEnd(22);

      console.log(`│ ${name} │ ${status} │ ${ts} │`);
    }

    console.log(
      '└────────────────────────────────────────────────────────────┴──────────┴────────────────────────┘',
    );
    console.log(
      `Total: ${items.length} migrations (${items.length - pendingCount} applied, ${pendingCount} pending)`,
    );

    if (lastRun) {
      console.log(
        `Last migration run: ${lastRun.at} | Status: ${lastRun.status} | Duration: ${lastRun.durationMs}ms`,
      );
    }

    const shouldRun = args.includes('--run');
    if (pendingCount > 0 && shouldRun) {
      console.log('\nExecuting pending migrations via Redis Lock...');
      const runResult = await this.databaseOperations.runMigrations();
      if (runResult.status === 'completed') {
        console.log(`✓ Migrations executed successfully (${runResult.executed.length} applied)\n`);
      } else {
        console.error(`✗ Migration execution failed: ${runResult.error}\n`);
        throw new Error(runResult.error ?? 'Migration run failed');
      }
    } else if (pendingCount > 0) {
      console.log('\nNote: You have pending migrations. To execute them, run:');
      console.log('  npm run cli -- migration:check --run\n');
    } else {
      console.log('\nDatabase schema is fully synchronized with migrations ✓\n');
    }
  }
}
