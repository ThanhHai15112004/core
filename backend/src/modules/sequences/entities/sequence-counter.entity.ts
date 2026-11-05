import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('sequence_counters')
@Index('uq_sequence_counters_scope', ['sequenceId', 'periodKey', 'unitScopeKey'], { unique: true })
export class SequenceCounterEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'sequence_id', type: 'int' })
  public sequenceId!: number;

  @Index()
  @Column({ name: 'sequence_key', type: 'varchar', length: 150 })
  public sequenceKey!: string;

  /** Khóa kỳ reset: `'ALL'`, `'2026'`, `'2026-10'`, `'2026-10-20'` (Mục 5.5.5) */
  @Column({ name: 'period_key', type: 'varchar', length: 32, default: 'ALL' })
  public periodKey!: string;

  /** ID đơn vị tổ chức (nếu sinh mã riêng theo đơn vị — Mục 5.5.6) */
  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  /** Khóa phạm vi đơn vị: `'GLOBAL'` hoặc `'UNIT:<id_or_code>'` (Mục 5.5.6) */
  @Column({ name: 'unit_scope_key', type: 'varchar', length: 64, default: 'GLOBAL' })
  public unitScopeKey!: string;

  /** Số thứ tự lớn nhất đã cấp trong kỳ và phạm vi đơn vị này (Mục 5.5.4) */
  @Column({ name: 'current_value', type: 'bigint', default: 0 })
  public currentValue!: number;

  @Column({ type: 'int', default: 1 })
  public version!: number;
}
