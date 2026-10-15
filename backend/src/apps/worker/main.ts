import 'reflect-metadata';
import { bootstrapWorker } from './bootstrap/worker.bootstrap.js';

bootstrapWorker().catch((error: unknown) => {
  // Ghi thẳng stderr để lỗi khởi động không bị nuốt (bufferLogs / process.exit) và hiện trong `docker logs`
  console.error('[WorkerBootstrap] Khởi động thất bại:', error);
  process.exit(1);
});
