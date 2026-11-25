import type { Logger } from '@nestjs/common';
import type { RuntimeAgentService } from './runtime-agent.service.js';

export interface GracefulShutdownOptions {
  readonly app: { close(): Promise<void> };
  readonly agent: RuntimeAgentService;
  readonly logger: Logger;
  readonly drainDelayMs: number;
  readonly gracefulTimeoutMs: number;
  readonly signals?: readonly NodeJS.Signals[];
  readonly onExit?: (code: number) => void;
}

const DEFAULT_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Điều phối Graceful Shutdown + Connection Draining dùng chung cho API / Worker / Scheduler:
 * 1. Bắt `SIGTERM` / `SIGINT` (idempotent, bỏ qua signal lặp lại khi đang shutdown).
 * 2. Gắn hard-deadline timer `gracefulTimeoutMs` chống treo tiến trình.
 * 3. Đưa `RuntimeAgentService` sang trạng thái `draining` (`/health/ready` = 503, `/health/live` = 200).
 * 4. Chờ `drainDelayMs` để Load Balancer / Nginx / Kubernetes rút instance khỏi pool.
 * 5. Chờ `contributor.drain()` hoàn tất in-flight requests / queue jobs trong phần thời gian còn lại.
 * 6. Gọi `app.close()` (chạy đầy đủ NestJS lifecycle hooks: DB, Redis, Metrics, Tracing) rồi thoát sạch.
 */
export function installGracefulShutdown(options: GracefulShutdownOptions): () => void {
  const {
    app,
    agent,
    logger,
    drainDelayMs,
    gracefulTimeoutMs,
    signals = DEFAULT_SIGNALS,
    onExit = (code: number) => process.exit(code),
  } = options;

  let shuttingDown = false;

  const executeShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      logger.warn(`Received duplicate ${signal} during shutdown; ignoring`);
      return;
    }
    shuttingDown = true;

    const startedAt = Date.now();
    const totalBudgetMs = Math.max(1000, gracefulTimeoutMs);
    const effectiveDrainDelayMs = Math.max(0, Math.min(drainDelayMs, Math.max(0, totalBudgetMs - 500)));
    let exited = false;

    const finish = (code: number) => {
      if (exited) return;
      exited = true;
      clearTimeout(deadlineTimer);
      onExit(code);
    };

    const deadlineTimer = setTimeout(() => {
      logger.error(
        `Graceful shutdown exceeded ${totalBudgetMs}ms hard deadline on ${signal}; forcing exit`,
      );
      finish(1);
    }, totalBudgetMs);
    deadlineTimer.unref();

    logger.log(
      `Received ${signal}; starting connection draining (drainDelayMs=${effectiveDrainDelayMs}, gracefulTimeoutMs=${totalBudgetMs})`,
    );

    try {
      await agent.beginDraining(signal);

      if (effectiveDrainDelayMs > 0) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, effectiveDrainDelayMs);
          t.unref();
        });
      }

      const elapsedMs = Date.now() - startedAt;
      const remainingMs = Math.max(250, totalBudgetMs - elapsedMs);
      await agent.executeContributorDrain(remainingMs);

      await app.close();
      logger.log(`Graceful shutdown completed cleanly in ${Date.now() - startedAt}ms`);
      finish(0);
    } catch (error) {
      logger.error(
        `Graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      finish(1);
    }
  };

  const listeners = new Map<NodeJS.Signals, () => void>();
  for (const sig of signals) {
    const handler = () => {
      void executeShutdown(sig);
    };
    listeners.set(sig, handler);
    process.on(sig, handler);
  }

  return () => {
    for (const [sig, handler] of listeners.entries()) {
      process.off(sig, handler);
    }
    listeners.clear();
  };
}
