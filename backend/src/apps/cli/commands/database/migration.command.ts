import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Optional } from '@nestjs/common';
import { DatabaseOperationsService } from '@packages/database/index.js';
import {
  type CliCommandDescriptor,
  type ICliCommandProvider,
} from '../../dispatcher/cli-dispatcher.service.js';
import { ManifestService } from '../../services/manifest.service.js';

@Injectable()
export class MigrationCommand implements ICliCommandProvider {
  constructor(
    @Optional() private readonly databaseOperations?: DatabaseOperationsService,
    @Optional() private readonly manifestService?: ManifestService,
  ) {}

  /** Khai báo danh mục các lệnh liên quan đến di trú Database */
  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'migration:check',
        domain: 'Database',
        description:
          'Kiểm tra trạng thái và tính toàn vẹn (checksum) các bản di trú (applied / pending)',
        usage: 'npm run cli -- migration:check [--run]',
        execute: (args) => this.checkMigrations(args),
      },
      {
        name: 'migration:create',
        domain: 'Database',
        description: 'Tạo tệp migration mới theo quy chuẩn TypeORM (hỗ trợ gắn vào từng module)',
        usage: 'npm run cli -- migration:create <MigrationName> [--module=<module-name>]',
        execute: (args) => this.createMigration(args),
      },
      {
        name: 'migration:rollback',
        domain: 'Database',
        description: 'Hoàn tác bản migration gần nhất (có khóa phân tán Redis Lock)',
        usage: 'npm run cli -- migration:rollback [--force]',
        execute: (args) => this.rollbackMigration(args),
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
      '┌──────────────────────────────────────────────┬──────────┬───────────────┬────────────────────────┐',
    );
    console.log(
      '│ Migration Name                               │ Status   │ Integrity     │ Timestamp              │',
    );
    console.log(
      '├──────────────────────────────────────────────┼──────────┼───────────────┼────────────────────────┤',
    );

    let pendingCount = 0;
    let tamperedCount = 0;
    for (const item of items) {
      if (item.status === 'pending') pendingCount++;
      if (item.status === 'applied' && item.integrity && item.integrity !== 'ok') tamperedCount++;
      const name = item.name.padEnd(44).slice(0, 44);
      const status = (item.status === 'applied' ? 'APPLIED ' : 'PENDING ').padEnd(8);
      const integrity = (item.integrity ?? 'ok').toUpperCase().padEnd(13).slice(0, 13);
      const ts = (item.timestamp ? new Date(item.timestamp).toISOString() : '-').padEnd(22);

      console.log(`│ ${name} │ ${status} │ ${integrity} │ ${ts} │`);
    }

    console.log(
      '└──────────────────────────────────────────────┴──────────┴───────────────┴────────────────────────┘',
    );
    console.log(
      `Total: ${items.length} migrations (${items.length - pendingCount} applied, ${pendingCount} pending, ${tamperedCount} integrity warning(s))`,
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

  /** Tạo tệp migration mới theo quy chuẩn đặt tên `<timestamp>-<PascalName>.ts` và class `<PascalName><timestamp>`. */
  public async createMigration(args: string[]): Promise<void> {
    const rawName = args.find((a) => !a.startsWith('--'));
    if (!rawName) {
      throw new Error(
        'Migration name is required. Usage: npm run cli -- migration:create <MigrationName> [--module=<name>]',
      );
    }

    const pascal = rawName
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    if (!pascal) {
      throw new Error(`Invalid migration name "${rawName}".`);
    }

    const moduleArg = args.find((a) => a.startsWith('--module='))?.split('=')[1];
    const backendRoot = this.manifestService?.getBackendRoot() ?? process.cwd();

    let targetDir = path.join(backendRoot, 'src', 'database', 'migrations');
    if (moduleArg && this.manifestService) {
      const modules = await this.manifestService.discoverAllModules();
      const found = modules.find((m) => m.name === moduleArg);
      if (!found) {
        throw new Error(`Module "${moduleArg}" not found.`);
      }
      targetDir = path.join(found.directory, 'migrations');
    }

    const timestamp = Date.now();
    const className = `${pascal}${timestamp}`;
    const fileName = `${timestamp}-${pascal}.ts`;
    const filePath = path.join(targetDir, fileName);

    const template = `import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: ${pascal} (${new Date(timestamp).toISOString()})
 * Quy tắc: Tuyệt đối KHÔNG sửa đổi tệp migration này sau khi đã chạy trên môi trường Production.
 */
export class ${className} implements MigrationInterface {
  public readonly name = '${className}';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Viết câu lệnh nâng cấp schema (forward migration) tại đây
    await queryRunner.query('SELECT 1');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Viết câu lệnh hoàn tác (rollback migration) tương ứng tại đây
    await queryRunner.query('SELECT 1');
  }
}
`;

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(filePath, template, 'utf8');
    console.log(`\n✓ Created migration file: ${path.relative(backendRoot, filePath)}`);
    console.log(`  Class: ${className}\n`);
  }

  /** Hoàn tác bản migration gần nhất thông qua DatabaseOperationsService. */
  public async rollbackMigration(args: string[]): Promise<void> {
    if (!this.databaseOperations) {
      throw new Error('DatabaseOperationsService is not available.');
    }
    const force = args.includes('--force');
    console.log('\nReverting last applied migration via Redis Lock...');
    const result = await this.databaseOperations.revertLastMigration({ force });
    console.log(`✓ Last migration reverted successfully in ${result.durationMs}ms\n`);
  }
}
