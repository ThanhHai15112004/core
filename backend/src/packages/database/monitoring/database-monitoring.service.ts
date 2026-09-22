import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import { QueryInstrumentService } from '../instrumentation/query-instrument.service.js';
import { sanitizeDbMessage } from '../instrumentation/error-classify.js';
import { BasicMonitoringProvider } from './basic.provider.js';
import { MysqlMonitoringProvider } from './mysql.provider.js';
import { PostgresMonitoringProvider } from './postgres.provider.js';
import type {
  DatabaseMonitoringProvider,
  MonitoringCapability,
  MonitoringContext,
} from './monitoring.types.js';

/** Kết quả của một phần số liệu: có dữ liệu, hoặc lý do không có (không làm hỏng cả trang). */
export type Section<T> =
  | { available: true; data: T }
  | { available: false; reason: 'unsupported' | 'disconnected' | 'error'; message: string | null };

export class DatabaseUnavailableError extends Error {
  constructor(public readonly state: string) {
    super(`Database is ${state}`);
  }
}

/** Đọc số liệu vận hành của database qua provider theo driver. Mọi truy vấn không tính vào số liệu của app. */
@Injectable()
export class DatabaseMonitoringService {
  private cached: DatabaseMonitoringProvider | null = null;

  constructor(
    private readonly connection: DatabaseConnectionService,
    private readonly instrument: QueryInstrumentService,
    private readonly config: CoreConfigService,
  ) {}

  /** Provider theo driver thật của DataSource (xác định sau khi app khởi động). */
  public get provider(): DatabaseMonitoringProvider {
    const driver = this.connection.driver;
    if (this.cached?.driver !== driver) this.cached = MonitoringProviderFactory(driver);
    return this.cached;
  }

  public supports(capability: MonitoringCapability): boolean {
    return this.provider.capabilities.has(capability);
  }

  /** Chạy `fn` trên một connection riêng của pool (các câu trong cùng một lần đọc thấy cùng session). */
  public async withContext<T>(fn: (ctx: MonitoringContext) => Promise<T>): Promise<T> {
    const ds = this.connection.connected();
    if (!ds) throw new DatabaseUnavailableError(this.connection.getStatus().state);
    return this.instrument.untracked(async () => {
      const runner = ds.createQueryRunner();
      try {
        await runner.connect();
        const ctx: MonitoringContext = {
          run: (sql, params) => runner.query(sql, params) as Promise<never[]>,
          database: this.config.database.database,
          user: this.config.database.username,
        };
        await this.provider.prepare?.(ctx);
        return await fn(ctx);
      } finally {
        await runner.release().catch(() => undefined);
      }
    });
  }

  /**
   * Đọc nhiều phần trên CÙNG một connection, tuần tự (không chiếm nhiều connection của pool).
   * Mỗi phần lỗi riêng; database mất kết nối → mọi phần là `disconnected`.
   */
  public async batch<R>(
    build: (
      part: <T>(
        cap: MonitoringCapability,
        fn: (ctx: MonitoringContext) => Promise<T>,
      ) => Promise<Section<T>>,
    ) => Promise<R>,
  ): Promise<R> {
    try {
      return await this.withContext((ctx) =>
        build(async (cap, fn) => {
          if (!this.supports(cap))
            return { available: false, reason: 'unsupported', message: null };
          try {
            return { available: true, data: await fn(ctx) };
          } catch (err) {
            return { available: false, reason: 'error', message: sanitizeDbMessage(err) };
          }
        }),
      );
    } catch (err) {
      const reason: Section<never> =
        err instanceof DatabaseUnavailableError
          ? { available: false, reason: 'disconnected', message: err.state }
          : { available: false, reason: 'error', message: sanitizeDbMessage(err) };
      return build(async (cap) =>
        this.supports(cap) ? reason : { available: false, reason: 'unsupported', message: null },
      );
    }
  }

  /** Một phần số liệu có kiểm tra capability + bắt lỗi riêng. */
  public async section<T>(
    capability: MonitoringCapability,
    fn: (ctx: MonitoringContext) => Promise<T>,
  ): Promise<Section<T>> {
    if (!this.supports(capability))
      return { available: false, reason: 'unsupported', message: null };
    try {
      return { available: true, data: await this.withContext(fn) };
    } catch (err) {
      if (err instanceof DatabaseUnavailableError)
        return { available: false, reason: 'disconnected', message: err.state };
      return { available: false, reason: 'error', message: sanitizeDbMessage(err) };
    }
  }
}

/** Chọn provider theo `DataSource.options.type`. */
export function MonitoringProviderFactory(driver: string): DatabaseMonitoringProvider {
  switch (driver) {
    case 'mysql':
    case 'mariadb':
      return new MysqlMonitoringProvider();
    case 'postgres':
      return new PostgresMonitoringProvider();
    default:
      return new BasicMonitoringProvider(driver);
  }
}
