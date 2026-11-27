import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BACKUP_OPS_PUBLIC_SERVICE,
  type IBackupOpsPublicService,
} from '@modules/backup-ops/contracts/index.js';
import {
  BACKUP_TARGET_TYPE,
  BACKUP_TRIGGER_SOURCE,
  RESTORE_SCOPE,
  type BackupTargetType,
  type RestoreScope,
} from '@modules/backup-ops/index.js';
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
export class BackupCommand implements ICliCommandProvider {
  constructor(
    @Optional()
    @Inject(BACKUP_OPS_PUBLIC_SERVICE)
    private readonly backupOps?: IBackupOpsPublicService,
  ) {}

  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'backup:run',
        domain: 'Database',
        description:
          'Chạy sao lưu Database hoặc Object Storage ngay lập tức (có nén + mã hóa AES-256-GCM)',
        usage: 'npm run cli -- backup:run [--type=DATABASE|STORAGE] [--policy=<code>]',
        execute: (args) => this.runBackup(args),
      },
      {
        name: 'backup:verify',
        domain: 'Database',
        description: 'Chạy kiểm tra tự động & Restore Drill cô lập cho bản sao lưu',
        usage: 'npm run cli -- backup:verify [--id=<recordId>] [--reason="..."]',
        execute: (args) => this.verifyBackup(args),
      },
      {
        name: 'backup:prune',
        domain: 'Database',
        description: 'Dọn dẹp các bản sao lưu đã quá hạn lưu trữ theo chính sách Retention',
        usage: 'npm run cli -- backup:prune',
        execute: () => this.pruneBackups(),
      },
      {
        name: 'backup:storage-versioning',
        domain: 'Database',
        description: 'Kiểm tra hoặc bật Bucket Versioning cho Object Storage (S3/MinIO)',
        usage: 'npm run cli -- backup:storage-versioning [--enable]',
        execute: (args) => this.storageVersioning(args),
      },
      {
        name: 'backup:restore',
        domain: 'Database',
        description:
          'Ghi nhận hoặc thực thi thao tác Restore (bắt buộc truyền --reason và người thực hiện)',
        usage:
          'npm run cli -- backup:restore --id=<recordId> --reason="..." [--scope=DATABASE|STORAGE|SECRETS_CONFIG|FULL] [--target=staging] [--actor=ops] [--execute --confirm=RESTORE]',
        execute: (args) => this.restoreBackup(args),
      },
    ];
  }

  private assertService(): IBackupOpsPublicService {
    if (!this.backupOps) {
      throw new Error('BackupOpsModule is not loaded in CLI context');
    }
    return this.backupOps;
  }

  private async runBackup(args: string[]): Promise<void> {
    const svc = this.assertService();
    const rawType = readFlag(args, 'type')?.toUpperCase();
    const targetType: BackupTargetType | undefined =
      rawType === BACKUP_TARGET_TYPE.STORAGE
        ? BACKUP_TARGET_TYPE.STORAGE
        : rawType === BACKUP_TARGET_TYPE.DATABASE
          ? BACKUP_TARGET_TYPE.DATABASE
          : undefined;
    const policyCode = readFlag(args, 'policy');

    const record = await svc.runBackup({
      targetType,
      policyCode,
      triggerSource: BACKUP_TRIGGER_SOURCE.CLI,
      actorName: 'cli-operator',
    });

    console.log(JSON.stringify(record, null, 2));
  }

  private async verifyBackup(args: string[]): Promise<void> {
    const svc = this.assertService();
    const idRaw = readFlag(args, 'id');
    const reason = readFlag(args, 'reason') ?? 'CLI isolated restore drill';
    if (idRaw) {
      const id = Number(idRaw);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`Invalid --id value: ${idRaw}`);
      }
      const res = await svc.verifyBackupRecord(id, { actorName: 'cli-operator', reason });
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    const res = await svc.runScheduledVerifyDrill();
    console.log(JSON.stringify(res ?? { message: 'No backup candidate found' }, null, 2));
  }

  private async pruneBackups(): Promise<void> {
    const svc = this.assertService();
    const res = await svc.pruneExpiredBackups();
    console.log(JSON.stringify(res, null, 2));
  }

  private async storageVersioning(args: string[]): Promise<void> {
    const svc = this.assertService();
    const enable = args.includes('--enable');
    const res = enable
      ? await svc.enableStorageVersioning({ name: 'cli-operator' })
      : await svc.getStorageVersioningStatus();
    console.log(JSON.stringify(res, null, 2));
  }

  private async restoreBackup(args: string[]): Promise<void> {
    const svc = this.assertService();
    const idRaw = readFlag(args, 'id');
    const reason = readFlag(args, 'reason') ?? '';
    const targetEnvironment = readFlag(args, 'target') ?? 'staging';
    const actorName = readFlag(args, 'actor') ?? 'cli-operator';
    const rawScope = (readFlag(args, 'scope') ?? 'DATABASE').toUpperCase();
    const scope = (
      Object.values(RESTORE_SCOPE).includes(rawScope as RestoreScope)
        ? rawScope
        : RESTORE_SCOPE.DATABASE
    ) as RestoreScope;
    const execute = args.includes('--execute');
    const confirm = readFlag(args, 'confirm');

    if (!reason || reason.trim().length < 5) {
      throw new Error('Missing or too short --reason="..." (at least 5 characters required)');
    }

    const res = await svc.executeOrRecordRestore({
      backupRecordId: idRaw ? Number(idRaw) : null,
      mode: execute ? 'EXECUTE_LIVE' : 'RECORD_MANUAL',
      scope,
      targetEnvironment,
      actorName,
      reason,
      confirm,
    });

    console.log(JSON.stringify(res, null, 2));
  }
}
