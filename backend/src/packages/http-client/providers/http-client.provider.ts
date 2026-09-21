import { Injectable } from '@nestjs/common';
import type { HttpClientContract, HttpRequestOptions } from '../contracts/http-client.contract.js';
import { HttpClientLoggingInterceptor } from '../interceptors/http-client-logging.interceptor.js';

@Injectable()
export class BaseHttpClientProvider implements HttpClientContract {
  public async get<T>(url: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('GET', url, undefined, options);
  }

  public async post<T, B = unknown>(
    url: string,
    body?: B,
    options?: HttpRequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', url, body, options);
  }

  public async put<T, B = unknown>(
    url: string,
    body?: B,
    options?: HttpRequestOptions,
  ): Promise<T> {
    return this.request<T>('PUT', url, body, options);
  }

  public async delete<T>(url: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('DELETE', url, undefined, options);
  }

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
