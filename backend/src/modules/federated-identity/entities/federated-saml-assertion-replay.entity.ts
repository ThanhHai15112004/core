import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';

@Entity({ name: 'federated_saml_assertion_replays' })
@Index('UQ_fed_saml_replay_provider_assertion', ['providerCode', 'assertionIdHash'], {
  unique: true,
})
@Index('IDX_fed_saml_replay_expires', ['expiresAt'])
export class FederatedSamlAssertionReplayEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'assertion_id_hash', type: 'varchar', length: 64 })
  public assertionIdHash!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public issuer!: string | null;

  @Column({ name: 'expires_at', type: 'timestamp' })
  public expiresAt!: Date;
}
