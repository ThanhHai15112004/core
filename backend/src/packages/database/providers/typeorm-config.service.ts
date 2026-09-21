import { Injectable } from '@nestjs/common';
import type { TypeOrmOptionsFactory, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseDriver } from '@packages/kernel/index.js';

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  constructor(private readonly configService: CoreConfigService) {}

  public createTypeOrmOptions(): TypeOrmModuleOptions {
    const db = this.configService.database;
    const driver = db.connection as DatabaseDriver;

    const baseOptions = {
      synchronize: db.synchronize,
      logging: db.logging,
      autoLoadEntities: true,
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
          options: {
            encrypt: false,
            trustServerCertificate: true,
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
          extra: {
            connectionLimit: db.maxConnections,
          },
        };
    }
  }
}
