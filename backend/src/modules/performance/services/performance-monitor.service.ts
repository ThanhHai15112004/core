import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';

/**
 * PerformanceMonitorService — tiến trình nền đánh giá hiệu năng (tương thích ngược).
 */
@Injectable()
export class PerformanceMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  public onApplicationBootstrap(): void {}
  public onModuleDestroy(): void {}
  public async tick(): Promise<number> {
    return 0;
  }
}
