/** Thông tin lỗi mà exception filter đã chuẩn hoá — để telemetry (HTTP traffic) đọc lại ở cuối request. */
export interface RequestErrorAnnotation {
  code: string;
  /** Tên class của exception gốc, vd. `NotFoundAppException`, `TypeError`. */
  name: string;
  /** Message đã trả cho client (đã i18n, không chứa chi tiết nội bộ). */
  message: string;
}

// Khoá theo IncomingMessage (`request.raw`) — cùng một object ở Nest filter lẫn Fastify hooks.
const errors = new WeakMap<object, RequestErrorAnnotation>();

export function annotateRequestError(rawRequest: object, info: RequestErrorAnnotation): void {
  errors.set(rawRequest, info);
}

export function readRequestError(rawRequest: object): RequestErrorAnnotation | undefined {
  return errors.get(rawRequest);
}
