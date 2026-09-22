export type MessageParams = Record<string, string | number>;

/**
 * `message` có thể là text thường hoặc một i18n key (vd. `ops.package.notFound`);
 * `GlobalExceptionFilter` sẽ dịch theo locale của request, dùng `messageParams` để nội suy.
 */
export abstract class AppException extends Error {
  public abstract readonly code: string;
  public readonly statusCode: number;
  public readonly details: unknown[];
  public readonly messageParams: MessageParams | undefined;

  constructor(
    message: string,
    statusCode = 500,
    details: unknown[] = [],
    messageParams?: MessageParams,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    this.messageParams = messageParams;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}
