import { AppException, type MessageParams } from './app.exception.js';

export class NotFoundAppException extends AppException {
  public override readonly code = 'NOT_FOUND';

  constructor(message = 'NOT_FOUND', messageParams?: MessageParams) {
    super(message, 404, [], messageParams);
  }
}
