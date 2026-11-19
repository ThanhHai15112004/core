import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';

@Entity({ name: 'federated_identities' })
@Index('UQ_fed_identities_subject', ['providerCode', 'issuerUrl', 'providerSubject'], {
  unique: true,
})
@Index('IDX_fed_identities_user', ['userId', 'providerCode'])
export class FederatedIdentityEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'user_id', type: 'bigint' })
  public userId!: number;

  @Column({ name: 'provider_id', type: 'bigint' })
  public providerId!: number;

  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'issuer_url', type: 'varchar', length: 255 })
  public issuerUrl!: string;

  @Column({ name: 'provider_subject', type: 'varchar', length: 255 })
  public providerSubject!: string;

  @Column({ name: 'provider_tenant_id', type: 'varchar', length: 120, nullable: true })
  public providerTenantId!: string | null;

  @Column({ name: 'email_at_provider', type: 'varchar', length: 255, nullable: true })
  public emailAtProvider!: string | null;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  public emailVerified!: boolean;

  @Column({ name: 'display_name', type: 'varchar', length: 255, nullable: true })
  public displayName!: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 1000, nullable: true })
  public avatarUrl!: string | null;

  @Column({ name: 'profile_metadata_json', type: 'text', nullable: true })
  public profileMetadataJson!: string | null;

  @Column({ name: 'linked_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public linkedAt!: Date;

  @Column({ name: 'linked_by', type: 'bigint', nullable: true })
  public linkedBy!: number | null;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  public lastLoginAt!: Date | null;
}
