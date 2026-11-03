import { Module } from '@nestjs/common';
import { CUSTOM_FIELDS_PUBLIC_SERVICE } from './contracts/index.js';
import { CustomFieldsController } from './controllers/custom-fields.controller.js';
import { CustomFieldDefinitionRepository } from './repositories/custom-field-definition.repository.js';
import { CustomFieldHistoryRepository } from './repositories/custom-field-history.repository.js';
import { CustomFieldOptionRepository } from './repositories/custom-field-option.repository.js';
import { CustomFieldValueRepository } from './repositories/custom-field-value.repository.js';
import { CustomFieldsService } from './services/custom-fields.service.js';

@Module({
  controllers: [CustomFieldsController],
  providers: [
    CustomFieldDefinitionRepository,
    CustomFieldOptionRepository,
    CustomFieldValueRepository,
    CustomFieldHistoryRepository,
    CustomFieldsService,
    {
      provide: CUSTOM_FIELDS_PUBLIC_SERVICE,
      useExisting: CustomFieldsService,
    },
  ],
  exports: [CustomFieldsService, CUSTOM_FIELDS_PUBLIC_SERVICE],
})
export class CustomFieldsModule {}
