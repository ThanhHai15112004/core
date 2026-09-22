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
import { DatabaseConnectionService } from './database-connection.service.js';

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
    private readonly connection: DatabaseConnectionService,
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
    const status = this.connection.getStatus();
    const isConnected = status.state === 'connected';

    return {
      status: isConnected
        ? PackageStatus.HEALTHY
        : status.state === 'disabled'
          ? PackageStatus.WARNING
          : status.state === 'connecting'
            ? PackageStatus.WARNING
            : PackageStatus.ERROR,
      summary: this.i18n.t('ops.database.summary', {
        driver: this.driver,
        host: db.host,
        port: db.port,
        database: db.database,
      }),
      metrics: {
        driver: this.driver,
        database: db.database,
        state: status.state,
        poolLimit: db.maxConnections,
        isConnected,
        lastPingMs: status.lastPingMs ?? 'n/a',
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
      const isAlive = (await this.connection.ping()).ok;
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
