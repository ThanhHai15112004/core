export type ReadIntent = 'default' | 'report';

export type ReadRoutingTarget = 'PRIMARY' | 'REPLICA';

export type ReadRoutingReason =
  | 'replica_ok'
  | 'no_replica'
  | 'in_transaction'
  | 'forced_primary'
  | 'read_after_write_request'
  | 'read_after_write_window'
  | 'replica_circuit_open'
  | 'replication_lag_critical'
  | 'replica_fallback';

export interface ReadOnlyExecutionOptions {
  readonly intent?: ReadIntent | undefined;
  readonly forcePrimary?: boolean | undefined;
  readonly stickinessKey?: string | undefined;
}

export interface ReadRoutingStatsSnapshot {
  readonly totalReads: number;
  readonly replicaReads: number;
  readonly primaryReads: number;
  readonly reportReplicaReads: number;
  readonly readAfterWritePrimaryReads: number;
  readonly fallbackCount: number;
  readonly lastFallbackAt: string | null;
  readonly circuitState: 'closed' | 'open';
  readonly circuitOpenUntil: string | null;
  readonly lastError: string | null;
  readonly lagMs: number | null;
  readonly replicaAvailable: boolean;
  readonly lastCheckedAt: string | null;
}

export interface ReadRoutingConfigSummary {
  readonly readAfterWriteWindowMs: number;
  readonly replicaFallbackCooldownMs: number;
  readonly replicationLagWarnMs: number;
  readonly replicationLagCritMs: number;
  readonly fallbackOnCriticalLag: boolean;
}
