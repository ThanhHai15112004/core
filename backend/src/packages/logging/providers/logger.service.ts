import { Injectable, type LoggerService as NestLoggerService } from '@nestjs/common';
import type { LoggerContract } from '../contracts/logger.contract.js';
import { LogLevel } from '../constants/logging.constant.js';

@Injectable()
export class CoreLoggerService implements NestLoggerService, LoggerContract {
  private logLevel: LogLevel = LogLevel.INFO;

  public getLogLevel(): LogLevel {
    return this.logLevel;
  }

  public setLogLevel(level: LogLevel | string): void {
    this.logLevel = (level.toUpperCase() as LogLevel) || LogLevel.INFO;
  }

  public log(message: string, context?: string): void {
    const ctx = context ? `[${context}] ` : '';
    console.log(`${new Date().toISOString()} INFO ${ctx}${message}`);
  }

  public error(message: string, trace?: string, context?: string): void {
    const ctx = context ? `[${context}] ` : '';
    console.error(`${new Date().toISOString()} ERROR ${ctx}${message}${trace ? `\n${trace}` : ''}`);
  }

  public warn(message: string, context?: string): void {
    const ctx = context ? `[${context}] ` : '';
    console.warn(`${new Date().toISOString()} WARN ${ctx}${message}`);
  }

  public debug(message: string, context?: string): void {
    const ctx = context ? `[${context}] ` : '';
    console.debug(`${new Date().toISOString()} DEBUG ${ctx}${message}`);
  }

  public verbose(message: string, context?: string): void {
    const ctx = context ? `[${context}] ` : '';
    console.info(`${new Date().toISOString()} VERBOSE ${ctx}${message}`);
  }
}
