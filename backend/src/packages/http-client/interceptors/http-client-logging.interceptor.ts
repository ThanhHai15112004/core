import { Logger } from '@nestjs/common';

export class HttpClientLoggingInterceptor {
  private static readonly logger = new Logger('OutboundHttpClient');

  public static logRequest(method: string, url: string): number {
    this.logger.debug(`--> ${method.toUpperCase()} ${url}`);
    return Date.now();
  }

  public static logResponse(method: string, url: string, status: number, startTime: number): void {
    const duration = Date.now() - startTime;
    this.logger.debug(`<-- ${method.toUpperCase()} ${url} [${status}] +${duration}ms`);
  }
}
