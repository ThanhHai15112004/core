import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DR_OPS_PUBLIC_SERVICE,
  type IDrOpsPublicService,
} from '@modules/dr-ops/contracts/index.js';
import {
  DR_DRILL_TYPE,
  DR_SWITCH_DIRECTION,
  DR_SWITCH_MODE,
  DR_SYNC_SCOPE,
  DR_SYNC_TRIGGER,
  DrProfileService,
  DrSwitchoverService,
  type DrDrillType,
  type DrSwitchMode,
  type DrSyncScope,
} from '@modules/dr-ops/index.js';
import {
  type CliCommandDescriptor,
  type ICliCommandProvider,
} from '../../dispatcher/cli-dispatcher.service.js';

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

@Injectable()
export class DrCommand implements ICliCommandProvider {
  constructor(
    @Optional()
    @Inject(DR_OPS_PUBLIC_SERVICE)
    private readonly drOps?: IDrOpsPublicService,
    @Optional()
    private readonly drProfileService?: DrProfileService,
    @Optional()
    private readonly drSwitchoverService?: DrSwitchoverService,
  ) {}

  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'dr:status',
        domain: 'System',
        description:
          'Xem trạng thái tổng quan Disaster Recovery (RPO/RTO, site đang active, đồng bộ & diễn tập)',
        usage: 'npm run cli -- dr:status',
        execute: () => this.showStatus(),
      },
      {
        name: 'dr:sync',
        domain: 'System',
        description: 'Đồng bộ Database / Storage sang DR và đánh giá tuân thủ RPO',
        usage: 'npm run cli -- dr:sync [--scope=FULL|DATABASE|STORAGE]',
        execute: (args) => this.runSync(args),
      },
      {
        name: 'dr:failover',
        domain: 'System',
        description: 'Khởi tạo phiên Failover chuyển từ DC chính sang DR kèm checklist bắt buộc',
        usage:
          'npm run cli -- dr:failover --reason="..." [--mode=SIMULATED|LIVE] [--confirm=FAILOVER]',
        execute: (args) => this.runSwitch('FAILOVER', args),
      },
      {
        name: 'dr:failback',
        domain: 'System',
        description: 'Khởi tạo phiên Failback chuyển về hệ thống chính an toàn (chống split-brain)',
        usage:
          'npm run cli -- dr:failback --reason="..." [--mode=SIMULATED|LIVE] [--confirm=FAILBACK]',
        execute: (args) => this.runSwitch('FAILBACK', args),
      },
      {
        name: 'dr:reconcile',
        domain: 'System',
        description: 'Đối soát dữ liệu DB & Object Storage giữa DC chính và DR sau khi chuyển hệ thống',
        usage: 'npm run cli -- dr:reconcile [--scope=FULL|DATABASE|STORAGE] [--switch-id=<id>]',
        execute: (args) => this.runReconcile(args),
      },
      {
        name: 'dr:drill',
        domain: 'System',
        description: 'Chạy diễn tập Disaster Recovery định kỳ và đo RPO/RTO thực tế',
        usage:
          'npm run cli -- dr:drill [--type=MANUAL_SIMULATION|LIVE_GAME_DAY|TABLETOP] [--scenario="..."]',
        execute: (args) => this.runDrill(args),
      },
    ];
  }

  private assertService(): IDrOpsPublicService {
    if (!this.drOps) {
      throw new Error('DrOpsModule is not loaded in CLI context');
    }
    return this.drOps;
  }

  private async showStatus(): Promise<void> {
    if (this.drProfileService) {
      const overview = await this.drProfileService.getOverview();
      console.log(JSON.stringify(overview, null, 2));
      return;
    }
    const overview = await this.assertService().getOverview();
    console.log(JSON.stringify(overview, null, 2));
  }

  private async runSync(args: string[]): Promise<void> {
    const rawScope = (readFlag(args, 'scope') ?? 'FULL').toUpperCase();
    const scope = (
      Object.values(DR_SYNC_SCOPE).includes(rawScope as DrSyncScope)
        ? rawScope
        : DR_SYNC_SCOPE.FULL
    ) as DrSyncScope;

    const res = await this.assertService().runSync({
      scope,
      triggerSource: DR_SYNC_TRIGGER.CLI,
      actorName: 'cli-operator',
    });
    console.log(JSON.stringify(res, null, 2));
  }

  private async runSwitch(direction: 'FAILOVER' | 'FAILBACK', args: string[]): Promise<void> {
    if (!this.drSwitchoverService) {
      throw new Error('DrSwitchoverService is not available in CLI context');
    }
    const reason = readFlag(args, 'reason') ?? '';
    if (reason.trim().length < 5) {
      throw new Error('Missing or too short --reason="..." (at least 5 characters required)');
    }
    const rawMode = (readFlag(args, 'mode') ?? 'SIMULATED').toUpperCase();
    const mode: DrSwitchMode =
      rawMode === DR_SWITCH_MODE.LIVE ? DR_SWITCH_MODE.LIVE : DR_SWITCH_MODE.SIMULATED;
    const confirm = readFlag(args, 'confirm');

    const res = await this.drSwitchoverService.initiateSwitch({
      direction:
        direction === 'FAILOVER' ? DR_SWITCH_DIRECTION.FAILOVER : DR_SWITCH_DIRECTION.FAILBACK,
      mode,
      reason,
      confirm,
      actorName: 'cli-operator',
    });
    console.log(JSON.stringify(res, null, 2));
  }

  private async runReconcile(args: string[]): Promise<void> {
    const rawScope = (readFlag(args, 'scope') ?? 'FULL').toUpperCase();
    const scope = (
      Object.values(DR_SYNC_SCOPE).includes(rawScope as DrSyncScope)
        ? rawScope
        : DR_SYNC_SCOPE.FULL
    ) as DrSyncScope;
    const switchIdRaw = readFlag(args, 'switch-id');
    const switchExecutionId = switchIdRaw ? Number(switchIdRaw) : null;

    const res = await this.assertService().runReconciliation({
      scope,
      switchExecutionId:
        switchExecutionId && Number.isInteger(switchExecutionId) && switchExecutionId > 0
          ? switchExecutionId
          : null,
      actorName: 'cli-operator',
    });
    console.log(JSON.stringify(res, null, 2));
  }

  private async runDrill(args: string[]): Promise<void> {
    const rawType = (readFlag(args, 'type') ?? 'MANUAL_SIMULATION').toUpperCase();
    const drillType = (
      Object.values(DR_DRILL_TYPE).includes(rawType as DrDrillType)
        ? rawType
        : DR_DRILL_TYPE.MANUAL_SIMULATION
    ) as DrDrillType;
    const scenario = readFlag(args, 'scenario');
    const lessonsLearned = readFlag(args, 'lessons');

    const res = await this.assertService().runDrill({
      drillType,
      scenario,
      lessonsLearned,
      actorName: 'cli-operator',
    });
    console.log(JSON.stringify(res, null, 2));
  }
}
