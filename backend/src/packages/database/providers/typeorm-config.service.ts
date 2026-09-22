import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { TypeOrmOptionsFactory, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseDriver } from '@packages/kernel/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';

const currentFile = fileURLToPath(import.meta.url);
/** `src/database/migrations/*.ts` khi chạy từ source (test/dev), `dist/database/migrations/*.js` khi đã build. */
const MIGRATIONS_GLOB = path.join(
  path.dirname(currentFile),
  '../../../database/migrations',
  currentFile.endsWith('.ts') ? '*.ts' : '*.js',
);

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  constructor(
    private readonly configService: CoreConfigService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity: RuntimeIdentity | null = null,
  ) {}

  /** Tên client gắn vào mỗi connection để System Console map session → runtime (api/worker/scheduler/cli). */
  public get clientName(): string {
    return `core-${this.identity?.id ?? 'app'}`;
  }

  public createTypeOrmOptions(): TypeOrmModuleOptions {
    const db = this.configService.database;
    const driver = db.connection as DatabaseDriver;

    const baseOptions = {
      synchronize: db.synchronize,
      logging: db.logging,
      autoLoadEntities: true,
      // Kết nối do DatabaseConnectionService mở nền (có retry) → API vẫn chạy khi database chưa sẵn sàng.
      manualInitialization: true,
      migrations: [MIGRATIONS_GLOB],
      migrationsTableName: db.migrationsTableName,
    };

    switch (driver) {
      case DatabaseDriver.POSTGRES:
      case DatabaseDriver.POSTGRESQL:
        return {
          ...baseOptions,
          type: 'postgres',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          applicationName: this.clientName,
          connectTimeoutMS: db.connectTimeoutMs,
          ...(db.ssl ? { ssl: true } : {}),
          extra: {
            max: db.maxConnections,
          },
        };

      case DatabaseDriver.MSSQL:
        return {
          ...baseOptions,
          type: 'mssql',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          connectionTimeout: db.connectTimeoutMs,
          options: {
            encrypt: db.ssl,
            trustServerCertificate: true,
            appName: this.clientName,
          },
          extra: {
            pool: {
              max: db.maxConnections,
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
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          charset: 'utf8mb4_unicode_ci',
          connectTimeout: db.connectTimeoutMs,
          ...(db.ssl ? { ssl: {} } : {}),
          extra: {
            connectionLimit: db.maxConnections,
            connectAttributes: { program_name: this.clientName },
          },
        };
    }
  }
}
