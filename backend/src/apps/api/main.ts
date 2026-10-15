import 'reflect-metadata';
import { bootstrapApi } from './bootstrap/server.bootstrap.js';

bootstrapApi().catch((error: unknown) => {
  // Ghi thẳng stderr để lỗi khởi động không bị nuốt (bufferLogs / process.exit) và hiện trong `docker logs`
  console.error('[ApiBootstrap] Khởi động thất bại:', error);
  process.exit(1);
});
