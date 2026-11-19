import type { PaginatedResult, ProviderTypeName } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
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

export const PROVIDER_REGISTRY_PUBLIC_SERVICE = Symbol('PROVIDER_REGISTRY_PUBLIC_SERVICE');

export interface IProviderRegistryPublicService {
  getCatalog(): ProviderCatalogView;
  listProviders(
    query?: Partial<ListProviderEntriesQuery>,
  ): Promise<PaginatedResult<ProviderRegistryEntryView>>;
  getProviderById(id: number): Promise<ProviderRegistryEntryView>;
  createProvider(
    input: CreateProviderEntryRequest,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView>;
  updateProvider(
    id: number,
    input: UpdateProviderEntryRequest,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView>;
  deleteProvider(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }>;
  setPrimary(
    id: number,
    input?: SetPrimaryProviderRequest,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView>;
  pauseProvider(
    id: number,
    input?: PauseProviderRequest,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView>;
  resumeProvider(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView>;
  resolveProviderPreview(input: ResolveProviderPreviewRequest): Promise<ProviderResolvePreviewView>;
  listUnitAssignments(
    query?: Partial<ListProviderUnitAssignmentsQuery>,
  ): Promise<PaginatedResult<ProviderUnitAssignmentView>>;
  upsertUnitAssignment(
    input: UpsertProviderUnitAssignmentRequest,
    actor?: UserIdentity,
  ): Promise<ProviderUnitAssignmentView>;
  deleteUnitAssignment(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }>;
  checkProviderHealth(id: number, actor?: UserIdentity): Promise<ProviderHealthCheckView>;
  checkAllProvidersHealth(
    input?: RunHealthCheckAllRequest,
    actor?: UserIdentity,
  ): Promise<readonly ProviderHealthCheckView[]>;
  listHealthChecks(
    providerId: number,
    query?: Partial<ListProviderHealthChecksQuery>,
  ): Promise<PaginatedResult<ProviderHealthCheckView>>;
  recordManualObservation(
    providerId: number,
    input: RecordProviderObservationRequest,
  ): Promise<{ readonly recorded: true; readonly providerId: number }>;
  getDashboard(query?: {
    readonly providerType?: ProviderTypeName | undefined;
    readonly windowMinutes?: number | undefined;
  }): Promise<ProviderDashboardView>;
  listHistories(
    query?: Partial<ListProviderConfigHistoriesQuery>,
  ): Promise<PaginatedResult<ProviderConfigHistoryView>>;
}
