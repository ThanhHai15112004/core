import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BaseHttpClientProvider,
  HTTP_CLIENT_TOKEN,
  type HttpClientContract,
  HttpClientError,
} from '@packages/http-client/index.js';
import { FEDERATED_AUTH_STAGE } from '../enum/federated-identity.enum.js';
import { normalizeIssuerUrl } from '../helpers/oidc-claim-mapping.helper.js';
import type { OidcDiscoveryDocument } from '../types/federated-identity.types.js';
import { FederatedStageError } from './federated-jwks.service.js';

interface DiscoveryCacheEntry {
  readonly document: OidcDiscoveryDocument;
  readonly expiresAtMs: number;
}

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

@Injectable()
export class OidcDiscoveryService {
  private readonly cache = new Map<string, DiscoveryCacheEntry>();
  private readonly httpClient: HttpClientContract;

  constructor(
    @Optional()
    @Inject(HTTP_CLIENT_TOKEN)
    httpClient?: HttpClientContract,
  ) {
    this.httpClient = httpClient ?? new BaseHttpClientProvider();
  }

  public buildDiscoveryUrl(issuerUrl: string, explicitDiscoveryUrl?: string | null): string {
    const rawCandidate = explicitDiscoveryUrl?.trim()
      ? explicitDiscoveryUrl.trim()
      : `${normalizeIssuerUrl(issuerUrl)}/.well-known/openid-configuration`;

    let parsed: URL;
    try {
      parsed = new URL(rawCandidate);
    } catch {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.discoveryFailed',
        stage: FEDERATED_AUTH_STAGE.DISCOVERY,
        stageErrorCode: 'INVALID_DISCOVERY_URL',
        diagnosticMessage: `Malformed OIDC discovery URL: ${rawCandidate}`,
      });
    }

    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    if (protocol !== 'https:' && !(protocol === 'http:' && LOCALHOST_HOSTNAMES.has(hostname))) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.discoveryFailed',
        stage: FEDERATED_AUTH_STAGE.DISCOVERY,
        stageErrorCode: 'INVALID_DISCOVERY_URL',
        diagnosticMessage: 'OIDC discovery URL must use https (or http only for localhost)',
      });
    }

    return parsed.toString();
  }

  public async getDiscoveryDocument(params: {
    readonly serviceName: string;
    readonly issuerUrl: string;
    readonly discoveryUrl?: string | null | undefined;
    readonly cacheTtlSeconds: number;
    readonly forceRefresh?: boolean | undefined;
  }): Promise<OidcDiscoveryDocument> {
    const targetUrl = this.buildDiscoveryUrl(params.issuerUrl, params.discoveryUrl);
    const cacheKey = `${params.serviceName}:${targetUrl}`;
    const nowMs = Date.now();
    const cached = this.cache.get(cacheKey);
    if (!params.forceRefresh && cached && cached.expiresAtMs > nowMs) {
      return cached.document;
    }

    let doc: OidcDiscoveryDocument;
    try {
      doc = await this.httpClient
        .forService(params.serviceName)
        .get<OidcDiscoveryDocument>(targetUrl, {
          headers: { Accept: 'application/json' },
        });
    } catch (err) {
      if (err instanceof FederatedStageError) throw err;
      const httpStatus = err instanceof HttpClientError ? err.status : null;
      const stageErrorCode = err instanceof HttpClientError ? err.code : 'DISCOVERY_FETCH_FAILED';
      const msg = err instanceof Error ? err.message : String(err);
      throw new FederatedStageError({
        i18nKey: 'federated-identity.discoveryFailed',
        stage: FEDERATED_AUTH_STAGE.DISCOVERY,
        stageErrorCode,
        httpStatus,
        diagnosticMessage: msg,
      });
    }

    if (
      !doc ||
      typeof doc.issuer !== 'string' ||
      !doc.issuer.trim() ||
      typeof doc.authorization_endpoint !== 'string' ||
      !doc.authorization_endpoint.trim() ||
      typeof doc.token_endpoint !== 'string' ||
      !doc.token_endpoint.trim() ||
      typeof doc.jwks_uri !== 'string' ||
      !doc.jwks_uri.trim()
    ) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.discoveryFailed',
        stage: FEDERATED_AUTH_STAGE.DISCOVERY,
        stageErrorCode: 'INVALID_DISCOVERY_DOCUMENT',
        diagnosticMessage:
          'OIDC discovery document missing issuer, authorization_endpoint, token_endpoint or jwks_uri',
      });
    }

    if (normalizeIssuerUrl(doc.issuer) !== normalizeIssuerUrl(params.issuerUrl)) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.discoveryFailed',
        stage: FEDERATED_AUTH_STAGE.DISCOVERY,
        stageErrorCode: 'DISCOVERY_ISSUER_MISMATCH',
        diagnosticMessage: `Discovery issuer (${doc.issuer}) does not match configured issuer (${params.issuerUrl})`,
      });
    }

    const ttlMs = Math.max(0, params.cacheTtlSeconds) * 1000;
    if (ttlMs > 0) {
      this.cache.set(cacheKey, {
        document: doc,
        expiresAtMs: nowMs + ttlMs,
      });
    }

    return doc;
  }

  public clearCache(discoveryUrl?: string): void {
    if (!discoveryUrl) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.endsWith(`:${discoveryUrl}`)) {
        this.cache.delete(key);
      }
    }
  }
}
