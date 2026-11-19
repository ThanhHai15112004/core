import { Injectable } from '@nestjs/common';
import type { PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { IFederatedIdentityPublicService } from '../contracts/index.js';
import { FEDERATED_FLOW_TYPE } from '../enum/federated-identity.enum.js';
import type {
  ListMonitoringErrorsQuery,
  UpsertFederatedProviderRequest,
} from '../requests/federated-identity.requests.js';
import type {
  FederatedAuthEventView,
  FederatedDriverMetadata,
  FederatedIdentityView,
  FederatedMonitoringSummaryView,
  FederatedPolicyView,
  FederatedProviderView,
  InitiateOAuthAuthorizeResult,
  OAuthCallbackResult,
  PublicFederatedProviderView,
  TestProviderConnectionResult,
  UnlinkFederatedIdentityResult,
} from '../types/federated-identity.types.js';
import {
  type AuthorizeRequestContext,
  type CallbackRequestContext,
  FederatedAuthFlowService,
} from './federated-auth-flow.service.js';
import { FederatedMonitoringService } from './federated-monitoring.service.js';
import { FederatedProvidersService } from './federated-providers.service.js';

@Injectable()
export class FederatedIdentityService implements IFederatedIdentityPublicService {
  constructor(
    private readonly providersService: FederatedProvidersService,
    private readonly flowService: FederatedAuthFlowService,
    private readonly monitoringService: FederatedMonitoringService,
  ) {}

  public listDrivers(): FederatedDriverMetadata[] {
    return this.providersService.listDrivers();
  }

  public async getPolicy(): Promise<FederatedPolicyView> {
    return this.providersService.getPolicy();
  }

  public async listPublicProviders(): Promise<PublicFederatedProviderView[]> {
    return this.providersService.listPublicProviders();
  }

  public async listProviders(): Promise<FederatedProviderView[]> {
    return this.providersService.listProviders();
  }

  public async getProviderByCode(providerCode: string): Promise<FederatedProviderView> {
    return this.providersService.getProviderByCode(providerCode);
  }

  public async upsertProvider(
    providerCode: string,
    input: UpsertFederatedProviderRequest,
    actor?: UserIdentity,
  ): Promise<FederatedProviderView> {
    return this.providersService.upsertProvider(providerCode, input, actor);
  }

  public async deleteProvider(
    providerCode: string,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly providerCode: string }> {
    return this.providersService.deleteProvider(providerCode, actor);
  }

  public async testProviderConnection(providerCode: string): Promise<TestProviderConnectionResult> {
    return this.providersService.testProviderConnection(providerCode);
  }

  public async initiateLoginAuthorize(
    providerCode: string,
    input: {
      readonly redirectUri: string;
      readonly loginHint?: string | undefined;
      readonly deviceName?: string | undefined;
    },
    meta?: AuthorizeRequestContext,
  ): Promise<InitiateOAuthAuthorizeResult> {
    return this.flowService.initiateAuthorize(providerCode, FEDERATED_FLOW_TYPE.LOGIN, input, meta);
  }

  public async initiateLinkAuthorize(
    providerCode: string,
    userId: number,
    input: {
      readonly redirectUri: string;
      readonly loginHint?: string | undefined;
      readonly deviceName?: string | undefined;
    },
    meta?: Omit<AuthorizeRequestContext, 'actorUserId'>,
  ): Promise<InitiateOAuthAuthorizeResult> {
    return this.flowService.initiateAuthorize(providerCode, FEDERATED_FLOW_TYPE.LINK, input, {
      ...meta,
      actorUserId: userId,
    });
  }

  public async handleCallback(
    providerCode: string,
    input: {
      readonly code?: string | undefined;
      readonly state: string;
      readonly redirectUri?: string | undefined;
      readonly error?: string | undefined;
      readonly errorDescription?: string | undefined;
      readonly deviceName?: string | undefined;
      readonly trustedDeviceToken?: string | undefined;
    },
    context?: CallbackRequestContext,
  ): Promise<OAuthCallbackResult> {
    return this.flowService.handleCallback(providerCode, input, context);
  }

  public async listUserIdentities(userId: number): Promise<FederatedIdentityView[]> {
    return this.flowService.listUserIdentities(userId);
  }

  public async unlinkUserIdentity(
    targetUserId: number,
    identityId: number,
    options?: {
      readonly actorUserId?: number | undefined;
      readonly stepUpToken?: string | undefined;
      readonly enforceSelfStepUp?: boolean | undefined;
      readonly ipAddress?: string | null | undefined;
      readonly userAgent?: string | null | undefined;
    },
  ): Promise<UnlinkFederatedIdentityResult> {
    return this.flowService.unlinkUserIdentity(targetUserId, identityId, options);
  }

  public async getMonitoringSummary(
    windowHours = 24,
    providerCode?: string,
  ): Promise<FederatedMonitoringSummaryView> {
    return this.monitoringService.getSummary(windowHours, providerCode);
  }

  public async listAuthEvents(
    query: Partial<ListMonitoringErrorsQuery> = {},
  ): Promise<PaginatedResult<FederatedAuthEventView>> {
    return this.monitoringService.listEvents(query);
  }
}
