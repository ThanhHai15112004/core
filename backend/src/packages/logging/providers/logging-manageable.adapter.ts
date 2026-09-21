import { Injectable } from '@nestjs/common';
import {
  type ManageablePackage,
  type PackageActionDescriptor,
  type PackageStatusReport,
  PackageStatus,
  PackageCategory,
  CorePackageId,
} from '@packages/kernel/index.js';
import { CoreLoggerService } from './logger.service.js';
import { LogLevel, LoggingAction } from '../constants/logging.constant.js';

@Injectable()
export class LoggingManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.LOGGING;
  public readonly displayName = 'Nhật ký Hệ thống (Structured Logging)';
  public readonly category = PackageCategory.LOGGING;
  public readonly icon = 'scroll-text';

  constructor(private readonly loggerService: CoreLoggerService) {}

  public async getStatus(): Promise<PackageStatusReport> {
    const currentLevel = this.loggerService.getLogLevel();

    return {
      status: PackageStatus.HEALTHY,
      summary: `Mức ghi log đang kích hoạt: ${currentLevel}`,
      metrics: {
        currentLevel,
        redaction: 'enabled',
        transport: 'console/json',
      },
    };
  }

  public getActions(): PackageActionDescriptor[] {
    return [
      {
        id: LoggingAction.SET_LEVEL_DEBUG,
        label: 'Mức DEBUG (Chi tiết)',
        description: 'Bật mức log chi tiết để theo dõi và gỡ lỗi',
        isDanger: false,
      },
      {
        id: LoggingAction.SET_LEVEL_INFO,
        label: 'Mức INFO (Tiêu chuẩn)',
        description: 'Khôi phục mức log tiêu chuẩn của hệ thống',
        isDanger: false,
      },
      {
        id: LoggingAction.SET_LEVEL_WARN,
        label: 'Mức WARN (Rút gọn)',
        description: 'Chỉ ghi log cảnh báo và lỗi để tối ưu I/O',
        isDanger: false,
      },
    ];
  }

  public async executeAction(
    actionId: string,
  ): Promise<{ success: boolean; message: string; data?: unknown }> {
    switch (actionId) {
      case LoggingAction.SET_LEVEL_DEBUG:
        this.loggerService.setLogLevel(LogLevel.DEBUG);
        return {
          success: true,
          message: 'Đã chuyển mức log sang DEBUG thành công.',
          data: { level: LogLevel.DEBUG },
        };
      case LoggingAction.SET_LEVEL_INFO:
        this.loggerService.setLogLevel(LogLevel.INFO);
        return {
          success: true,
          message: 'Đã chuyển mức log sang INFO thành công.',
          data: { level: LogLevel.INFO },
        };
      case LoggingAction.SET_LEVEL_WARN:
        this.loggerService.setLogLevel(LogLevel.WARN);
        return {
          success: true,
          message: 'Đã chuyển mức log sang WARN thành công.',
          data: { level: LogLevel.WARN },
        };
      default:
        return {
          success: false,
          message: `Hành động "${actionId}" không được hỗ trợ bởi Logging package.`,
        };
    }
  }
}
