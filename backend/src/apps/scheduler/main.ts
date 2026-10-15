import 'reflect-metadata';
import { bootstrapScheduler } from './bootstrap/scheduler.bootstrap.js';

bootstrapScheduler().catch((error: unknown) => {
  // Ghi thẳng stderr để lỗi khởi động không bị nuốt (bufferLogs / process.exit) và hiện trong `docker logs`
  console.error('[SchedulerBootstrap] Khởi động thất bại:', error);
  process.exit(1);
});
