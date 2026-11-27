import {
  type ArgumentsHost,
  type ExceptionFilter,
  Catch,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppException } from '@packages/kernel/index.js';
import { SCIM_CONTENT_TYPE, SCIM_SCHEMAS } from '../enum/identity-provisioning.enum.js';
import type { ScimErrorResponse } from '../types/identity-provisioning.types.js';

export type ScimErrorType =
  | 'invalidFilter'
  | 'tooMany'
  | 'uniqueness'
  | 'mutability'
  | 'invalidSyntax'
  | 'invalidPath'
  | 'noTarget'
  | 'invalidValue'
  | 'invalidVers'
  | 'sensitive';

export class ScimProtocolException extends Error {
  public readonly httpStatus: number;
  public readonly scimType?: ScimErrorType | undefined;
  public readonly detail: string;
  public readonly errorCode: string;

  constructor(httpStatus: number, detail: string, scimType?: ScimErrorType, errorCode?: string) {
    super(detail);
    this.name = 'ScimProtocolException';
    this.httpStatus = httpStatus;
    this.scimType = scimType;
    this.detail = detail;
    this.errorCode =
      errorCode ?? (scimType ? `SCIM_${scimType.toUpperCase()}` : `SCIM_${httpStatus}`);
  }
}

export function buildScimErrorPayload(
  status: number,
  detail: string,
  scimType?: ScimErrorType,
): ScimErrorResponse {
  return {
    schemas: [SCIM_SCHEMAS.ERROR],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  };
}

@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let scimType: ScimErrorType | undefined;
    let detail = 'Internal server error';

    if (exception instanceof ScimProtocolException) {
      statusCode = exception.httpStatus;
      scimType = exception.scimType;
      detail = exception.detail;
    } else if (exception instanceof AppException) {
      statusCode = exception.statusCode;
      detail = exception.message;
      if (statusCode === HttpStatus.CONFLICT) {
        scimType = 'uniqueness';
      } else if (statusCode === HttpStatus.BAD_REQUEST) {
        scimType = 'invalidValue';
      }
    } else if (exception instanceof ZodError) {
      statusCode = HttpStatus.BAD_REQUEST;
      scimType = 'invalidSyntax';
      detail = exception.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const raw = exception.getResponse();
      if (typeof raw === 'string') {
        detail = raw;
      } else if (typeof raw === 'object' && raw !== null && 'message' in raw) {
        const msg = (raw as { message?: unknown }).message;
        detail = Array.isArray(msg) ? msg.join('; ') : String(msg ?? exception.message);
      } else {
        detail = exception.message;
      }
    } else if (exception instanceof Error) {
      detail = exception.message;
    }

    const payload = buildScimErrorPayload(statusCode, detail, scimType);
    void response.status(statusCode).header('Content-Type', SCIM_CONTENT_TYPE).send(payload);
  }
}
