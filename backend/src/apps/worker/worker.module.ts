import { Module } from '@nestjs/common';
import { KernelModule } from '@packages/kernel/index.js';
import { ConfigModule } from '@packages/config/index.js';
import { LoggingModule } from '@packages/logging/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { I18nModule } from '@packages/i18n/index.js';
import { DatabaseModule } from '@packages/database/index.js';
import { MessagingModule } from '@packages/messaging/index.js';
import { QueueModule } from '@packages/queue/index.js';
import { CacheModule } from '@packages/cache/index.js';
import { StorageModule } from '@packages/storage/index.js';
import { HttpClientModule } from '@packages/http-client/index.js';
import { RedisModule } from '@packages/redis/index.js';
import { RuntimeAgentModule } from '@packages/runtime/index.js';
import { MetricsModule } from '@packages/metrics/index.js';
import { TracingModule } from '@packages/tracing/index.js';
import { AuditModule } from '@modules/audit/index.js';
import { UsersModule } from '@modules/users/index.js';
import { SessionsModule } from '@modules/sessions/index.js';
import { CredentialsModule } from '@modules/credentials/index.js';
import { FilesModule } from '@modules/files/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { NotificationDeliveryModule } from '@modules/notification-delivery/index.js';
import { TemplatesModule } from '@modules/templates/index.js';
import { WorkflowsModule } from '@modules/workflows/index.js';
import { CalendarModule } from '@modules/calendar/index.js';
import { ImportsModule } from '@modules/imports/index.js';
import { ExportsModule } from '@modules/exports/index.js';
import { ReportsModule } from '@modules/reports/index.js';
import { SearchModule } from '@modules/search/index.js';
import { CustomFieldsModule } from '@modules/custom-fields/index.js';
import { WebhooksModule } from '@modules/webhooks/index.js';
import { InboundWebhooksModule } from '@modules/inbound-webhooks/index.js';
import { OutboxModule } from '@modules/outbox/index.js';
import { IdempotencyModule } from '@modules/idempotency/index.js';
import { PaymentsModule } from '@modules/payments/index.js';
import { ReconciliationModule } from '@modules/reconciliation/index.js';
import { SystemProcessor } from './processors/system/system.processor.js';
import { CriticalProcessor } from './processors/critical/critical.processor.js';
import { NotificationsProcessor } from './processors/notifications/notifications.processor.js';
import { HeavyJobProcessor } from './processors/heavy/heavy-job.processor.js';
import { WorkerRuntimeContributor } from './runtime/worker-runtime.contributor.js';
import { OutboxRelayRunner } from './runtime/outbox-relay.runner.js';

const PROCESSORS = [SystemProcessor, CriticalProcessor, NotificationsProcessor, HeavyJobProcessor];

@Module({
  imports: [
    KernelModule,
    ConfigModule,
    RedisModule,
    RuntimeAgentModule.forRuntime({ id: 'worker', kind: 'long-running' }),
    MetricsModule.forRuntime({ runtime: 'worker', port: 9101 }),
    I18nModule,
    TracingModule.forRuntime({ runtime: 'worker' }),
    LoggingModule.forRoot({ runtime: 'worker' }),
    DatabaseModule,
    SecurityModule,
    MessagingModule,
    QueueModule,
    CacheModule,
    StorageModule,
    HttpClientModule,
    AuditModule,
    UsersModule,
    SessionsModule,
    CredentialsModule,
    FilesModule,
    NotificationsModule,
    NotificationDeliveryModule,
    TemplatesModule,
    WorkflowsModule,
    CalendarModule,
    ImportsModule,
    ExportsModule,
    ReportsModule,
    SearchModule,
    CustomFieldsModule,
    WebhooksModule,
    InboundWebhooksModule,
    OutboxModule,
    IdempotencyModule,
    PaymentsModule,
    ReconciliationModule,
  ],
  providers: [...PROCESSORS, WorkerRuntimeContributor, OutboxRelayRunner],
  exports: [...PROCESSORS],
})
export class WorkerModule {}
