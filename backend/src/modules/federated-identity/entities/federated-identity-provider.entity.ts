import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  FEDERATED_PROVIDER_STATUS,
  type FederatedProviderStatusCode,
} from '../enum/federated-identity.enum.js';

@Entity({ name: 'federated_identity_providers' })
@Index('UQ_fed_providers_code', ['providerCode'], { unique: true })
@Index('IDX_fed_providers_enabled', ['isEnabled', 'status', 'deletedAt'])
export class FederatedIdentityProviderEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'driver_code', type: 'varchar', length: 64 })
  public driverCode!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  public displayName!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ type: 'smallint', default: FEDERATED_PROVIDER_STATUS.INACTIVE })
  public status!: FederatedProviderStatusCode;

  @Column({ name: 'is_enabled', type: 'boolean', default: false })
  public isEnabled!: boolean;

  @Column({ name: 'client_id', type: 'varchar', length: 255, nullable: true })
  public clientId!: string | null;

  @Column({ name: 'client_secret_encrypted', type: 'text', nullable: true })
  public clientSecretEncrypted!: string | null;

  @Column({ name: 'client_secret_hint', type: 'varchar', length: 32, nullable: true })
  public clientSecretHint!: string | null;

  @Column({ name: 'tenant_id', type: 'varchar', length: 120, nullable: true })
  public tenantId!: string | null;

  @Column({ name: 'issuer_url', type: 'varchar', length: 255, nullable: true })
  public issuerUrl!: string | null;

  @Column({ name: 'authorization_endpoint', type: 'varchar', length: 500, nullable: true })
  public authorizationEndpoint!: string | null;

  @Column({ name: 'token_endpoint', type: 'varchar', length: 500, nullable: true })
  public tokenEndpoint!: string | null;

  @Column({ name: 'jwks_uri', type: 'varchar', length: 500, nullable: true })
  public jwksUri!: string | null;

  @Column({ name: 'userinfo_endpoint', type: 'varchar', length: 500, nullable: true })
  public userinfoEndpoint!: string | null;

  @Column({ name: 'scopes_json', type: 'text', nullable: true })
  public scopesJson!: string | null;

  @Column({ name: 'allowed_redirect_uris_json', type: 'text', nullable: true })
  public allowedRedirectUrisJson!: string | null;

  @Column({ name: 'allow_auto_register_override', type: 'boolean', nullable: true })
  public allowAutoRegisterOverride!: boolean | null;

  @Column({ name: 'auto_link_verified_email_override', type: 'boolean', nullable: true })
  public autoLinkVerifiedEmailOverride!: boolean | null;

  @Column({ name: 'extra_config_json', type: 'text', nullable: true })
  public extraConfigJson!: string | null;

  @Column({ name: 'last_success_at', type: 'timestamp', nullable: true })
  public lastSuccessAt!: Date | null;

  @Column({ name: 'last_error_at', type: 'timestamp', nullable: true })
  public lastErrorAt!: Date | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 80, nullable: true })
  public lastErrorCode!: string | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  public updatedBy!: number | null;
}
