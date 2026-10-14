import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { TypeOrmOptionsFactory, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseDriver } from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { ERROR_LOG_SIZE, databaseKeys } from '../constants/database.keys.js';
import type { DbErrorRecord } from '../contracts/database-events.types.js';
import { classifyDbError, errorCodeOf, sanitizeDbMessage } from '../utils/error-classify.js';
import { normalizeSql } from '../utils/sql-normalize.js';

import { TypeOrmPinoLogger } from './typeorm-pino.logger.js';

const currentFile = fileURLToPath(import.meta.url);
const migrationExt = currentFile.endsWith('.ts') ? '*.ts' : '*.js';
const srcRoot = path.resolve(path.dirname(currentFile), '../../..');
/** Nạp migration từ thư mục tập trung `database/migrations` và thư mục `migrations` của từng module. */
const MIGRATIONS_GLOBS = [
  path.join(srcRoot, 'database/migrations', migrationExt),
  path.join(srcRoot, 'modules/*/migrations', migrationExt),
  path.join(srcRoot, 'project-modules/*/migrations', migrationExt),
];

/** Tối đa số lỗi query ghi vào Redis mỗi giây (database sập → mọi query lỗi, không ghi tràn). */
const ERROR_RECORDS_PER_SEC = 5;

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  private errorWindow = { at: 0, n: 0 };

  constructor(
    private readonly configService: CoreConfigService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity: RuntimeIdentity | null = null,
    @Optional() private readonly redis: RedisService | null = null,
  ) {}

  /** Lưu lỗi query (đã phân loại, SQL đã chuẩn hoá) cho trang Database → Errors / deadlock. */
  private recordQueryError(error: unknown, query: string): void {
    const now = Date.now();
    if (now - this.errorWindow.at >= 1000) this.errorWindow = { at: now, n: 0 };
    if (++this.errorWindow.n > ERROR_RECORDS_PER_SEC || !this.redis?.isReady()) return;
    const record: DbErrorRecord = {
      at: now,
      kind: classifyDbError(error),
      code: errorCodeOf(error),
      message: sanitizeDbMessage(error),
      sql: normalizeSql(query),
      runtime: this.identity?.id ?? null,
      instance: null,
      correlationId: RequestContextService.currentCorrelationId() ?? null,
    };
    const key = databaseKeys(this.redis).errors();
    void this.redis.client
      .multi()
      .lpush(key, JSON.stringify(record))
      .ltrim(key, 0, ERROR_LOG_SIZE - 1)
      .exec()
      .catch(() => undefined);
  }

  /** Tên client gắn vào mỗi connection để System Console map session → runtime (api/worker/scheduler/cli). */
  public get clientName(): string {
    return `core-${this.identity?.id ?? 'app'}`;
  }

  /** Tạo đối tượng cấu hình kết nối TypeORM từ thiết lập hệ thống */
  public createTypeOrmOptions(): TypeOrmModuleOptions {
    const db = this.configService.database;
    const driver = db.connection as DatabaseDriver;

    const baseOptions = {
      synchronize: db.synchronize,
      logger: new TypeOrmPinoLogger(db.logging, (err, query) => this.recordQueryError(err, query)),
      maxQueryExecutionTime: db.slowQueryMs ?? 500,
      autoLoadEntities: true,
      // Kết nối do DatabaseConnectionService mở nền (có retry) → API vẫn chạy khi database chưa sẵn sàng.
      manualInitialization: true,
      migrations: MIGRATIONS_GLOBS,
      migrationsTableName: db.migrationsTableName,
    };

    const masterEndpoint = {
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: db.database,
    };

    const replicationConfig = db.readHost
      ? {
          replication: {
            master: masterEndpoint,
            slaves: [
              {
                host: db.readHost,
                port: db.readPort,
                username: db.username,
                password: db.password,
                database: db.database,
              },
            ],
          },
        }
      : masterEndpoint;

    switch (driver) {
      case DatabaseDriver.POSTGRES:
      case DatabaseDriver.POSTGRESQL:
        return {
          ...baseOptions,
          type: 'postgres',
          ...replicationConfig,
          applicationName: this.clientName,
          connectTimeoutMS: db.connectTimeoutMs,
          ...(db.ssl ? { ssl: true } : {}),
          extra: {
            max: db.maxConnections,
            idleTimeoutMillis: db.poolIdleTimeoutMs,
            ...(db.queryTimeoutMs > 0
              ? { statement_timeout: db.queryTimeoutMs, query_timeout: db.queryTimeoutMs }
              : {}),
          },
        };

      case DatabaseDriver.MSSQL:
        return {
          ...baseOptions,
          type: 'mssql',
          ...replicationConfig,
          connectionTimeout: db.connectTimeoutMs,
          ...(db.queryTimeoutMs > 0 ? { requestTimeout: db.queryTimeoutMs } : {}),
          options: {
            encrypt: db.ssl,
            trustServerCertificate: true,
            appName: this.clientName,
          },
          extra: {
            pool: {
              max: db.maxConnections,
              idleTimeoutMillis: db.poolIdleTimeoutMs,
            },
          },
        };

      case DatabaseDriver.SQLITE:
        return {
          ...baseOptions,
          type: 'better-sqlite3',
          database: db.database || ':memory:',
        };

      case DatabaseDriver.MYSQL:
      default:
        return {
          ...baseOptions,
          type: 'mysql',
          ...replicationConfig,
          charset: 'utf8mb4_unicode_ci',
          connectTimeout: db.connectTimeoutMs,
          ...(db.ssl ? { ssl: {} } : {}),
          extra: {
            connectionLimit: db.maxConnections,
            maxIdle:
              db.poolMaxIdle > 0 ? Math.min(db.poolMaxIdle, db.maxConnections) : db.maxConnections,
            idleTimeout: db.poolIdleTimeoutMs,
            queueLimit: db.poolQueueLimit,
            connectAttributes: { program_name: this.clientName },
          },
        };
    }
  }
}
