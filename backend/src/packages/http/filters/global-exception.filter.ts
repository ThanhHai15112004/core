import {
  type ArgumentsHost,
  type ExceptionFilter,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AppException } from '@packages/kernel/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import type { ApiErrorResponse } from '../contracts/api-response.contract.js';

interface NormalizedError {
  statusCode: number;
  code: string;
  message: string;
  details: unknown[];
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly i18n: CoreI18nService) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const { statusCode, code, message, details } = this.normalize(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `[${code}] ${exception instanceof Error ? exception.message : message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const payload: ApiErrorResponse = {
      success: false,
      statusCode,
      error: {
        code,
        message,
        ...(details.length > 0 ? { details } : {}),
      },
      timestamp: new Date().toISOString(),
    };

    void response.status(statusCode).send(payload);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.statusCode,
        code: exception.code,
        message: this.i18n.t(exception.message, exception.messageParams),
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const code = HttpStatus[statusCode] ?? 'HTTP_ERROR';
      const res = exception.getResponse();
      const body = typeof res === 'object' && res !== null ? (res as Record<string, unknown>) : {};

      if (Array.isArray(body['message'])) {
        return {
          statusCode,
          code: 'VALIDATION_FAILED',
          message: this.i18n.t('VALIDATION_FAILED'),
          details: body['message'],
        };
      }

      const raw =
        typeof res === 'string'
          ? res
          : typeof body['message'] === 'string'
            ? body['message']
            : undefined;
      return { statusCode, code, message: this.i18n.t(raw ?? code), details: [] };
    }

    // Lỗi không lường trước: không trả message gốc cho client để tránh lộ thông tin nội bộ.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: this.i18n.t('INTERNAL_SERVER_ERROR'),
      details: [],
    };
  }
}
