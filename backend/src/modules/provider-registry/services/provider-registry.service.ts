import { Injectable, Optional } from '@nestjs/common';
import {
  ProviderRegistryService as KernelProviderRegistryService,
  defaultProviderRegistry,
  type PaginatedResult,
  type ProviderTypeName,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { IProviderRegistryPublicService } from '../contracts/index.js';
import { ALL_PROVIDER_TYPES, PROVIDER_DRIVER_CATALOG } from '../enum/provider-registry.enum.js';
import type {
  CreateProviderEntryRequest,
  ListProviderConfigHistoriesQuery,
  ListProviderEntriesQuery,
  ListProviderHealthChecksQuery,
  ListProviderUnitAssignmentsQuery,
  PauseProviderRequest,
  RecordProviderObservationRequest,
  ResolveProviderPreviewRequest,
  RunHealthCheckAllRequest,
  SetPrimaryProviderRequest,
  UpdateProviderEntryRequest,
  UpsertProviderUnitAssignmentRequest,
} from '../requests/provider-registry.requests.js';
import type {
  ProviderCatalogView,
  ProviderConfigHistoryView,
  ProviderDashboardView,
  ProviderHealthCheckView,
  ProviderRegistryEntryView,
  ProviderResolvePreviewView,
  ProviderUnitAssignmentView,
} from '../types/provider-registry.types.js';
import { ProviderEntriesService } from './provider-entries.service.js';
import { ProviderHealthTelemetryService } from './provider-health-telemetry.service.js';
import { ProviderHistoryService } from './provider-history.service.js';
import { ProviderUnitAssignmentsService } from './provider-unit-assignments.service.js';

@Injectable()
export class ProviderRegistryService implements IProviderRegistryPublicService {
  private readonly kernelRegistry: KernelProviderRegistryService;

  constructor(
    private readonly entriesService: ProviderEntriesService,
    private readonly unitAssignmentsService: ProviderUnitAssignmentsService,
    private readonly healthTelemetryService: ProviderHealthTelemetryService,
    private readonly historyService: ProviderHistoryService,
    @Optional() kernelRegistry?: KernelProviderRegistryService,
  ) {
    this.kernelRegistry = kernelRegistry ?? defaultProviderRegistry;
  }

  public getCatalog(): ProviderCatalogView {
    return {
      types: ALL_PROVIDER_TYPES,
      driversByType: PROVIDER_DRIVER_CATALOG,
    };
  }

  public async listProviders(
    query: Partial<ListProviderEntriesQuery> = {},
  ): Promise<PaginatedResult<ProviderRegistryEntryView>> {
    return this.entriesService.listProviders(query);
  }

  public async getProviderById(id: number): Promise<ProviderRegistryEntryView> {
    return this.entriesService.getProviderById(id);
  }

  public async createProvider(
    input: CreateProviderEntryRequest,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    return this.entriesService.createProvider(input, actor);
  }

  public async updateProvider(
    id: number,
    input: UpdateProviderEntryRequest,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    return this.entriesService.updateProvider(id, input, actor);
  }

  public async deleteProvider(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.entriesService.deleteProvider(id, reason, actor);
  }

  public async setPrimary(
    id: number,
    input?: SetPrimaryProviderRequest,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    return this.entriesService.setPrimary(id, input?.reason, actor);
  }

  public async pauseProvider(
    id: number,
    input?: PauseProviderRequest,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    return this.entriesService.pauseProvider(id, input?.reason, actor);
  }

  public async resumeProvider(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    return this.entriesService.resumeProvider(id, reason, actor);
  }

  public async resolveProviderPreview(
    input: ResolveProviderPreviewRequest,
  ): Promise<ProviderResolvePreviewView> {
    await this.entriesService.syncKernelSnapshot();
    const resolved = this.kernelRegistry.resolveProvider({
      providerType: input.providerType,
      organizationUnitId: input.organizationUnitId ?? null,
      allowFallbackOverride: input.allowFallbackOverride,
    });

    const providerView = resolved.provider
      ? await this.entriesService.getProviderById(resolved.provider.id).catch(() => null)
      : null;

    return {
      resolved: resolved.resolved,
      providerType: input.providerType,
      organizationUnitId: input.organizationUnitId ?? null,
      usedFallback: resolved.usedFallback,
      blockedByPolicy: resolved.blockedByPolicy,
      resolutionSource: resolved.resolutionSource,
      reason: resolved.reason,
      primaryProviderCode: resolved.primaryProviderCode,
      provider: providerView,
    };
  }

  public async listUnitAssignments(
    query: Partial<ListProviderUnitAssignmentsQuery> = {},
  ): Promise<PaginatedResult<ProviderUnitAssignmentView>> {
    return this.unitAssignmentsService.listUnitAssignments(query);
  }

  public async upsertUnitAssignment(
    input: UpsertProviderUnitAssignmentRequest,
    actor?: UserIdentity,
  ): Promise<ProviderUnitAssignmentView> {
    return this.unitAssignmentsService.upsertUnitAssignment(input, actor);
  }

  public async deleteUnitAssignment(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.unitAssignmentsService.deleteUnitAssignment(id, reason, actor);
  }

  public async checkProviderHealth(
    id: number,
    actor?: UserIdentity,
  ): Promise<ProviderHealthCheckView> {
    return this.healthTelemetryService.checkProviderHealth(id, { actor });
  }

  public async checkAllProvidersHealth(
    input: RunHealthCheckAllRequest = {},
    actor?: UserIdentity,
  ): Promise<readonly ProviderHealthCheckView[]> {
    return this.healthTelemetryService.checkAllProvidersHealth(input, actor);
  }

  public async listHealthChecks(
    providerId: number,
    query: Partial<ListProviderHealthChecksQuery> = {},
  ): Promise<PaginatedResult<ProviderHealthCheckView>> {
    return this.healthTelemetryService.listHealthChecks(providerId, query);
  }

  public async recordManualObservation(
    providerId: number,
    input: RecordProviderObservationRequest,
  ): Promise<{ readonly recorded: true; readonly providerId: number }> {
    return this.healthTelemetryService.recordManualObservation(providerId, input);
  }

  public async getDashboard(query?: {
    readonly providerType?: ProviderTypeName | undefined;
    readonly windowMinutes?: number | undefined;
  }): Promise<ProviderDashboardView> {
    return this.healthTelemetryService.getDashboard(query);
  }

  public async listHistories(
    query: Partial<ListProviderConfigHistoriesQuery> = {},
  ): Promise<PaginatedResult<ProviderConfigHistoryView>> {
    return this.historyService.listHistories(query);
  }
}
