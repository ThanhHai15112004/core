import { Injectable } from '@nestjs/common';
import {
  ALL_PROVIDER_TYPES,
  PROVIDER_HEALTH_STATUS,
  PROVIDER_ROLE,
  PROVIDER_STATUS,
  type IProviderRegistryPort,
  type ProviderFallbackPolicySnapshot,
  type ProviderHealthProbeFn,
  type ProviderInvocationSink,
  type ProviderTypeName,
  type ProviderUnitAssignmentSnapshot,
  type RecordProviderInvocationInput,
  type RegisteredProviderSnapshot,
  type ResolveProviderInput,
  type ResolveProviderResult,
} from '../contracts/provider-registry.contract.js';

const DEFAULT_POLICY: ProviderFallbackPolicySnapshot = {
  fallbackEnabled: false,
  fallbackAllowedTypes: [...ALL_PROVIDER_TYPES],
  fallbackOnPaused: true,
  fallbackOnDown: true,
  fallbackOnDegraded: false,
  unitRoutingEnabled: true,
};

/**
 * L1 In-Memory Provider Registry & Routing Port (`@packages/kernel`):
 * - Giữ ranh giới thuần kỹ thuật, không phụ thuộc ngược vào `modules/`.
 * - Hỗ trợ phân giải Primary / Fallback theo Policy / Organization Unit, kiểm tra Pause và thu thập Probe + Invocation telemetry.
 */
@Injectable()
export class ProviderRegistryService implements IProviderRegistryPort {
  private readonly providersById = new Map<number, RegisteredProviderSnapshot>();
  private readonly providersByTypeCode = new Map<string, RegisteredProviderSnapshot>();
  private readonly unitAssignments = new Map<string, ProviderUnitAssignmentSnapshot>();
  private readonly healthProbes = new Map<string, ProviderHealthProbeFn>();
  private readonly invocationSinks = new Set<ProviderInvocationSink>();
  private policyResolver: () => ProviderFallbackPolicySnapshot = () => DEFAULT_POLICY;

  private typeCodeKey(providerType: ProviderTypeName, code: string): string {
    return `${providerType}:${code.trim().toLowerCase()}`;
  }

  private unitKey(providerType: ProviderTypeName, organizationUnitId: number): string {
    return `${providerType}:${Number(organizationUnitId)}`;
  }

  private probeKey(providerType: ProviderTypeName, key: string): string {
    return `${providerType}:${key.trim().toLowerCase() || '*'}`;
  }

  public setPolicyProvider(resolver: () => ProviderFallbackPolicySnapshot): void {
    this.policyResolver = resolver;
  }

  public getPolicy(): ProviderFallbackPolicySnapshot {
    try {
      return this.policyResolver();
    } catch {
      return DEFAULT_POLICY;
    }
  }

  public replaceSnapshot(
    providers: readonly RegisteredProviderSnapshot[],
    assignments: readonly ProviderUnitAssignmentSnapshot[],
  ): void {
    this.providersById.clear();
    this.providersByTypeCode.clear();
    this.unitAssignments.clear();

    for (const provider of providers) {
      this.upsertProvider(provider);
    }
    for (const assignment of assignments) {
      this.upsertUnitAssignment(assignment);
    }
  }

  public upsertProvider(provider: RegisteredProviderSnapshot): void {
    this.providersById.set(provider.id, provider);
    this.providersByTypeCode.set(
      this.typeCodeKey(provider.providerType, provider.providerCode),
      provider,
    );
  }

  public removeProvider(providerId: number): void {
    const existing = this.providersById.get(providerId);
    if (existing) {
      this.providersById.delete(providerId);
      this.providersByTypeCode.delete(
        this.typeCodeKey(existing.providerType, existing.providerCode),
      );
    }
  }

  public upsertUnitAssignment(assignment: ProviderUnitAssignmentSnapshot): void {
    this.unitAssignments.set(
      this.unitKey(assignment.providerType, assignment.organizationUnitId),
      assignment,
    );
  }

  public removeUnitAssignment(providerType: ProviderTypeName, organizationUnitId: number): void {
    this.unitAssignments.delete(this.unitKey(providerType, organizationUnitId));
  }

  public clear(): void {
    this.providersById.clear();
    this.providersByTypeCode.clear();
    this.unitAssignments.clear();
    this.healthProbes.clear();
    this.invocationSinks.clear();
    this.policyResolver = () => DEFAULT_POLICY;
  }

  public listProviders(providerType?: ProviderTypeName): RegisteredProviderSnapshot[] {
    const items = [...this.providersById.values()];
    if (!providerType) return items;
    return items.filter((item) => item.providerType === providerType);
  }

  public hasProvidersOfType(providerType: ProviderTypeName): boolean {
    for (const item of this.providersById.values()) {
      if (item.providerType === providerType) {
        return true;
      }
    }
    return false;
  }

  public getProviderByCode(
    providerType: ProviderTypeName,
    providerCode: string,
  ): RegisteredProviderSnapshot | null {
    return this.providersByTypeCode.get(this.typeCodeKey(providerType, providerCode)) ?? null;
  }

  public findByDomainRefOrCode(
    providerType: ProviderTypeName,
    codeOrDomainRef: string,
  ): RegisteredProviderSnapshot | null {
    const clean = codeOrDomainRef.trim().toLowerCase();
    if (!clean) return null;
    const byCode = this.providersByTypeCode.get(this.typeCodeKey(providerType, clean));
    if (byCode) return byCode;

    for (const item of this.providersById.values()) {
      if (
        item.providerType === providerType &&
        item.domainRefCode?.trim().toLowerCase() === clean
      ) {
        return item;
      }
    }
    return null;
  }

  public isProviderPaused(providerType: ProviderTypeName, codeOrDomainRef: string): boolean {
    const found = this.findByDomainRefOrCode(providerType, codeOrDomainRef);
    if (!found) return false;
    return found.status === PROVIDER_STATUS.PAUSED || found.status === PROVIDER_STATUS.DISABLED;
  }

  public resolveProvider(input: ResolveProviderInput): ResolveProviderResult {
    const policy = this.getPolicy();
    const typeProviders = this.listProviders(input.providerType);
    if (typeProviders.length === 0) {
      return {
        resolved: false,
        provider: null,
        usedFallback: false,
        blockedByPolicy: false,
        resolutionSource: 'NONE',
        reason: 'NO_PROVIDER_REGISTERED',
        primaryProviderCode: null,
      };
    }

    const orgUnitId =
      input.organizationUnitId !== undefined && input.organizationUnitId !== null
        ? Number(input.organizationUnitId)
        : null;
    const unitAssignment =
      policy.unitRoutingEnabled && orgUnitId !== null && Number.isFinite(orgUnitId)
        ? (this.unitAssignments.get(this.unitKey(input.providerType, orgUnitId)) ?? null)
        : null;

    const effectiveFallbackAllowed =
      input.allowFallbackOverride !== undefined && input.allowFallbackOverride !== null
        ? Boolean(input.allowFallbackOverride)
        : unitAssignment?.allowFallbackOverride !== undefined &&
            unitAssignment.allowFallbackOverride !== null
          ? Boolean(unitAssignment.allowFallbackOverride)
          : policy.fallbackEnabled && policy.fallbackAllowedTypes.includes(input.providerType);

    let primary: RegisteredProviderSnapshot | null = null;
    let isUnitScoped = false;

    if (unitAssignment && unitAssignment.isEnabled) {
      isUnitScoped = true;
      primary = this.providersById.get(unitAssignment.primaryProviderId) ?? null;
    } else {
      const sorted = [...typeProviders].sort((a, b) => a.priority - b.priority || a.id - b.id);
      primary =
        sorted.find((p) => p.isPrimary) ??
        sorted.find((p) => p.role === PROVIDER_ROLE.PRIMARY) ??
        null;
    }

    if (!primary) {
      return {
        resolved: false,
        provider: null,
        usedFallback: false,
        blockedByPolicy: false,
        resolutionSource: 'NONE',
        reason: isUnitScoped ? 'UNIT_PRIMARY_NOT_FOUND' : 'NO_PRIMARY_CONFIGURED',
        primaryProviderCode: null,
      };
    }

    const fallbackCandidates = this.collectFallbackCandidates(
      input.providerType,
      primary.id,
      typeProviders,
      unitAssignment?.isEnabled ? unitAssignment.fallbackProviderId : null,
    );

    // 1. Primary is ACTIVE & not DOWN
    if (
      primary.status === PROVIDER_STATUS.ACTIVE &&
      primary.healthStatus !== PROVIDER_HEALTH_STATUS.DOWN
    ) {
      if (
        primary.healthStatus === PROVIDER_HEALTH_STATUS.DEGRADED &&
        effectiveFallbackAllowed &&
        policy.fallbackOnDegraded
      ) {
        const healthyFallback = fallbackCandidates.find(
          (c) =>
            c.status === PROVIDER_STATUS.ACTIVE &&
            c.healthStatus !== PROVIDER_HEALTH_STATUS.DOWN &&
            c.healthStatus !== PROVIDER_HEALTH_STATUS.DEGRADED,
        );
        if (healthyFallback) {
          return {
            resolved: true,
            provider: healthyFallback,
            usedFallback: true,
            blockedByPolicy: false,
            resolutionSource: isUnitScoped ? 'UNIT_FALLBACK' : 'GLOBAL_FALLBACK',
            reason: 'PRIMARY_DEGRADED_FALLBACK_USED',
            primaryProviderCode: primary.providerCode,
          };
        }
      }

      return {
        resolved: true,
        provider: primary,
        usedFallback: false,
        blockedByPolicy: false,
        resolutionSource: isUnitScoped ? 'UNIT_PRIMARY' : 'GLOBAL_PRIMARY',
        reason:
          primary.healthStatus === PROVIDER_HEALTH_STATUS.DEGRADED
            ? 'PRIMARY_ACTIVE_DEGRADED'
            : 'PRIMARY_ACTIVE',
        primaryProviderCode: primary.providerCode,
      };
    }

    // 2. Primary is PAUSED / DISABLED / DOWN -> check policy before using fallback
    const triggerAllowed =
      primary.status === PROVIDER_STATUS.PAUSED
        ? policy.fallbackOnPaused
        : primary.status === PROVIDER_STATUS.DISABLED
          ? policy.fallbackOnPaused || policy.fallbackOnDown
          : policy.fallbackOnDown;

    if (!effectiveFallbackAllowed || !triggerAllowed) {
      return {
        resolved: false,
        provider: null,
        usedFallback: false,
        blockedByPolicy: true,
        resolutionSource: 'NONE',
        reason: this.formatBlockedReason(primary),
        primaryProviderCode: primary.providerCode,
      };
    }

    const usableFallback = this.pickBestUsableFallback(fallbackCandidates);
    if (!usableFallback) {
      return {
        resolved: false,
        provider: null,
        usedFallback: false,
        blockedByPolicy: true,
        resolutionSource: 'NONE',
        reason: 'NO_USABLE_FALLBACK',
        primaryProviderCode: primary.providerCode,
      };
    }

    return {
      resolved: true,
      provider: usableFallback,
      usedFallback: true,
      blockedByPolicy: false,
      resolutionSource: isUnitScoped ? 'UNIT_FALLBACK' : 'GLOBAL_FALLBACK',
      reason:
        primary.status === PROVIDER_STATUS.PAUSED
          ? 'PRIMARY_PAUSED_FALLBACK_USED'
          : primary.status === PROVIDER_STATUS.DISABLED
            ? 'PRIMARY_DISABLED_FALLBACK_USED'
            : 'PRIMARY_DOWN_FALLBACK_USED',
      primaryProviderCode: primary.providerCode,
    };
  }

  private collectFallbackCandidates(
    providerType: ProviderTypeName,
    primaryId: number,
    typeProviders: readonly RegisteredProviderSnapshot[],
    unitFallbackProviderId: number | null,
  ): RegisteredProviderSnapshot[] {
    const out: RegisteredProviderSnapshot[] = [];
    const seen = new Set<number>([primaryId]);

    if (unitFallbackProviderId !== null && !seen.has(unitFallbackProviderId)) {
      const unitFallback = this.providersById.get(unitFallbackProviderId);
      if (unitFallback && unitFallback.providerType === providerType) {
        out.push(unitFallback);
        seen.add(unitFallback.id);
      }
    }

    const globalFallbacks = typeProviders
      .filter((p) => !seen.has(p.id) && (p.fallbackAllowed || p.role === PROVIDER_ROLE.FALLBACK))
      .sort((a, b) => a.priority - b.priority || a.id - b.id);

    for (const fb of globalFallbacks) {
      out.push(fb);
      seen.add(fb.id);
    }

    return out;
  }

  private pickBestUsableFallback(
    candidates: readonly RegisteredProviderSnapshot[],
  ): RegisteredProviderSnapshot | null {
    const active = candidates.filter(
      (c) => c.status === PROVIDER_STATUS.ACTIVE && c.healthStatus !== PROVIDER_HEALTH_STATUS.DOWN,
    );
    if (active.length === 0) return null;
    const nonDegraded = active.find((c) => c.healthStatus !== PROVIDER_HEALTH_STATUS.DEGRADED);
    return nonDegraded ?? active[0] ?? null;
  }

  private formatBlockedReason(primary: RegisteredProviderSnapshot): string {
    if (primary.status === PROVIDER_STATUS.PAUSED) return 'PRIMARY_PAUSED_FALLBACK_DISALLOWED';
    if (primary.status === PROVIDER_STATUS.DISABLED) return 'PRIMARY_DISABLED_FALLBACK_DISALLOWED';
    return 'PRIMARY_DOWN_FALLBACK_DISALLOWED';
  }

  public registerHealthProbe(
    providerType: ProviderTypeName,
    key: string,
    probe: ProviderHealthProbeFn,
  ): () => void {
    const composite = this.probeKey(providerType, key);
    this.healthProbes.set(composite, probe);
    return () => {
      if (this.healthProbes.get(composite) === probe) {
        this.healthProbes.delete(composite);
      }
    };
  }

  public resolveHealthProbe(
    providerType: ProviderTypeName,
    providerCode: string,
    driverCode: string,
  ): ProviderHealthProbeFn | null {
    return (
      this.healthProbes.get(this.probeKey(providerType, providerCode)) ??
      this.healthProbes.get(this.probeKey(providerType, driverCode)) ??
      this.healthProbes.get(this.probeKey(providerType, '*')) ??
      null
    );
  }

  public registerInvocationSink(sink: ProviderInvocationSink): () => void {
    this.invocationSinks.add(sink);
    return () => {
      this.invocationSinks.delete(sink);
    };
  }

  public async recordInvocation(input: RecordProviderInvocationInput): Promise<void> {
    if (this.invocationSinks.size === 0) return;
    for (const sink of this.invocationSinks) {
      try {
        await sink(input);
      } catch {
        // Telemetry hooks must never fail business operations
      }
    }
  }
}

export const defaultProviderRegistry = new ProviderRegistryService();
