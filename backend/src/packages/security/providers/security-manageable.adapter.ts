import { Injectable, Optional } from '@nestjs/common';
import {
  type ManageablePackage,
  type PackageStatusReport,
  PackageStatus,
  PackageCategory,
  CorePackageId,
} from '@packages/kernel/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { PasswordHasherService } from './password-hasher.service.js';
import { FieldEncryptionService } from './field-encryption.service.js';

@Injectable()
export class SecurityManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.SECURITY;
  public readonly category = PackageCategory.CUSTOM;
  public readonly icon = 'shield-check';

  constructor(
    private readonly configService: CoreConfigService,
    private readonly i18n: CoreI18nService,
    @Optional() private readonly passwordHasher?: PasswordHasherService,
    @Optional() private readonly fieldEncryption?: FieldEncryptionService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.security.displayName');
  }

  /** Lấy báo cáo tình trạng hoạt động và các chỉ số bảo mật/mã hóa của package */
  public async getStatus(): Promise<PackageStatusReport> {
    const { jwt } = this.configService.auth;
    const passwordHashAlgorithm = this.passwordHasher?.getDefaultAlgorithm() ?? 'SCRYPT';
    const dbEncryptionAlgorithm = this.fieldEncryption?.getDefaultAlgorithm() ?? 'AES_256_GCM';

    return {
      status: PackageStatus.HEALTHY,
      summary: this.i18n.t('ops.status.healthy'),
      metrics: {
        accessExpiration: jwt.accessExpiration,
        refreshExpiration: jwt.refreshExpiration,
        secretDriver: this.configService.auth.secretDriver,
        globalAuthGuard: true,
        tokenVerification: 'HS256',
        passwordHashAlgorithm,
        dbEncryptionAlgorithm,
      },
    };
  }
}
