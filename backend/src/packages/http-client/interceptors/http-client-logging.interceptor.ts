import { Logger } from '@nestjs/common';

export class HttpClientLoggingInterceptor {
  private static readonly logger = new Logger('OutboundHttpClient');

  /** Ghi nhận thông tin chi tiết về yêu cầu HTTP vừa nhận được */
  public static logRequest(method: string, url: string): number {
    this.logger.debug(`--> ${method.toUpperCase()} ${url}`);
    return Date.now();
  }

  /** Ghi nhận thông tin phản hồi HTTP và thời gian xử lý */
  public static logResponse(method: string, url: string, status: number, startTime: number): void {
    const duration = Date.now() - startTime;
    this.logger.debug(`<-- ${method.toUpperCase()} ${url} [${status}] +${duration}ms`);
  }
}
