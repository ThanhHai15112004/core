import { Global, Module } from '@nestjs/common';
import { SchedulerStore } from './store/scheduler-store.service.js';

/** Lưu trữ Scheduler trong Redis (cần `RedisModule` & `ConfigModule`) — dùng chung cho runtime và System Console. */
@Global()
@Module({ providers: [SchedulerStore], exports: [SchedulerStore] })
export class SchedulerStoreModule {}
