import { Global, Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SEQUENCES_PUBLIC_SERVICE } from './contracts/index.js';
import { SequencesController } from './controllers/sequences.controller.js';
import { SequenceCounterEntity } from './entities/sequence-counter.entity.js';
import { SequenceRuleHistoryEntity } from './entities/sequence-rule-history.entity.js';
import { SequenceRuleEntity } from './entities/sequence-rule.entity.js';
import enSequences from './locales/en/sequences.json' with { type: 'json' };
import viSequences from './locales/vi/sequences.json' with { type: 'json' };
import { SequenceCounterRepository } from './repositories/sequence-counter.repository.js';
import { SequenceRuleHistoryRepository } from './repositories/sequence-rule-history.repository.js';
import { SequenceRuleRepository } from './repositories/sequence-rule.repository.js';
import { SequencesService } from './services/sequences.service.js';

new CoreI18nService().registerNamespace('sequences', { vi: viSequences, en: enSequences });

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SequenceRuleEntity,
      SequenceCounterEntity,
      SequenceRuleHistoryEntity,
    ]),
  ],
  controllers: [SequencesController],
  providers: [
    SequenceRuleRepository,
    SequenceCounterRepository,
    SequenceRuleHistoryRepository,
    SequencesService,
    {
      provide: SEQUENCES_PUBLIC_SERVICE,
      useExisting: SequencesService,
    },
  ],
  exports: [
    SequencesService,
    SEQUENCES_PUBLIC_SERVICE,
    SequenceRuleRepository,
    SequenceCounterRepository,
    SequenceRuleHistoryRepository,
  ],
})
export class SequencesModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('sequences', { vi: viSequences, en: enSequences });
  }
}
