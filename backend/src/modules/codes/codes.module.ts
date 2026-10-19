import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CODES_PUBLIC_SERVICE } from './contracts/index.js';
import { CodeTypeEntity } from './entities/code-type.entity.js';
import { CodeValueEntity } from './entities/code-value.entity.js';
import { CodeTypeRepository } from './repositories/code-type.repository.js';
import { CodeValueRepository } from './repositories/code-value.repository.js';
import { CodesService } from './services/codes.service.js';
import { CodesController } from './controllers/codes.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([CodeTypeEntity, CodeValueEntity])],
  controllers: [CodesController],
  providers: [
    CodeTypeRepository,
    CodeValueRepository,
    CodesService,
    {
      provide: CODES_PUBLIC_SERVICE,
      useExisting: CodesService,
    },
  ],
  exports: [CodesService, CODES_PUBLIC_SERVICE],
})
export class CodesModule {}
