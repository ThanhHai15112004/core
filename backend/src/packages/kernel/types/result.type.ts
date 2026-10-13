export type Result<T, E = Error> =
  { readonly success: true; readonly data: T } | { readonly success: false; readonly error: E };

export const Result = {
  /** Tạo đối tượng phản hồi thành công theo chuẩn Envelope */
  ok<T>(data: T): Result<T, never> {
    return { success: true, data };
  },
  /** Tạo đối tượng phản hồi lỗi theo chuẩn Envelope */
  err<E>(error: E): Result<never, E> {
    return { success: false, error };
  },
};

export type Nullable<T> = T | null;
