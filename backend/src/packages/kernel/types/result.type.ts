export type Result<T, E = Error> =
  { readonly success: true; readonly data: T } | { readonly success: false; readonly error: E };

export const Result = {
  ok<T>(data: T): Result<T, never> {
    return { success: true, data };
  },
  err<E>(error: E): Result<never, E> {
    return { success: false, error };
  },
};

export type Nullable<T> = T | null;
