import { Injectable } from '@nestjs/common';
import {
  type ManageablePackage,
  type PackageStatusReport,
  PackageStatus,
  PackageCategory,
  CorePackageId,
} from '@packages/kernel/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecretDriver } from '../types/secret.types.js';

@Injectable()
export class SecurityManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.SECURITY;
  public readonly category = PackageCategory.CUSTOM;
  public readonly icon = 'shield-check';

  constructor(
    private readonly configService: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.security.displayName');
  }

  public async getStatus(): Promise<PackageStatusReport> {
    const { jwt } = this.configService.auth;

    // TokenService.verify() hiện là bản skeleton, chưa kiểm tra chữ ký JWT.
    return {
      status: PackageStatus.WARNING,
      summary: this.i18n.t('ops.security.skeletonWarning'),
      metrics: {
        accessExpiration: jwt.accessExpiration,
        refreshExpiration: jwt.refreshExpiration,
        secretDriver: process.env['SECRET_DRIVER']?.toLowerCase() || SecretDriver.ENV,
        globalAuthGuard: true,
        tokenVerification: 'skeleton',
      },
    };
  }
}
