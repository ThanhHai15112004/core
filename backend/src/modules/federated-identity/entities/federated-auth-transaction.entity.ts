import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { FederatedFlowType } from '../enum/federated-identity.enum.js';

@Entity({ name: 'federated_auth_transactions' })
@Index('UQ_fed_tx_state_hash', ['stateHash'], { unique: true })
@Index('IDX_fed_tx_expires', ['expiresAt', 'consumedAt'])
export class FederatedAuthTransactionEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'state_hash', type: 'varchar', length: 64 })
  public stateHash!: string;

  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'flow_type', type: 'varchar', length: 16 })
  public flowType!: FederatedFlowType;

  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  public userId!: number | null;

  @Column({ name: 'nonce_hash', type: 'varchar', length: 64 })
  public nonceHash!: string;

  @Column({ name: 'code_verifier_encrypted', type: 'text' })
  public codeVerifierEncrypted!: string;

  @Column({ name: 'redirect_uri', type: 'varchar', length: 1000 })
  public redirectUri!: string;

  @Column({ name: 'device_name', type: 'varchar', length: 255, nullable: true })
  public deviceName!: string | null;

  @Column({ name: 'ip_address_masked', type: 'varchar', length: 64, nullable: true })
  public ipAddressMasked!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  public userAgent!: string | null;

  @Column({ name: 'expires_at', type: 'timestamp' })
  public expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamp', nullable: true })
  public consumedAt!: Date | null;
}
