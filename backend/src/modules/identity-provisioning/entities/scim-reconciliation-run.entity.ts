import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  SCIM_RECONCILIATION_MODE,
  type ScimReconciliationMode,
} from '../enum/identity-provisioning.enum.js';

@Entity({ name: 'scim_reconciliation_runs' })
@Index('IDX_scim_recon_runs_client_created', ['clientId', 'createdAt'])
export class ScimReconciliationRunEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'client_id', type: 'int' })
  public clientId!: number;

  @Column({ type: 'varchar', length: 24, default: SCIM_RECONCILIATION_MODE.DRY_RUN })
  public mode!: ScimReconciliationMode;

  @Column({ type: 'varchar', length: 24, default: 'COMPLETED' })
  public status!: string;

  @Column({ name: 'idp_users_count', type: 'int', default: 0 })
  public idpUsersCount!: number;

  @Column({ name: 'local_users_count', type: 'int', default: 0 })
  public localUsersCount!: number;

  @Column({ name: 'idp_groups_count', type: 'int', default: 0 })
  public idpGroupsCount!: number;

  @Column({ name: 'local_groups_count', type: 'int', default: 0 })
  public localGroupsCount!: number;

  @Column({ name: 'discrepancies_count', type: 'int', default: 0 })
  public discrepanciesCount!: number;

  @Column({ name: 'applied_actions_count', type: 'int', default: 0 })
  public appliedActionsCount!: number;

  @Column({ name: 'summary_json', type: 'text', nullable: true })
  public summaryJson!: string | null;

  @Column({ name: 'discrepancies_json', type: 'text', nullable: true })
  public discrepanciesJson!: string | null;

  @Column({ name: 'triggered_by', type: 'bigint', nullable: true })
  public triggeredBy!: number | null;

  @Column({ name: 'started_at', type: 'timestamp' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;
}
