import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { UsersModule } from '@modules/users/index.js';
import { SEARCH_PUBLIC_SERVICE } from './contracts/index.js';
import { SearchDocumentEntity } from './entities/search-document.entity.js';
import { SearchSyncHistoryEntity } from './entities/search-sync-history.entity.js';
import { SearchZeroResultKeywordEntity } from './entities/search-zero-result-keyword.entity.js';
import { SearchDocumentRepository } from './repositories/search-document.repository.js';
import { SearchSyncHistoryRepository } from './repositories/search-sync-history.repository.js';
import { SearchZeroResultKeywordRepository } from './repositories/search-zero-result-keyword.repository.js';
import { SearchService } from './services/search.service.js';
import { SearchController } from './controllers/search.controller.js';
import enSearch from './locales/en/search.json' with { type: 'json' };
import viSearch from './locales/vi/search.json' with { type: 'json' };

new CoreI18nService().registerNamespace('search', { vi: viSearch, en: enSearch });

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    UsersModule,
    TypeOrmModule.forFeature([
      SearchDocumentEntity,
      SearchSyncHistoryEntity,
      SearchZeroResultKeywordEntity,
    ]),
  ],
  controllers: [SearchController],
  providers: [
    SearchDocumentRepository,
    SearchSyncHistoryRepository,
    SearchZeroResultKeywordRepository,
    SearchService,
    {
      provide: SEARCH_PUBLIC_SERVICE,
      useExisting: SearchService,
    },
  ],
  exports: [SearchService, SEARCH_PUBLIC_SERVICE],
})
export class SearchModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('search', { vi: viSearch, en: enSearch });
  }
}
