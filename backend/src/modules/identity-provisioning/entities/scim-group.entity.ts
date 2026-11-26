import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';

@Entity({ name: 'scim_groups' })
@Index('UQ_scim_groups_client_display', ['clientId', 'displayName'], { unique: true })
@Index('IDX_scim_groups_client_external', ['clientId', 'externalId'])
export class ScimGroupEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'client_id', type: 'int' })
  public clientId!: number;

  @Column({ name: 'external_id', type: 'varchar', length: 255, nullable: true })
  public externalId!: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  public displayName!: string;

  @Column({ name: 'mapped_role_code', type: 'varchar', length: 64, nullable: true })
  public mappedRoleCode!: string | null;

  @Column({ name: 'scim_version', type: 'int', default: 1 })
  public scimVersion!: number;

  @Column({ name: 'payload_fingerprint', type: 'varchar', length: 64 })
  public payloadFingerprint!: string;

  @Column({ type: 'boolean', default: true })
  public active!: boolean;

  @Column({ name: 'last_synced_at', type: 'timestamp' })
  public lastSyncedAt!: Date;
}
