import { Injectable, type LoggerService as NestLoggerService } from '@nestjs/common';
import type { LoggerContract } from '../contracts/logger.contract.js';

@Injectable()
export class CoreLoggerService implements NestLoggerService, LoggerContract {
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
