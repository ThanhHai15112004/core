import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';

@Entity({ name: 'scim_user_links' })
@Index('UQ_scim_user_links_client_external', ['clientId', 'externalId'], { unique: true })
@Index('UQ_scim_user_links_client_user', ['clientId', 'userId'], { unique: true })
@Index('IDX_scim_user_links_user', ['userId'])
export class ScimUserLinkEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'client_id', type: 'int' })
  public clientId!: number;

  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Column({ name: 'external_id', type: 'varchar', length: 255 })
  public externalId!: string;

  @Column({ name: 'scim_username', type: 'varchar', length: 255 })
  public scimUsername!: string;

  @Column({ name: 'scim_version', type: 'int', default: 1 })
  public scimVersion!: number;

  @Column({ name: 'payload_fingerprint', type: 'varchar', length: 64 })
  public payloadFingerprint!: string;

  @Column({ type: 'boolean', default: true })
  public active!: boolean;

  @Column({ name: 'raw_attributes_json', type: 'text', nullable: true })
  public rawAttributesJson!: string | null;

  @Column({ name: 'last_synced_at', type: 'timestamp' })
  public lastSyncedAt!: Date;

  @Column({ name: 'deprovisioned_at', type: 'timestamp', nullable: true })
  public deprovisionedAt!: Date | null;

  @Column({ name: 'deprovision_reason', type: 'varchar', length: 255, nullable: true })
  public deprovisionReason!: string | null;
}
