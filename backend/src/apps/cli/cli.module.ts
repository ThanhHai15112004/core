import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { KernelModule } from '@packages/kernel/index.js';
import { ConfigModule } from '@packages/config/index.js';
import { LoggingModule } from '@packages/logging/index.js';
import { I18nModule } from '@packages/i18n/index.js';
import { DatabaseModule } from '@packages/database/index.js';
import { CacheModule } from '@packages/cache/index.js';
import { StorageModule } from '@packages/storage/index.js';
import { MessagingModule } from '@packages/messaging/index.js';
import { RedisModule } from '@packages/redis/index.js';
import { RuntimeAgentModule } from '@packages/runtime/index.js';

// CLI Dispatcher & Services
import { CliDispatcherService } from './dispatcher/cli-dispatcher.service.js';
import { ManifestService } from './services/manifest.service.js';
import { ModuleScaffolderService } from './services/module-scaffolder.service.js';
import { ArchitectureLinterService } from './services/architecture-linter.service.js';

// Commands
import { SystemCommand } from './commands/system/system.command.js';
import { ModuleCommand } from './commands/module/module.command.js';
import { DoctorCommand } from './commands/health/doctor.command.js';
import { MigrationCommand } from './commands/database/migration.command.js';
import { SeedCommand } from './commands/database/seed.command.js';
import { ArchitectureCommand } from './commands/architecture/architecture.command.js';
import { OpenApiCommand } from './commands/architecture/openapi.command.js';

@Module({
  imports: [
    KernelModule,
    ConfigModule,
    RedisModule,
    RuntimeAgentModule.forRuntime({ id: 'cli', kind: 'on-demand' }),
    I18nModule,
    LoggingModule.forRoot({ runtime: 'cli' }),
    DatabaseModule,
    CacheModule,
    StorageModule,
    MessagingModule,
  ],
  providers: [
    CliDispatcherService,
    ManifestService,
    ModuleScaffolderService,
    ArchitectureLinterService,
    SystemCommand,
    ModuleCommand,
    DoctorCommand,
    MigrationCommand,
    SeedCommand,
    ArchitectureCommand,
    OpenApiCommand,
  ],
  exports: [
    CliDispatcherService,
    ManifestService,
    ModuleScaffolderService,
    ArchitectureLinterService,
    SystemCommand,
    ModuleCommand,
    DoctorCommand,
    MigrationCommand,
    SeedCommand,
    ArchitectureCommand,
    OpenApiCommand,
  ],
})
export class CliModule implements OnApplicationBootstrap {
  constructor(
    private readonly dispatcher: CliDispatcherService,
    private readonly systemCommand: SystemCommand,
    private readonly moduleCommand: ModuleCommand,
    private readonly doctorCommand: DoctorCommand,
    private readonly migrationCommand: MigrationCommand,
    private readonly seedCommand: SeedCommand,
    private readonly architectureCommand: ArchitectureCommand,
    private readonly openApiCommand: OpenApiCommand,
  ) {}

  /** Đăng ký toàn bộ các command providers vào dispatcher khi ứng dụng khởi chạy */
  public onApplicationBootstrap(): void {
    // Đăng ký toàn bộ command providers vào dispatcher
    this.dispatcher.registerProvider(this.systemCommand);
    this.dispatcher.registerProvider(this.moduleCommand);
    this.dispatcher.registerProvider(this.doctorCommand);
    this.dispatcher.registerProvider(this.migrationCommand);
    this.dispatcher.registerProvider(this.seedCommand);
    this.dispatcher.registerProvider(this.architectureCommand);
    this.dispatcher.registerProvider(this.openApiCommand);
  }
}
