export interface HttpRequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  timeoutMs?: number;
}

export interface HttpClientContract {
  get<T>(url: string, options?: HttpRequestOptions): Promise<T>;
  post<T, B = unknown>(url: string, body?: B, options?: HttpRequestOptions): Promise<T>;
  put<T, B = unknown>(url: string, body?: B, options?: HttpRequestOptions): Promise<T>;
  delete<T>(url: string, options?: HttpRequestOptions): Promise<T>;
}
