import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type {
  FederatedAuthOutcome,
  FederatedAuthStage,
  FederatedFlowType,
} from '../enum/federated-identity.enum.js';

@Entity({ name: 'federated_auth_events' })
@Index('UQ_fed_events_uid', ['eventUid'], { unique: true })
@Index('IDX_fed_events_provider_outcome_time', ['providerCode', 'outcome', 'occurredAt'])
@Index('IDX_fed_events_stage_error', ['stage', 'errorCode', 'occurredAt'])
@Index('IDX_fed_events_user_time', ['userId', 'occurredAt'])
export class FederatedAuthEventEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'event_uid', type: 'varchar', length: 64 })
  public eventUid!: string;

  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'flow_type', type: 'varchar', length: 16 })
  public flowType!: FederatedFlowType | string;

  @Column({ type: 'varchar', length: 40 })
  public stage!: FederatedAuthStage | string;

  @Column({ type: 'varchar', length: 16 })
  public outcome!: FederatedAuthOutcome | string;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  public errorCode!: string | null;

  @Column({ name: 'provider_error', type: 'varchar', length: 120, nullable: true })
  public providerError!: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 1000, nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'http_status', type: 'smallint', nullable: true })
  public httpStatus!: number | null;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  public durationMs!: number;

  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  public userId!: number | null;

  @Column({ name: 'identity_id', type: 'bigint', nullable: true })
  public identityId!: number | null;

  @Column({ name: 'request_id', type: 'varchar', length: 120, nullable: true })
  public requestId!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 120, nullable: true })
  public correlationId!: string | null;

  @Column({ name: 'source_ip_masked', type: 'varchar', length: 64, nullable: true })
  public sourceIpMasked!: string | null;

  @Column({ name: 'metadata_redacted_json', type: 'text', nullable: true })
  public metadataRedactedJson!: string | null;

  @Column({ name: 'occurred_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public occurredAt!: Date;
}
