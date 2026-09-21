export abstract class AppException extends Error {
  public abstract readonly code: string;
  public readonly statusCode: number;
  public readonly details: unknown[];

  constructor(message: string, statusCode = 500, details: unknown[] = []) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}
