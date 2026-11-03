import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { FilesModule } from '@modules/files/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { UsersModule } from '@modules/users/index.js';
import { COMMENTS_PUBLIC_SERVICE } from './contracts/index.js';
import { CommentsController } from './controllers/comments.controller.js';
import { RecordCommentHistoryEntity } from './entities/record-comment-history.entity.js';
import { RecordCommentEntity } from './entities/record-comment.entity.js';
import { RecordCommentHistoryRepository } from './repositories/record-comment-history.repository.js';
import { RecordCommentRepository } from './repositories/record-comment.repository.js';
import { CommentsService } from './services/comments.service.js';
import enComments from './locales/en/comments.json' with { type: 'json' };
import viComments from './locales/vi/comments.json' with { type: 'json' };

new CoreI18nService().registerNamespace('comments', {
  vi: viComments,
  en: enComments,
});

@Module({
  imports: [
    TypeOrmModule.forFeature([RecordCommentEntity, RecordCommentHistoryEntity]),
    UsersModule,
    RolesModule,
    NotificationsModule,
    FilesModule,
  ],
  controllers: [CommentsController],
  providers: [
    RecordCommentRepository,
    RecordCommentHistoryRepository,
    CommentsService,
    {
      provide: COMMENTS_PUBLIC_SERVICE,
      useExisting: CommentsService,
    },
  ],
  exports: [CommentsService, COMMENTS_PUBLIC_SERVICE],
})
export class CommentsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('comments', {
      vi: viComments,
      en: enComments,
    });
  }
}
