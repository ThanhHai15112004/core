import { ApiError } from '../services/api';

/** Thông điệp lỗi hiển thị được (backend đã dịch theo Accept-Language). */
export function errorMessage(err: unknown): string | undefined {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return undefined;
}

export const errorStatus = (err: unknown): number | null => (err instanceof ApiError ? err.status : null);
