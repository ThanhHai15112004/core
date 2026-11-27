import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  BREAK_GLASS_STATUS,
  type BreakGlassStatusCode,
} from '../enum/privileged-access.enum.js';

@Entity({ name: 'privileged_break_glass_accounts' })
@Index('idx_pam_break_glass_code', ['code'], { unique: true })
@Index('idx_pam_break_glass_user', ['userId'], { unique: true })
@Index('idx_pam_break_glass_status_exp', ['status', 'expiresAt'])
export class PrivilegedBreakGlassAccountEntity extends VersionedTypeOrmEntity {
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Column({ type: 'varchar', length: 160 })
  public label!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'role_code', type: 'varchar', length: 64, default: 'super_admin' })
  public roleCode!: string;

  @Column({ type: 'smallint', default: BREAK_GLASS_STATUS.SEALED })
  public status!: BreakGlassStatusCode;

  @Column({ name: 'require_mfa', type: 'boolean', default: true })
  public requireMfa!: boolean;

  @Column({ name: 'max_activation_minutes', type: 'int', default: 60 })
  public maxActivationMinutes!: number;

  @Column({ name: 'alert_recipients_json', type: 'text', nullable: true })
  public alertRecipientsJson!: string | null;

  @Column({ name: 'last_activated_by', type: 'int', nullable: true })
  public lastActivatedBy!: number | null;

  @Column({ name: 'last_activation_reason', type: 'varchar', length: 1000, nullable: true })
  public lastActivationReason!: string | null;

  @Column({ name: 'last_ticket_ref', type: 'varchar', length: 120, nullable: true })
  public lastTicketRef!: string | null;

  @Column({ name: 'activated_at', type: 'timestamp', nullable: true })
  public activatedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  public expiresAt!: Date | null;

  @Column({ name: 'sealed_by', type: 'int', nullable: true })
  public sealedBy!: number | null;

  @Column({ name: 'sealed_at', type: 'timestamp', nullable: true })
  public sealedAt!: Date | null;

  @Column({ name: 'seal_reason', type: 'varchar', length: 500, nullable: true })
  public sealReason!: string | null;

  @Column({ name: 'activation_count', type: 'int', default: 0 })
  public activationCount!: number;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  public lastUsedAt!: Date | null;

  @Column({ name: 'last_used_ip', type: 'varchar', length: 64, nullable: true })
  public lastUsedIp!: string | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  public updatedBy!: number | null;
}
