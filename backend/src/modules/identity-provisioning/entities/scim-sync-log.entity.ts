import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { ScimSyncOutcome } from '../enum/identity-provisioning.enum.js';

@Entity({ name: 'scim_sync_logs' })
@Index('IDX_scim_sync_logs_client_created', ['clientId', 'createdAt'])
@Index('IDX_scim_sync_logs_outcome', ['outcome', 'createdAt'])
@Index('IDX_scim_sync_logs_external', ['externalId'])
export class ScimSyncLogEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'client_id', type: 'int', nullable: true })
  public clientId!: number | null;

  @Column({ name: 'request_id', type: 'varchar', length: 128, nullable: true })
  public requestId!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 128, nullable: true })
  public correlationId!: string | null;

  @Column({ type: 'varchar', length: 40 })
  public operation!: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 32 })
  public resourceType!: string;

  @Column({ name: 'resource_id', type: 'varchar', length: 128, nullable: true })
  public resourceId!: string | null;

  @Column({ name: 'external_id', type: 'varchar', length: 255, nullable: true })
  public externalId!: string | null;

  @Column({ name: 'http_method', type: 'varchar', length: 12 })
  public httpMethod!: string;

  @Column({ name: 'http_path', type: 'varchar', length: 500 })
  public httpPath!: string;

  @Column({ name: 'http_status', type: 'int' })
  public httpStatus!: number;

  @Column({ type: 'varchar', length: 32 })
  public outcome!: ScimSyncOutcome;

  @Column({ name: 'idempotency_hit', type: 'boolean', default: false })
  public idempotencyHit!: boolean;

  @Column({ name: 'request_summary_json', type: 'text', nullable: true })
  public requestSummaryJson!: string | null;

  @Column({ name: 'response_summary_json', type: 'text', nullable: true })
  public responseSummaryJson!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  public errorCode!: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 500, nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  public ipAddress!: string | null;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  public durationMs!: number;
}
