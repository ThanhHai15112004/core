import { AppException } from './app.exception.js';

export class DomainException extends AppException {
  public override readonly code: string;

  constructor(message: string, code = 'DOMAIN_ERROR', details: unknown[] = []) {
    super(message, 400, details);
    this.code = code;
  }
}
