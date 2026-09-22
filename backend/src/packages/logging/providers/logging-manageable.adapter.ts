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
import { CoreI18nService } from '@packages/i18n/index.js';
import { CoreLoggerService } from './logger.service.js';
import { LogLevel, LoggingAction } from '../constants/logging.constant.js';

/** Mỗi action đổi log level: action id → level + prefix key i18n. */
const LEVEL_ACTIONS = {
  [LoggingAction.SET_LEVEL_DEBUG]: { level: LogLevel.DEBUG, i18nKey: 'ops.logging.debug' },
  [LoggingAction.SET_LEVEL_INFO]: { level: LogLevel.INFO, i18nKey: 'ops.logging.info' },
  [LoggingAction.SET_LEVEL_WARN]: { level: LogLevel.WARN, i18nKey: 'ops.logging.warn' },
} as const;

type LevelActionId = keyof typeof LEVEL_ACTIONS;

@Injectable()
export class LoggingManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.LOGGING;
  public readonly category = PackageCategory.LOGGING;
  public readonly icon = 'scroll-text';

  constructor(
    private readonly loggerService: CoreLoggerService,
    private readonly i18n: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.logging.displayName');
  }

  public async getStatus(): Promise<PackageStatusReport> {
    const currentLevel = this.loggerService.getLogLevel();

    return {
      status: PackageStatus.HEALTHY,
      summary: this.i18n.t('ops.logging.summary', { level: currentLevel }),
      metrics: {
        currentLevel,
        redaction: 'enabled',
        transport: 'console/json',
      },
    };
  }

  public getActions(): PackageActionDescriptor[] {
    return (Object.keys(LEVEL_ACTIONS) as LevelActionId[]).map((id) => ({
      id,
      label: this.i18n.t(`${LEVEL_ACTIONS[id].i18nKey}.label`),
      description: this.i18n.t(`${LEVEL_ACTIONS[id].i18nKey}.description`),
      isDanger: false,
    }));
  }

  public async executeAction(actionId: string): Promise<PackageActionResult> {
    if (!(actionId in LEVEL_ACTIONS)) {
      return {
        success: false,
        message: this.i18n.t('ops.action.unsupported', { actionId, packageId: this.packageId }),
      };
    }

    const { level } = LEVEL_ACTIONS[actionId as LevelActionId];
    this.loggerService.setLogLevel(level);
    return {
      success: true,
      message: this.i18n.t('ops.logging.setLevel.success', { level }),
      data: { level },
    };
  }
}
