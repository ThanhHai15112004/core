import { Logger } from '@nestjs/common';
import type { Logger as ITypeOrmLogger, QueryRunner } from 'typeorm';

/**
 * Custom TypeORM Logger chuyển log sang Pino qua NestJS Logger.
 * Luôn ghi log slow query (dựa trên maxQueryExecutionTime) và query error; lỗi query còn được chuyển cho
 * `onQueryError` (lưu danh sách lỗi cho trang Database).
 */
export class TypeOrmPinoLogger implements ITypeOrmLogger {
  private readonly logger = new Logger('TypeORM');

  constructor(
    private readonly loggingEnabled = false,
    private readonly onQueryError?: (error: unknown, query: string) => void,
  ) {}

  public logQuery(query: string, parameters?: unknown[], _queryRunner?: QueryRunner): void {
    if (this.loggingEnabled) {
      this.logger.debug({ query, parameters }, `[Query] ${query.slice(0, 300)}`);
    }
  }

  public logQueryError(
    error: string | Error,
    query: string,
    parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ): void {
    const msg = error instanceof Error ? error.message : String(error);
    this.logger.error({ query, parameters, error: msg }, `[Query Error] ${msg}`);
    this.onQueryError?.(error, query);
  }

  public logQuerySlow(
    time: number,
    query: string,
    parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ): void {
    this.logger.warn(
      { query, durationMs: time, parameters },
      `[Slow Query] Execution took ${time}ms: ${query.slice(0, 300)}`,
    );
  }

  public logSchemaBuild(message: string, _queryRunner?: QueryRunner): void {
    this.logger.log(`[Schema Build] ${message}`);
  }

  public logMigration(message: string, _queryRunner?: QueryRunner): void {
    this.logger.log(`[Migration] ${message}`);
  }

  public log(level: 'log' | 'info' | 'warn', message: unknown, _queryRunner?: QueryRunner): void {
    if (level === 'warn') {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }
}
