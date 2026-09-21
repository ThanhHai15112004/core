import { AppException } from '@packages/kernel/index.js';

export class HttpBadRequestException extends AppException {
  public override readonly code: string;

  constructor(message: string, code = 'BAD_REQUEST', details: unknown[] = []) {
    super(message, 400, details);
    this.code = code;
  }
}
