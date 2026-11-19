import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { ProviderTypeName } from '@packages/kernel/index.js';
import {
  bigintNumberTransformer,
  nullableBigintNumberTransformer,
} from '../helpers/provider-bigint.helper.js';

@Entity({ name: 'provider_unit_assignments' })
@Index('UQ_pr_unit_type_org', ['providerType', 'organizationUnitId'], { unique: true })
@Index('IDX_pr_unit_primary', ['primaryProviderId'])
@Index('IDX_pr_unit_fallback', ['fallbackProviderId'])
export class ProviderUnitAssignmentEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'provider_type', type: 'varchar', length: 24 })
  public providerType!: ProviderTypeName;

  @Column({
    name: 'organization_unit_id',
    type: 'bigint',
    transformer: bigintNumberTransformer,
  })
  public organizationUnitId!: number;

  @Column({
    name: 'primary_provider_id',
    type: 'bigint',
    transformer: bigintNumberTransformer,
  })
  public primaryProviderId!: number;

  @Column({
    name: 'fallback_provider_id',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public fallbackProviderId!: number | null;

  @Column({ name: 'allow_fallback_override', type: 'boolean', nullable: true })
  public allowFallbackOverride!: boolean | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  public isEnabled!: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public notes!: string | null;

  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public createdBy!: number | null;

  @Column({
    name: 'updated_by',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public updatedBy!: number | null;
}
