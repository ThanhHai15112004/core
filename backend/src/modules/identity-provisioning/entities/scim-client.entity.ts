import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  SCIM_CLIENT_STATUS,
  SCIM_DEPROVISION_MODE,
  type ScimClientStatusCode,
  type ScimDeprovisionMode,
} from '../enum/identity-provisioning.enum.js';

@Entity({ name: 'scim_clients' })
@Index('UQ_scim_clients_code', ['code'], { unique: true })
@Index('UQ_scim_clients_token_hash', ['tokenHash'], { unique: true })
@Index('IDX_scim_clients_status', ['status', 'deletedAt'])
export class ScimClientEntity extends VersionedTypeOrmEntity {
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ type: 'varchar', length: 120 })
  public name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'federated_provider_code', type: 'varchar', length: 64, nullable: true })
  public federatedProviderCode!: string | null;

  @Column({ type: 'smallint', default: SCIM_CLIENT_STATUS.ACTIVE })
  public status!: ScimClientStatusCode;

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  public tokenHash!: string;

  @Column({ name: 'token_prefix', type: 'varchar', length: 24 })
  public tokenPrefix!: string;

  @Column({ name: 'allowed_ips_json', type: 'text', nullable: true })
  public allowedIpsJson!: string | null;

  @Column({ name: 'scopes_json', type: 'text', nullable: true })
  public scopesJson!: string | null;

  @Column({
    name: 'deprovision_mode',
    type: 'varchar',
    length: 32,
    default: SCIM_DEPROVISION_MODE.LOCK_AND_REVOKE,
  })
  public deprovisionMode!: ScimDeprovisionMode;

  @Column({ name: 'group_role_mappings_json', type: 'text', nullable: true })
  public groupRoleMappingsJson!: string | null;

  @Column({ name: 'allowed_role_codes_json', type: 'text', nullable: true })
  public allowedRoleCodesJson!: string | null;

  @Column({ name: 'denied_role_codes_json', type: 'text', nullable: true })
  public deniedRoleCodesJson!: string | null;

  @Column({ name: 'default_role_codes_json', type: 'text', nullable: true })
  public defaultRoleCodesJson!: string | null;

  @Column({ name: 'require_if_match', type: 'boolean', default: false })
  public requireIfMatch!: boolean;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  public lastUsedAt!: Date | null;

  @Column({ name: 'last_used_ip', type: 'varchar', length: 64, nullable: true })
  public lastUsedIp!: string | null;

  @Column({ name: 'rotated_at', type: 'timestamp', nullable: true })
  public rotatedAt!: Date | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  public updatedBy!: number | null;
}
