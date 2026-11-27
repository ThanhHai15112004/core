import { Module, type OnModuleInit, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  DataGovernanceHookRegistry,
  defaultDataGovernanceHookRegistry,
} from '@packages/kernel/index.js';
import { configureDynamicSensitiveKeys } from '@packages/logging/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { AuditModule } from '@modules/audit/index.js';
import { CodesModule } from '@modules/codes/index.js';
import { CustomFieldsModule } from '@modules/custom-fields/index.js';
import { ExportsModule } from '@modules/exports/index.js';
import { FeatureFlagsModule } from '@modules/feature-flags/index.js';
import { FilesModule } from '@modules/files/index.js';
import { SequencesModule } from '@modules/sequences/index.js';
import { SessionsModule } from '@modules/sessions/index.js';
import { SettingsModule } from '@modules/settings/index.js';
import { UsersModule } from '@modules/users/index.js';
import { DATA_GOVERNANCE_PUBLIC_SERVICE } from './contracts/index.js';
import { DataGovernanceController } from './controllers/data-governance.controller.js';
import { DataClassificationEntity } from './entities/data-classification.entity.js';
import { DataLegalHoldEntity } from './entities/data-legal-hold.entity.js';
import { DataSensitiveFieldEntity } from './entities/data-sensitive-field.entity.js';
import { PrivacyConsentDefinitionEntity } from './entities/privacy-consent-definition.entity.js';
import { PrivacyDsarRequestEntity } from './entities/privacy-dsar-request.entity.js';
import { PrivacyUserConsentEntity } from './entities/privacy-user-consent.entity.js';
import enDataGovernance from './locales/en/data-governance.json' with { type: 'json' };
import viDataGovernance from './locales/vi/data-governance.json' with { type: 'json' };
import { DataClassificationRepository } from './repositories/data-classification.repository.js';
import { DataLegalHoldRepository } from './repositories/data-legal-hold.repository.js';
import { DataSensitiveFieldRepository } from './repositories/data-sensitive-field.repository.js';
import { PrivacyConsentDefinitionRepository } from './repositories/privacy-consent-definition.repository.js';
import { PrivacyDsarRequestRepository } from './repositories/privacy-dsar-request.repository.js';
import { PrivacyUserConsentRepository } from './repositories/privacy-user-consent.repository.js';
import { ConsentManagementService } from './services/consent-management.service.js';
import { DataClassificationService } from './services/data-classification.service.js';
import { DataGovernanceService } from './services/data-governance.service.js';
import { DsarService } from './services/dsar.service.js';
import { LegalHoldService } from './services/legal-hold.service.js';
import { PersonalDataContributorsService } from './services/personal-data-contributors.service.js';

new CoreI18nService().registerNamespace('data-governance', {
  vi: viDataGovernance,
  en: enDataGovernance,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    AuditModule,
    UsersModule,
    SessionsModule,
    FilesModule,
    CustomFieldsModule,
    ExportsModule,
    SettingsModule,
    FeatureFlagsModule,
    CodesModule,
    SequencesModule,
    TypeOrmModule.forFeature([
      DataClassificationEntity,
      DataSensitiveFieldEntity,
      PrivacyDsarRequestEntity,
      PrivacyConsentDefinitionEntity,
      PrivacyUserConsentEntity,
      DataLegalHoldEntity,
    ]),
  ],
  controllers: [DataGovernanceController],
  providers: [
    DataClassificationRepository,
    DataSensitiveFieldRepository,
    PrivacyDsarRequestRepository,
    PrivacyConsentDefinitionRepository,
    PrivacyUserConsentRepository,
    DataLegalHoldRepository,
    DataClassificationService,
    LegalHoldService,
    ConsentManagementService,
    PersonalDataContributorsService,
    DsarService,
    DataGovernanceService,
    {
      provide: DATA_GOVERNANCE_PUBLIC_SERVICE,
      useExisting: DataGovernanceService,
    },
  ],
  exports: [
    DataGovernanceService,
    DataClassificationService,
    LegalHoldService,
    ConsentManagementService,
    DsarService,
    DATA_GOVERNANCE_PUBLIC_SERVICE,
  ],
})
export class DataGovernanceModule implements OnModuleInit {
  private readonly hooks: DataGovernanceHookRegistry;

  constructor(
    private readonly classificationService: DataClassificationService,
    private readonly legalHoldService: LegalHoldService,
    private readonly contributorsService: PersonalDataContributorsService,
    @Optional() hookRegistry?: DataGovernanceHookRegistry,
    @Optional() i18n?: CoreI18nService,
  ) {
    this.hooks = hookRegistry ?? defaultDataGovernanceHookRegistry;
    i18n?.registerNamespace('data-governance', {
      vi: viDataGovernance,
      en: enDataGovernance,
    });
  }

  public async onModuleInit(): Promise<void> {
    this.hooks.registerLogRedactSyncListener((extraKeys) => {
      configureDynamicSensitiveKeys(extraKeys);
    });
    this.hooks.registerSensitiveFieldEvaluator(this.classificationService);
    this.hooks.registerLegalHoldGuard(this.legalHoldService);
    this.contributorsService.registerBuiltinContributorsAndRetention();
    await this.classificationService.refreshSensitiveFieldCache().catch(() => undefined);
  }
}
