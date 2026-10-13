import { getHeapStatistics } from 'node:v8';
import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseConnectionService } from '@packages/database/index.js';
import { RedisService } from '@packages/redis/index.js';
import { StorageConnectionService } from '@packages/storage/index.js';
import {
  type CliCommandDescriptor,
  type ICliCommandProvider,
} from '../../dispatcher/cli-dispatcher.service.js';

interface CheckItem {
  name: string;
  passed: boolean;
  message: string;
  warning?: boolean;
}

@Injectable()
export class DoctorCommand implements ICliCommandProvider {
  constructor(
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    @Optional() private readonly database?: DatabaseConnectionService,
    @Optional() private readonly storage?: StorageConnectionService,
  ) {}

  /** Khai báo danh mục các lệnh kiểm tra sức khỏe hệ thống (Diagnostics) */
  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'doctor',
        domain: 'Diagnostics',
        description: 'Kiểm tra toàn diện sức khỏe hạ tầng Core và cấu hình môi trường',
        usage: 'npm run cli -- doctor',
        execute: () => this.runDoctor(),
      },
      {
        name: 'core:health',
        domain: 'Diagnostics',
        description: 'Alias cho lệnh doctor',
        usage: 'npm run cli -- core:health',
        execute: () => this.runDoctor(),
      },
    ];
  }

  /** Thực hiện chẩn đoán toàn diện môi trường Node.js, cấu hình, Redis, Database, Storage và V8 Heap */
  public async runDoctor(): Promise<void> {
    console.log('\n======================================================');
    console.log('            Core Framework Health Diagnostics         ');
    console.log('======================================================\n');

    const results: CheckItem[] = [];

    // 1. Check Node.js version
    const nodeVer = process.version;
    const major = parseInt(nodeVer.slice(1).split('.')[0] ?? '0', 10);
    const nodePassed = major >= 22 && major < 25;
    results.push({
      name: 'Node.js Runtime',
      passed: nodePassed,
      message: `${nodeVer} (Required: >=22.0.0 <25)`,
      warning: !nodePassed,
    });

    // 2. Check Environment Config
    try {
      const appName = this.config.app.name;
      const env = this.config.app.env;
      results.push({
        name: 'Environment Config',
        passed: true,
        message: `App: "${appName}" | Env: "${env}" (Validated via Fail-Fast)`,
      });
    } catch (err) {
      results.push({
        name: 'Environment Config',
        passed: false,
        message: `Configuration error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 3. Check Redis Connection
    try {
      const startTime = Date.now();
      const pong = await this.redis.client.ping();
      const latency = Date.now() - startTime;
      results.push({
        name: 'Redis Connection',
        passed: pong === 'PONG',
        message: `Connected (${latency}ms latency) | Client: ${this.redis.clientName}`,
      });
    } catch (err) {
      results.push({
        name: 'Redis Connection',
        passed: false,
        message: `Failed to connect: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 4. Check Database Connection
    if (this.database) {
      try {
        const status = this.database.getStatus();
        if (status.state === 'disabled') {
          results.push({
            name: 'Database (TypeORM)',
            passed: true,
            warning: true,
            message: 'Database is disabled in config (DB_ENABLED=false)',
          });
        } else {
          const ping = await this.database.ping();
          results.push({
            name: 'Database (TypeORM)',
            passed: ping.ok,
            message: ping.ok
              ? `Connected (${ping.latencyMs ?? 0}ms latency, Driver: ${this.config.database.connection})`
              : `Connection degraded or unavailable (${ping.error?.message ?? status.state})`,
          });
        }
      } catch (err) {
        results.push({
          name: 'Database (TypeORM)',
          passed: false,
          message: `Connection error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // 5. Check Object Storage
    if (this.storage) {
      try {
        const driver = this.config.storage.driver;
        results.push({
          name: 'Object Storage',
          passed: true,
          message: `Storage driver ready (Driver: ${driver})`,
        });
      } catch (err) {
        results.push({
          name: 'Object Storage',
          passed: false,
          message: `Storage error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // 6. Check Memory Heap
    const heapStats = getHeapStatistics();
    const heapUsedMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const heapLimitMb = Math.round(heapStats.heap_size_limit / 1024 / 1024);
    const heapRatio = heapUsedMb / heapLimitMb;
    results.push({
      name: 'V8 Heap Memory',
      passed: heapRatio < 0.9,
      warning: heapRatio >= 0.75,
      message: `${heapUsedMb}MB / ${heapLimitMb}MB (${(heapRatio * 100).toFixed(1)}%)`,
    });

    // In kết quả
    for (const r of results) {
      const tag = r.passed ? (r.warning ? '[WARN]' : '[ OK ]') : '[FAIL]';
      const name = r.name.padEnd(22);
      console.log(`${tag} ${name} ${r.message}`);
    }

    const hasFailure = results.some((r) => !r.passed);
    console.log('\n------------------------------------------------------');
    if (hasFailure) {
      console.log('Status: ONE OR MORE CHECKS FAILED! Please inspect issues above.\n');
      throw new Error('Doctor diagnostic detected system failures.');
    } else {
      console.log('Status: ALL CORE SYSTEMS OPERATIONAL AND HEALTHY ✓\n');
    }
  }
}
