import {
  type ArgumentsHost,
  type ExceptionFilter,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppException, HTTP_ERROR_CODE, HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import type { ApiErrorResponse } from '../contracts/api-response.contract.js';
import { formatZodIssues } from '../utils/query-list.util.js';

interface NormalizedError {
  statusCode: number;
  code: string;
  message: string;
  details: unknown[];
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  /** Khởi tạo bộ lọc ngoại lệ toàn cục với dịch vụ đa ngôn ngữ */
  constructor(private readonly i18n: CoreI18nService) {}

  /** Bắt và xử lý ngoại lệ phát sinh trong quá trình thực thi */
  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<FastifyReply>();
    const { statusCode, code, message, details } = this.normalize(exception);

    if (statusCode >= HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR) {
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

  /** Chuẩn hóa định dạng dữ liệu đầu vào về dạng chuẩn của hệ thống */
  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.statusCode,
        code: exception.code,
        message: this.i18n.t(exception.message, exception.messageParams),
        details: exception.details,
      };
    }

    if (exception instanceof ZodError) {
      return {
        statusCode: HTTP_STATUS_CODE.BAD_REQUEST,
        code: HTTP_ERROR_CODE.VALIDATION_FAILED,
        message: this.i18n.t(HTTP_ERROR_CODE.VALIDATION_FAILED),
        details: formatZodIssues(exception.issues),
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const code = HttpStatus[statusCode] ?? HTTP_ERROR_CODE.HTTP_ERROR;
      const res = exception.getResponse();
      const body = typeof res === 'object' && res !== null ? (res as Record<string, unknown>) : {};

      if (Array.isArray(body['message'])) {
        return {
          statusCode,
          code: HTTP_ERROR_CODE.VALIDATION_FAILED,
          message: this.i18n.t(HTTP_ERROR_CODE.VALIDATION_FAILED),
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
      statusCode: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR,
      code: HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR,
      message: this.i18n.t(HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR),
      details: [],
    };
  }
}
