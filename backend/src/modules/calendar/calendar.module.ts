import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { UsersModule } from '@modules/users/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { CALENDAR_PUBLIC_SERVICE } from './contracts/index.js';
import { CalendarEventEntity } from './entities/calendar-event.entity.js';
import { CalendarEventParticipantEntity } from './entities/calendar-event-participant.entity.js';
import { CalendarEventReminderEntity } from './entities/calendar-event-reminder.entity.js';
import { CalendarEventHistoryEntity } from './entities/calendar-event-history.entity.js';
import { CalendarEventRepository } from './repositories/calendar-event.repository.js';
import { CalendarEventParticipantRepository } from './repositories/calendar-event-participant.repository.js';
import { CalendarEventReminderRepository } from './repositories/calendar-event-reminder.repository.js';
import { CalendarEventHistoryRepository } from './repositories/calendar-event-history.repository.js';
import { CalendarService } from './services/calendar.service.js';
import { CalendarController } from './controllers/calendar.controller.js';
import enCalendar from './locales/en/calendar.json' with { type: 'json' };
import viCalendar from './locales/vi/calendar.json' with { type: 'json' };

new CoreI18nService().registerNamespace('calendar', { vi: viCalendar, en: enCalendar });

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CalendarEventEntity,
      CalendarEventParticipantEntity,
      CalendarEventReminderEntity,
      CalendarEventHistoryEntity,
    ]),
    SecurityModule,
    OrganizationsModule,
    UsersModule,
    NotificationsModule,
  ],
  controllers: [CalendarController],
  providers: [
    CalendarEventRepository,
    CalendarEventParticipantRepository,
    CalendarEventReminderRepository,
    CalendarEventHistoryRepository,
    CalendarService,
    {
      provide: CALENDAR_PUBLIC_SERVICE,
      useExisting: CalendarService,
    },
  ],
  exports: [CalendarService, CALENDAR_PUBLIC_SERVICE],
})
export class CalendarModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('calendar', { vi: viCalendar, en: enCalendar });
  }
}
