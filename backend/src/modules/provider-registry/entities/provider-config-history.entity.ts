import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import type { ProviderTypeName } from '@packages/kernel/index.js';
import type { ProviderHistoryAction } from '../enum/provider-registry.enum.js';
import { nullableBigintNumberTransformer } from '../helpers/provider-bigint.helper.js';

@Entity({ name: 'provider_config_histories' })
@Index('IDX_pr_history_provider_time', ['providerId', 'createdAt'])
@Index('IDX_pr_history_action_time', ['action', 'createdAt'])
@Index('IDX_pr_history_type_time', ['providerType', 'createdAt'])
export class ProviderConfigHistoryEntity extends TypeOrmBaseEntity {
  @Column({
    name: 'provider_id',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public providerId!: number | null;

  @Column({ name: 'provider_type', type: 'varchar', length: 24 })
  public providerType!: ProviderTypeName;

  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ type: 'varchar', length: 32 })
  public action!: ProviderHistoryAction | string;

  @Column({ name: 'before_state_json', type: 'text', nullable: true })
  public beforeStateJson!: string | null;

  @Column({ name: 'after_state_json', type: 'text', nullable: true })
  public afterStateJson!: string | null;

  @Column({ name: 'changed_fields_json', type: 'text', nullable: true })
  public changedFieldsJson!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public reason!: string | null;

  @Column({
    name: 'actor_user_id',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public actorUserId!: number | null;

  @Column({ name: 'actor_identifier', type: 'varchar', length: 150, nullable: true })
  public actorIdentifier!: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  public ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  public userAgent!: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 128, nullable: true })
  public requestId!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 128, nullable: true })
  public correlationId!: string | null;
}
