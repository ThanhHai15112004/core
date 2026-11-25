import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  IDEMPOTENCY_STATUS,
  type IdempotencyScope,
  type IdempotencyStatusCode,
} from '../enum/idempotency.enum.js';

@Entity({ name: 'idempotency_records' })
@Index('UQ_idempotency_records_scope_key', ['scope', 'scopeTarget', 'idempotencyKey'], {
  unique: true,
})
@Index('IDX_idempotency_records_expires', ['expiresAt'])
@Index('IDX_idempotency_records_scope_created', ['scope', 'createdAt'])
@Index('IDX_idempotency_records_client_dup', ['clientIdentifier', 'lastDuplicateAt'])
@Index('IDX_idempotency_records_status_lease', ['status', 'lockedUntil'])
@Index('IDX_idempotency_records_correlation', ['correlationId'])
export class IdempotencyRecordEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'scope', type: 'varchar', length: 32 })
  public scope!: IdempotencyScope;

  @Column({ name: 'scope_target', type: 'varchar', length: 200 })
  public scopeTarget!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 200 })
  public idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'varchar', length: 128 })
  public requestFingerprint!: string;

  @Column({ name: 'status', type: 'smallint', default: IDEMPOTENCY_STATUS.IN_PROGRESS })
  public status!: IdempotencyStatusCode;

  @Column({ name: 'response_status_code', type: 'int', nullable: true })
  public responseStatusCode!: number | null;

  @Column({ name: 'response_body_json', type: 'text', nullable: true })
  public responseBodyJson!: string | null;

  @Column({ name: 'response_headers_json', type: 'text', nullable: true })
  public responseHeadersJson!: string | null;

  @Column({ name: 'lock_owner', type: 'varchar', length: 160, nullable: true })
  public lockOwner!: string | null;

  @Column({ name: 'locked_until', type: 'timestamp', nullable: true })
  public lockedUntil!: Date | null;

  @Column({ name: 'client_identifier', type: 'varchar', length: 160, nullable: true })
  public clientIdentifier!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 120, nullable: true })
  public correlationId!: string | null;

  @Column({ name: 'duplicate_hits', type: 'int', default: 0 })
  public duplicateHits!: number;

  @Column({ name: 'conflict_hits', type: 'int', default: 0 })
  public conflictHits!: number;

  @Column({ name: 'last_duplicate_at', type: 'timestamp', nullable: true })
  public lastDuplicateAt!: Date | null;

  @Column({ name: 'last_conflict_at', type: 'timestamp', nullable: true })
  public lastConflictAt!: Date | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 80, nullable: true })
  public lastErrorCode!: string | null;

  @Column({ name: 'last_error_message', type: 'varchar', length: 1000, nullable: true })
  public lastErrorMessage!: string | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamp' })
  public expiresAt!: Date;
}
