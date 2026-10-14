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
import {
  AppException,
  classifyError,
  type ErrorCategory,
  HTTP_ERROR_CODE,
  HTTP_STATUS_CODE,
} from '@packages/kernel/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import type { ApiErrorResponse } from '../contracts/api-response.contract.js';
import { formatZodIssues } from '../utils/query-list.util.js';

interface NormalizedError {
  statusCode: number;
  code: string;
  message: string;
  details: unknown[];
  category: ErrorCategory;
  isOperational: boolean;
}

const FASTIFY_JSON_ERROR_CODES = new Set<string>([
  'FST_ERR_CTP_INVALID_JSON_BODY',
  'FST_ERR_CTP_EMPTY_JSON_BODY',
  'FST_ERR_CTP_INVALID_CONTENT_LENGTH',
]);

const FASTIFY_BODY_TOO_LARGE_CODE = 'FST_ERR_CTP_BODY_TOO_LARGE';
const FASTIFY_INVALID_MEDIA_TYPE_CODE = 'FST_ERR_CTP_INVALID_MEDIA_TYPE';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  /** Khởi tạo bộ lọc ngoại lệ toàn cục với dịch vụ đa ngôn ngữ */
  constructor(private readonly i18n: CoreI18nService) {}

  /** Bắt và xử lý ngoại lệ phát sinh trong quá trình thực thi */
  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<FastifyReply>();
    const { statusCode, code, message, details, isOperational } = this.normalize(exception);

    // Phân biệt rõ lỗi hệ thống (5xx / non-operational) và lỗi người dùng (4xx / operational):
    // Chỉ ghi log mức ERROR kèm stack trace khi là lỗi hệ thống nội bộ.
    if (!isOperational || statusCode >= HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR) {
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

  /** Chuẩn hóa mọi ngoại lệ đầu vào về định dạng chuẩn, phân biệt lỗi người dùng và lỗi hệ thống */
  private normalize(exception: unknown): NormalizedError {
    const classification = classifyError(exception);

    if (exception instanceof AppException) {
      return {
        statusCode: exception.statusCode,
        code: exception.code,
        message: this.i18n.t(exception.message, exception.messageParams),
        details: exception.details,
        category: classification.category,
        isOperational: classification.isOperational,
      };
    }

    if (exception instanceof ZodError) {
      return {
        statusCode: HTTP_STATUS_CODE.BAD_REQUEST,
        code: HTTP_ERROR_CODE.VALIDATION_FAILED,
        message: this.i18n.t(HTTP_ERROR_CODE.VALIDATION_FAILED),
        details: formatZodIssues(exception.issues),
        category: classification.category,
        isOperational: true,
      };
    }

    const fastifyNormalized = this.normalizeFastifyOrSyntaxError(exception);
    if (fastifyNormalized) {
      return fastifyNormalized;
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const res = exception.getResponse();
      const body = typeof res === 'object' && res !== null ? (res as Record<string, unknown>) : {};

      if (statusCode === HTTP_STATUS_CODE.PAYLOAD_TOO_LARGE) {
        return {
          statusCode,
          code: HTTP_ERROR_CODE.PAYLOAD_TOO_LARGE,
          message: this.i18n.t(HTTP_ERROR_CODE.PAYLOAD_TOO_LARGE),
          details: [],
          category: classification.category,
          isOperational: true,
        };
      }

      if (statusCode === HTTP_STATUS_CODE.UNSUPPORTED_MEDIA_TYPE) {
        return {
          statusCode,
          code: HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
          message: this.i18n.t(HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE),
          details: [],
          category: classification.category,
          isOperational: true,
        };
      }

      if (Array.isArray(body['message'])) {
        return {
          statusCode,
          code: HTTP_ERROR_CODE.VALIDATION_FAILED,
          message: this.i18n.t(HTTP_ERROR_CODE.VALIDATION_FAILED),
          details: body['message'],
          category: classification.category,
          isOperational: classification.isOperational,
        };
      }

      const rawMessage =
        typeof res === 'string'
          ? res
          : typeof body['message'] === 'string'
            ? body['message']
            : undefined;

      // Nếu HttpException bọc lỗi cú pháp JSON từ Fastify
      if (
        statusCode === HTTP_STATUS_CODE.BAD_REQUEST &&
        typeof rawMessage === 'string' &&
        (rawMessage.includes('Unexpected token') ||
          rawMessage.includes('JSON') ||
          rawMessage.includes('FST_ERR_CTP_'))
      ) {
        return {
          statusCode: HTTP_STATUS_CODE.BAD_REQUEST,
          code: HTTP_ERROR_CODE.INVALID_JSON_PAYLOAD,
          message: this.i18n.t(HTTP_ERROR_CODE.INVALID_JSON_PAYLOAD),
          details: [],
          category: classification.category,
          isOperational: true,
        };
      }

      const code = HttpStatus[statusCode] ?? HTTP_ERROR_CODE.HTTP_ERROR;

      // Nếu là lỗi 5xx từ HttpException không phải AppException -> ẩn thông báo gốc nhạy cảm
      if (statusCode >= HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR) {
        return {
          statusCode,
          code:
            statusCode === HTTP_STATUS_CODE.SERVICE_UNAVAILABLE
              ? HTTP_ERROR_CODE.SERVICE_UNAVAILABLE
              : HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR,
          message: this.i18n.t(
            statusCode === HTTP_STATUS_CODE.SERVICE_UNAVAILABLE
              ? HTTP_ERROR_CODE.SERVICE_UNAVAILABLE
              : HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR,
          ),
          details: [],
          category: classification.category,
          isOperational: false,
        };
      }

      return {
        statusCode,
        code,
        message: this.i18n.t(rawMessage ?? code),
        details: [],
        category: classification.category,
        isOperational: classification.isOperational,
      };
    }

    // Lỗi hệ thống không lường trước (Unhandled System Error):
    // Tuyệt đối không trả message gốc cho client để tránh lộ thông tin nội bộ (SQL, stack, path).
    return {
      statusCode: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR,
      code: HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR,
      message: this.i18n.t(HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR),
      details: [],
      category: classification.category,
      isOperational: false,
    };
  }

  /** Nhận diện và chuẩn hóa các lỗi phát sinh từ tầng Fastify Parser (JSON hỏng, body quá lớn, sai Content-Type) */
  private normalizeFastifyOrSyntaxError(exception: unknown): NormalizedError | null {
    if (typeof exception !== 'object' || exception === null) {
      return null;
    }

    const errRecord = exception as Record<string, unknown>;
    const fastifyCode = typeof errRecord['code'] === 'string' ? errRecord['code'] : undefined;
    const rawStatus =
      typeof errRecord['statusCode'] === 'number' ? errRecord['statusCode'] : undefined;

    if (fastifyCode && FASTIFY_JSON_ERROR_CODES.has(fastifyCode)) {
      return {
        statusCode: HTTP_STATUS_CODE.BAD_REQUEST,
        code: HTTP_ERROR_CODE.INVALID_JSON_PAYLOAD,
        message: this.i18n.t(HTTP_ERROR_CODE.INVALID_JSON_PAYLOAD),
        details: [],
        category: 'CLIENT',
        isOperational: true,
      };
    }

    if (
      fastifyCode === FASTIFY_BODY_TOO_LARGE_CODE ||
      rawStatus === HTTP_STATUS_CODE.PAYLOAD_TOO_LARGE
    ) {
      return {
        statusCode: HTTP_STATUS_CODE.PAYLOAD_TOO_LARGE,
        code: HTTP_ERROR_CODE.PAYLOAD_TOO_LARGE,
        message: this.i18n.t(HTTP_ERROR_CODE.PAYLOAD_TOO_LARGE),
        details: [],
        category: 'CLIENT',
        isOperational: true,
      };
    }

    if (
      fastifyCode === FASTIFY_INVALID_MEDIA_TYPE_CODE ||
      rawStatus === HTTP_STATUS_CODE.UNSUPPORTED_MEDIA_TYPE
    ) {
      return {
        statusCode: HTTP_STATUS_CODE.UNSUPPORTED_MEDIA_TYPE,
        code: HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
        message: this.i18n.t(HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE),
        details: [],
        category: 'CLIENT',
        isOperational: true,
      };
    }

    if (exception instanceof SyntaxError && rawStatus === HTTP_STATUS_CODE.BAD_REQUEST) {
      return {
        statusCode: HTTP_STATUS_CODE.BAD_REQUEST,
        code: HTTP_ERROR_CODE.INVALID_JSON_PAYLOAD,
        message: this.i18n.t(HTTP_ERROR_CODE.INVALID_JSON_PAYLOAD),
        details: [],
        category: 'CLIENT',
        isOperational: true,
      };
    }

    return null;
  }
}
