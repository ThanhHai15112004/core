import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BaseHttpClientProvider,
  HTTP_CLIENT_TOKEN,
  type HttpClientContract,
  HttpClientError,
} from '@packages/http-client/index.js';
import { UnauthorizedAppException } from '@packages/kernel/index.js';
import { FEDERATED_AUTH_STAGE } from '../enum/federated-identity.enum.js';
import type { OidcJwksDocument } from '../helpers/oidc-jwt-verifier.helper.js';
import { sanitizeFederatedErrorMessage } from '../helpers/federated-redaction.helper.js';

interface JwksCacheEntry {
  readonly document: OidcJwksDocument;
  readonly expiresAtMs: number;
}

export class FederatedStageError extends UnauthorizedAppException {
  public readonly stage: string;
  public readonly stageErrorCode: string;
  public readonly providerError: string | null;
  public readonly httpStatus: number | null;
  public readonly diagnosticMessage: string | null;
  public readonly metadata: Record<string, unknown> | undefined;

  constructor(params: {
    readonly i18nKey: string;
    readonly stage: string;
    readonly stageErrorCode: string;
    readonly providerError?: string | null | undefined;
    readonly httpStatus?: number | null | undefined;
    readonly diagnosticMessage?: string | null | undefined;
    readonly metadata?: Record<string, unknown> | undefined;
  }) {
    super(params.i18nKey, [], undefined, params.stageErrorCode);
    this.stage = params.stage;
    this.stageErrorCode = params.stageErrorCode;
    this.providerError = params.providerError ?? null;
    this.httpStatus = params.httpStatus ?? null;
    this.diagnosticMessage = sanitizeFederatedErrorMessage(params.diagnosticMessage) ?? null;
    this.metadata = params.metadata;
  }
}

@Injectable()
export class FederatedJwksService {
  private readonly cache = new Map<string, JwksCacheEntry>();
  private readonly httpClient: HttpClientContract;

  constructor(
    @Optional()
    @Inject(HTTP_CLIENT_TOKEN)
    httpClient?: HttpClientContract,
  ) {
    this.httpClient = httpClient ?? new BaseHttpClientProvider();
  }

  public async getJwks(
    serviceName: string,
    jwksUri: string,
    cacheTtlSeconds: number,
    forceRefresh = false,
  ): Promise<OidcJwksDocument> {
    const cacheKey = `${serviceName}:${jwksUri}`;
    const nowMs = Date.now();
    const cached = this.cache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAtMs > nowMs) {
      return cached.document;
    }

    try {
      const doc = await this.httpClient.forService(serviceName).get<OidcJwksDocument>(jwksUri, {
        headers: { Accept: 'application/json' },
      });
      if (!doc || !Array.isArray(doc.keys)) {
        throw new FederatedStageError({
          i18nKey: 'federated-identity.jwksFetchFailed',
          stage: FEDERATED_AUTH_STAGE.JWKS_FETCH,
          stageErrorCode: 'INVALID_JWKS_DOCUMENT',
          diagnosticMessage: 'JWKS response does not contain a keys array',
        });
      }
      const ttlMs = Math.max(0, cacheTtlSeconds) * 1000;
      if (ttlMs > 0) {
        this.cache.set(cacheKey, {
          document: doc,
          expiresAtMs: nowMs + ttlMs,
        });
      }
      return doc;
    } catch (err) {
      if (err instanceof FederatedStageError) throw err;
      const httpStatus = err instanceof HttpClientError ? err.status : null;
      const stageErrorCode = err instanceof HttpClientError ? err.code : 'JWKS_FETCH_FAILED';
      const msg = err instanceof Error ? err.message : String(err);
      throw new FederatedStageError({
        i18nKey: 'federated-identity.jwksFetchFailed',
        stage: FEDERATED_AUTH_STAGE.JWKS_FETCH,
        stageErrorCode,
        httpStatus,
        diagnosticMessage: msg,
      });
    }
  }

  public clearCache(jwksUri?: string): void {
    if (!jwksUri) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.endsWith(`:${jwksUri}`)) {
        this.cache.delete(key);
      }
    }
  }
}
