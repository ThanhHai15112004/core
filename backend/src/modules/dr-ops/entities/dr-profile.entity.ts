import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { DrOperationalState, DrSiteRole, DrTopologyMode } from '../enum/dr-ops.enum.js';

@Entity({ name: 'dr_profiles' })
@Index('UQ_dr_profiles_code', ['code'], { unique: true })
export class DrProfileEntity extends VersionedTypeOrmEntity {
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ type: 'varchar', length: 160 })
  public name!: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: false })
  public isEnabled!: boolean;

  @Column({ name: 'topology_mode', type: 'varchar', length: 32, default: 'WARM_STANDBY' })
  public topologyMode!: DrTopologyMode;

  @Column({ name: 'rpo_target_seconds', type: 'int', default: 900 })
  public rpoTargetSeconds!: number;

  @Column({ name: 'rto_target_seconds', type: 'int', default: 1800 })
  public rtoTargetSeconds!: number;

  @Column({ name: 'primary_site_code', type: 'varchar', length: 64, default: 'dc-primary' })
  public primarySiteCode!: string;

  @Column({
    name: 'primary_site_name',
    type: 'varchar',
    length: 160,
    default: 'Primary Data Center',
  })
  public primarySiteName!: string;

  @Column({ name: 'primary_region', type: 'varchar', length: 80, default: 'ap-southeast-1' })
  public primaryRegion!: string;

  @Column({ name: 'primary_endpoint', type: 'varchar', length: 255, nullable: true })
  public primaryEndpoint!: string | null;

  @Column({ name: 'dr_site_code', type: 'varchar', length: 64, default: 'dc-dr' })
  public drSiteCode!: string;

  @Column({ name: 'dr_site_name', type: 'varchar', length: 160, default: 'DR Standby Site' })
  public drSiteName!: string;

  @Column({ name: 'dr_region', type: 'varchar', length: 80, default: 'ap-southeast-2' })
  public drRegion!: string;

  @Column({ name: 'dr_endpoint', type: 'varchar', length: 255, nullable: true })
  public drEndpoint!: string | null;

  @Column({ name: 'active_site', type: 'varchar', length: 24, default: 'PRIMARY' })
  public activeSite!: DrSiteRole;

  @Column({ name: 'operational_state', type: 'varchar', length: 32, default: 'NORMAL' })
  public operationalState!: DrOperationalState;

  @Column({ name: 'sync_cron', type: 'varchar', length: 64, default: '*/15 * * * *' })
  public syncCron!: string;

  @Column({ name: 'drill_interval_days', type: 'int', default: 30 })
  public drillIntervalDays!: number;

  @Column({ name: 'last_sync_at', type: 'timestamp', nullable: true })
  public lastSyncAt!: Date | null;

  @Column({ name: 'last_rpo_seconds', type: 'int', nullable: true })
  public lastRpoSeconds!: number | null;

  @Column({ name: 'last_drill_at', type: 'timestamp', nullable: true })
  public lastDrillAt!: Date | null;

  @Column({ name: 'last_rto_seconds', type: 'int', nullable: true })
  public lastRtoSeconds!: number | null;

  @Column({ name: 'next_drill_due_at', type: 'timestamp', nullable: true })
  public nextDrillDueAt!: Date | null;

  @Column({ name: 'options_json', type: 'text', nullable: true })
  public optionsJson!: string | null;
}
