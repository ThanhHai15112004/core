import { Injectable } from '@nestjs/common';
import {
  type ManageablePackage,
  type PackageActionDescriptor,
  type PackageActionResult,
  type PackageStatusReport,
  PackageStatus,
  PackageCategory,
  CorePackageId,
} from '@packages/kernel/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { BaseDatabaseProvider } from './database.provider.js';

export const DatabaseAction = {
  PING: 'ping',
} as const;

@Injectable()
export class DatabaseManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.DATABASE;
  public readonly category = PackageCategory.DATABASE;
  public readonly icon = 'database';

  constructor(
    private readonly configService: CoreConfigService,
    private readonly databaseProvider: BaseDatabaseProvider,
    private readonly i18n: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.database.displayName');
  }

  private get driver(): string {
    return this.configService.database.connection.toUpperCase();
  }

  public async getStatus(): Promise<PackageStatusReport> {
    const db = this.configService.database;
    const isConnected = this.databaseProvider.isConnected();

    return {
      status: isConnected ? PackageStatus.HEALTHY : PackageStatus.WARNING,
      summary: this.i18n.t('ops.database.summary', {
        driver: this.driver,
        host: db.host,
        port: db.port,
        database: db.database,
      }),
      metrics: {
        driver: this.driver,
        host: db.host,
        port: db.port,
        database: db.database,
        poolLimit: db.maxConnections,
        synchronize: db.synchronize,
        isConnected,
      },
    };
  }

  public getActions(): PackageActionDescriptor[] {
    return [
      {
        id: DatabaseAction.PING,
        label: this.i18n.t('ops.database.ping.label'),
        description: this.i18n.t('ops.database.ping.description'),
        isDanger: false,
      },
    ];
  }

  public async executeAction(actionId: string): Promise<PackageActionResult> {
    if (actionId === DatabaseAction.PING) {
      const isAlive = await this.databaseProvider.ping();
      return {
        success: isAlive,
        message: isAlive
          ? this.i18n.t('ops.database.ping.success', { driver: this.driver })
          : this.i18n.t('ops.database.ping.failed'),
      };
    }

    return {
      success: false,
      message: this.i18n.t('ops.action.unsupported', { actionId, packageId: this.packageId }),
    };
  }
}
