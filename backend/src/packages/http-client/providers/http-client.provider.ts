import { Injectable } from '@nestjs/common';
import type { HttpClientContract, HttpRequestOptions } from '../contracts/http-client.contract.js';
import { HttpClientLoggingInterceptor } from '../interceptors/http-client-logging.interceptor.js';

@Injectable()
export class BaseHttpClientProvider implements HttpClientContract {
  /** Lấy dữ liệu hoặc đối tượng theo khóa định danh */
  public async get<T>(url: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('GET', url, undefined, options);
  }

  /** Gửi yêu cầu HTTP POST tới dịch vụ bên ngoài */
  public async post<T, B = unknown>(
    url: string,
    body?: B,
    options?: HttpRequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', url, body, options);
  }

  /** Lưu trữ một đối tượng hoặc tệp tin vào hệ thống lưu trữ */
  public async put<T, B = unknown>(
    url: string,
    body?: B,
    options?: HttpRequestOptions,
  ): Promise<T> {
    return this.request<T>('PUT', url, body, options);
  }

  /** Xóa bản ghi khỏi hệ thống theo mã định danh */
  public async delete<T>(url: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('DELETE', url, undefined, options);
  }

  /** Thực thi yêu cầu HTTP tới dịch vụ bên ngoài kèm cấu hình timeout */
  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const startTime = HttpClientLoggingInterceptor.logRequest(method, url);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    };

    const init: RequestInit = {
      method,
      headers,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    HttpClientLoggingInterceptor.logResponse(method, url, res.status, startTime);

    if (!res.ok) {
      throw new Error(`[HttpClientError] ${method} ${url} failed with status ${res.status}`);
    }

    return (await res.json()) as T;
  }
}
