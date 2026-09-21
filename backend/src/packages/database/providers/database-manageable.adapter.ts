import { Injectable } from '@nestjs/common';
import {
  type ManageablePackage,
  type PackageActionDescriptor,
  type PackageStatusReport,
  PackageStatus,
  PackageCategory,
  CorePackageId,
} from '@packages/kernel/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import { BaseDatabaseProvider } from './database.provider.js';

@Injectable()
export class DatabaseManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.DATABASE;
  public readonly displayName = 'Relational Database';
  public readonly category = PackageCategory.DATABASE;
  public readonly icon = 'database';

  constructor(
    private readonly configService: CoreConfigService,
    private readonly databaseProvider: BaseDatabaseProvider,
  ) {}

  public async getStatus(): Promise<PackageStatusReport> {
    const db = this.configService.database;
    const isConnected = this.databaseProvider.isConnected();

    return {
      status: isConnected ? PackageStatus.HEALTHY : PackageStatus.WARNING,
      summary: `Động cơ ${db.connection.toUpperCase()} tại ${db.host}:${db.port}/${db.database}`,
      metrics: {
        driver: db.connection.toUpperCase(),
        host: db.host,
        port: db.port,
        database: db.database,
        poolLimit: db.maxConnections,
        synchronize: db.synchronize,
      },
    };
  }

  public getActions(): PackageActionDescriptor[] {
    return [
      {
        id: 'ping',
        label: 'Ping Database',
        description: 'Kiểm tra độ trễ và phản hồi của kết nối cơ sở dữ liệu',
        isDanger: false,
      },
    ];
  }

  public async executeAction(
    actionId: string,
  ): Promise<{ success: boolean; message: string; data?: unknown }> {
    if (actionId === 'ping') {
      const isAlive = await this.databaseProvider.ping();
      return {
        success: isAlive,
        message: isAlive
          ? `Kết nối tới Database [${this.configService.database.connection.toUpperCase()}] phản hồi thành công.`
          : 'Không thể ping tới cơ sở dữ liệu.',
      };
    }

    return {
      success: false,
      message: `Hành động [${actionId}] không được hỗ trợ trên Database.`,
    };
  }
}
