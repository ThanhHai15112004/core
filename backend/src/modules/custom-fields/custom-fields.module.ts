import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CUSTOM_FIELDS_PUBLIC_SERVICE } from './contracts/index.js';
import { CustomFieldsController } from './controllers/custom-fields.controller.js';
import { CustomFieldDefinitionEntity } from './entities/custom-field-definition.entity.js';
import { CustomFieldHistoryEntity } from './entities/custom-field-history.entity.js';
import { CustomFieldOptionEntity } from './entities/custom-field-option.entity.js';
import { CustomFieldValueEntity } from './entities/custom-field-value.entity.js';
import { CustomFieldDefinitionRepository } from './repositories/custom-field-definition.repository.js';
import { CustomFieldHistoryRepository } from './repositories/custom-field-history.repository.js';
import { CustomFieldOptionRepository } from './repositories/custom-field-option.repository.js';
import { CustomFieldValueRepository } from './repositories/custom-field-value.repository.js';
import { CustomFieldsService } from './services/custom-fields.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomFieldDefinitionEntity,
      CustomFieldOptionEntity,
      CustomFieldValueEntity,
      CustomFieldHistoryEntity,
    ]),
  ],
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
