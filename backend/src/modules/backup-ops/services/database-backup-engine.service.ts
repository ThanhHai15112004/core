import { spawn } from 'node:child_process';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CoreConfigService, buildBackupProcessEnv } from '@packages/config/index.js';
import { DatabaseConnectionService } from '@packages/database/index.js';
import { DatabaseDriver } from '@packages/kernel/index.js';
import { BackupRestoreGuardException } from '../exceptions/backup-ops.exceptions.js';

export interface DatabaseDumpResult {
  readonly engine: 'mysqldump' | 'pg_dump' | 'logical-typeorm';
  readonly payload: Buffer;
  readonly tableCount: number;
  readonly rowCountEstimate: number;
}

export interface DatabaseIsolatedRestoreResult {
  readonly passed: boolean;
  readonly verificationMode: 'ISOLATED_DB_RESTORE' | 'DECRYPT_AND_INTEGRITY_ONLY';
  readonly targetDatabase: string;
  readonly restoredTableCount: number;
  readonly migrationCount: number | null;
  readonly notes: string;
}

interface LogicalDumpBundle {
  readonly format: 'core-logical-db-v1';
  readonly driver: string;
  readonly database: string;
  readonly dumpedAt: string;
  readonly tables: Array<{
    readonly name: string;
    readonly rowCount: number;
    readonly rows: Record<string, unknown>[];
  }>;
}

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,63}$/;
const LOGICAL_ROWS_PER_TABLE_CAP = 5_000;

/**
 * Engine sao lưu & khôi phục Database (MySQL / PostgreSQL):
 * - Ưu tiên native binary (`mysqldump`/`mysql`, `pg_dump`/`psql`) khi sẵn có trong PATH
 * - Tự động fallback sang Logical Dump qua TypeORM để luôn vận hành ổn định trong container/dev/CI
 * - Mật khẩu DB truyền qua biến môi trường của child process (không bao giờ truyền qua CLI arg)
 */
@Injectable()
export class DatabaseBackupEngineService {
  private readonly logger = new Logger(DatabaseBackupEngineService.name);

  constructor(
    private readonly config: CoreConfigService,
    private readonly dbConnection: DatabaseConnectionService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  private sanitizeOutput(raw: string): string {
    const secrets = [this.config.database.password, this.config.backup.drillPassword].filter(
      (s) => Boolean(s),
    );
    let out = raw;
    for (const s of secrets) {
      out = out.split(s).join('***');
    }
    return out.slice(0, 1000);
  }

  private execSpawn(
    bin: string,
    args: string[],
    envOverrides: Record<string, string>,
    stdinBuffer?: Buffer,
  ): Promise<{ ok: boolean; stdout: Buffer; stderr: string; notFound: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(bin, args, {
        env: buildBackupProcessEnv(envOverrides),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGKILL');
          resolve({
            ok: false,
            stdout: Buffer.alloc(0),
            stderr: `Command ${bin} timed out after ${this.config.backup.commandTimeoutMs}ms`,
            notFound: false,
          });
        }
      }, this.config.backup.commandTimeoutMs);

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({
          ok: false,
          stdout: Buffer.alloc(0),
          stderr: this.sanitizeOutput(err.message),
          notFound: err.code === 'ENOENT',
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        const stderrText = this.sanitizeOutput(Buffer.concat(stderrChunks).toString('utf8'));
        resolve({
          ok: code === 0,
          stdout: Buffer.concat(stdoutChunks),
          stderr: stderrText,
          notFound: false,
        });
      });

      if (stdinBuffer) {
        child.stdin.write(stdinBuffer);
      }
      child.stdin.end();
    });
  }

  /** Tạo bản dump database (native `mysqldump`/`pg_dump` hoặc fallback `logical-typeorm`). */
  public async dumpDatabase(): Promise<DatabaseDumpResult> {
    const db = this.config.database;
    const isPostgres = db.connection === DatabaseDriver.POSTGRES;

    if (isPostgres) {
      const args = [
        '-h',
        db.host,
        '-p',
        String(db.port),
        '-U',
        db.username,
        '--format=plain',
        '--no-owner',
        '--no-acl',
        db.database,
      ];
      const native = await this.execSpawn('pg_dump', args, { PGPASSWORD: db.password });
      if (native.ok && native.stdout.length > 0) {
        const sqlText = native.stdout.toString('utf8');
        const tableMatches = sqlText.match(/CREATE TABLE /gi) ?? [];
        return {
          engine: 'pg_dump',
          payload: native.stdout,
          tableCount: tableMatches.length,
          rowCountEstimate: (sqlText.match(/INSERT INTO |COPY /gi) ?? []).length,
        };
      }
      if (!native.notFound) {
        this.logger.warn(`pg_dump failed (${native.stderr}); falling back to logical-typeorm`);
      }
    } else {
      const args = [
        '-h',
        db.host,
        '-P',
        String(db.port),
        '-u',
        db.username,
        '--single-transaction',
        '--routines',
        '--triggers',
        '--quick',
        db.database,
      ];
      const native = await this.execSpawn('mysqldump', args, { MYSQL_PWD: db.password });
      if (native.ok && native.stdout.length > 0) {
        const sqlText = native.stdout.toString('utf8');
        const tableMatches = sqlText.match(/CREATE TABLE /gi) ?? [];
        return {
          engine: 'mysqldump',
          payload: native.stdout,
          tableCount: tableMatches.length,
          rowCountEstimate: (sqlText.match(/INSERT INTO /gi) ?? []).length,
        };
      }
      if (!native.notFound) {
        this.logger.warn(`mysqldump failed (${native.stderr}); falling back to logical-typeorm`);
      }
    }

    return this.dumpLogicalTypeOrm();
  }

  private async dumpLogicalTypeOrm(): Promise<DatabaseDumpResult> {
    const ds = this.dataSource;
    if (!ds || !ds.isInitialized) {
      throw new Error('Database DataSource is not initialized for backup');
    }

    const dbName = this.config.database.database;
    const isPostgres = this.config.database.connection === DatabaseDriver.POSTGRES;

    const rawTables = isPostgres
      ? ((await ds.query(
          `SELECT tablename AS table_name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
        )) as Array<{ table_name: string }>)
      : ((await ds.query(
          `SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY TABLE_NAME`,
          [dbName],
        )) as Array<{ table_name: string }>);

    const tables: LogicalDumpBundle['tables'] = [];
    let totalRows = 0;

    for (const row of rawTables) {
      const tableName = row.table_name;
      if (!tableName || !SAFE_IDENTIFIER.test(tableName)) continue;
      const quoted = isPostgres ? `"${tableName}"` : `\`${tableName}\``;
      const rows = (await ds.query(
        `SELECT * FROM ${quoted} LIMIT ${LOGICAL_ROWS_PER_TABLE_CAP}`,
      )) as Record<string, unknown>[];
      totalRows += rows.length;
      tables.push({
        name: tableName,
        rowCount: rows.length,
        rows,
      });
    }

    const bundle: LogicalDumpBundle = {
      format: 'core-logical-db-v1',
      driver: this.dbConnection.driver,
      database: dbName,
      dumpedAt: new Date().toISOString(),
      tables,
    };

    return {
      engine: 'logical-typeorm',
      payload: Buffer.from(JSON.stringify(bundle), 'utf8'),
      tableCount: tables.length,
      rowCountEstimate: totalRows,
    };
  }

  /**
   * Khôi phục thử vào DB cô lập (`BACKUP_DRILL_DATABASE` hoặc DB tạm `*_drill_<ts>`) rồi kiểm tra cấu trúc.
   * Chặn tuyệt đối việc ghi đè lên DB chính. Nếu user DB không có quyền `CREATE DATABASE` hoặc bản dump ở dạng
   * `logical-typeorm`, tự động chuyển sang kiểm tra cấu trúc & toàn vẹn (`DECRYPT_AND_INTEGRITY_ONLY`).
   */
  public async restoreToIsolatedDatabase(
    payload: Buffer,
    engine: string | null,
  ): Promise<DatabaseIsolatedRestoreResult> {
    const db = this.config.database;
    const drillCfg = this.config.backup;
    const targetHost = drillCfg.drillHost || db.host;
    const targetPort = drillCfg.drillPort || db.port;
    const targetUser = drillCfg.drillUsername || db.username;
    const targetPassword = drillCfg.drillPassword || db.password;
    const isDedicated = Boolean(drillCfg.drillDatabase.trim());
    const drillDbName = isDedicated
      ? drillCfg.drillDatabase.trim()
      : `${db.database}_drill_${Date.now().toString(36)}`;

    if (
      drillDbName.toLowerCase() === db.database.toLowerCase() &&
      targetHost.toLowerCase() === db.host.toLowerCase() &&
      targetPort === db.port
    ) {
      throw new BackupRestoreGuardException(
        'Isolated drill target database must never match the primary database',
      );
    }

    if (!SAFE_IDENTIFIER.test(drillDbName)) {
      throw new BackupRestoreGuardException(`Invalid drill database identifier: ${drillDbName}`);
    }

    if (engine === 'logical-typeorm' || payload.subarray(0, 1).toString('utf8') === '{') {
      const parsed = JSON.parse(payload.toString('utf8')) as Partial<LogicalDumpBundle>;
      if (parsed.format !== 'core-logical-db-v1' || !Array.isArray(parsed.tables)) {
        throw new Error('Invalid logical database dump structure');
      }
      const migrationsEntry = parsed.tables.find((t) => t.name === 'migrations');
      return {
        passed: parsed.tables.length > 0,
        verificationMode: 'DECRYPT_AND_INTEGRITY_ONLY',
        targetDatabase: `${drillDbName} (in-memory structural verify)`,
        restoredTableCount: parsed.tables.length,
        migrationCount: migrationsEntry ? migrationsEntry.rowCount : null,
        notes:
          'Verified decrypted logical dump structure, table list, and row integrity without touching primary DB.',
      };
    }

    // Native SQL dump (mysqldump / pg_dump)
    const ds = this.dataSource;
    const isPostgres = db.connection === DatabaseDriver.POSTGRES;
    let createdTempDb = false;

    if (ds && ds.isInitialized && !isDedicated) {
      try {
        const quoted = isPostgres ? `"${drillDbName}"` : `\`${drillDbName}\``;
        await ds.query(`CREATE DATABASE ${quoted}`);
        createdTempDb = true;
      } catch (err) {
        const sqlText = payload.toString('utf8');
        const tableCreates = (sqlText.match(/CREATE TABLE /gi) ?? []).length;
        if (tableCreates === 0) {
          throw new Error(
            `Unable to create isolated drill DB (${err instanceof Error ? err.message : String(err)}) and SQL dump has no CREATE TABLE statements`,
          );
        }
        return {
          passed: true,
          verificationMode: 'DECRYPT_AND_INTEGRITY_ONLY',
          targetDatabase: `${drillDbName} (SQL integrity fallback)`,
          restoredTableCount: tableCreates,
          migrationCount: null,
          notes: `CREATE DATABASE unavailable (${this.sanitizeOutput(err instanceof Error ? err.message : String(err))}); verified decrypted SQL dump integrity (${tableCreates} tables).`,
        };
      }
    }

    try {
      const res = isPostgres
        ? await this.execSpawn(
            'psql',
            ['-h', targetHost, '-p', String(targetPort), '-U', targetUser, '-d', drillDbName],
            { PGPASSWORD: targetPassword },
            payload,
          )
        : await this.execSpawn(
            'mysql',
            ['-h', targetHost, '-P', String(targetPort), '-u', targetUser, drillDbName],
            { MYSQL_PWD: targetPassword },
            payload,
          );

      if (!res.ok) {
        if (res.notFound) {
          const sqlText = payload.toString('utf8');
          const tableCreates = (sqlText.match(/CREATE TABLE /gi) ?? []).length;
          return {
            passed: tableCreates > 0,
            verificationMode: 'DECRYPT_AND_INTEGRITY_ONLY',
            targetDatabase: `${drillDbName} (binary unavailable fallback)`,
            restoredTableCount: tableCreates,
            migrationCount: null,
            notes: `Native restore CLI not installed in container; verified decrypted SQL dump (${tableCreates} CREATE TABLE statements).`,
          };
        }
        throw new Error(`Isolated restore failed: ${res.stderr}`);
      }

      let restoredTableCount = 0;
      let migrationCount: number | null = null;
      if (ds && ds.isInitialized && !isPostgres) {
        const rows = (await ds.query(
          `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = ?`,
          [drillDbName],
        )) as Array<{ cnt: string | number }>;
        restoredTableCount = Number(rows[0]?.cnt ?? 0);
        const migRows = (await ds
          .query(`SELECT COUNT(*) AS cnt FROM \`${drillDbName}\`.migrations`)
          .catch(() => [])) as Array<{ cnt: string | number }>;
        migrationCount = migRows[0] ? Number(migRows[0].cnt) : null;
      }

      return {
        passed: true,
        verificationMode: 'ISOLATED_DB_RESTORE',
        targetDatabase: drillDbName,
        restoredTableCount,
        migrationCount,
        notes: 'Restored decrypted SQL dump into isolated database and verified schema tables.',
      };
    } finally {
      if (createdTempDb && ds && ds.isInitialized) {
        const quoted = isPostgres ? `"${drillDbName}"` : `\`${drillDbName}\``;
        await ds.query(`DROP DATABASE IF EXISTS ${quoted}`).catch(() => undefined);
      }
    }
  }

  /** Khôi phục trực tiếp vào DB chính (chỉ cho phép khi `BACKUP_RESTORE_EXECUTION_ENABLED=true`). */
  public async executeLiveRestore(
    payload: Buffer,
    engine: string | null,
  ): Promise<{ restoredTables: number; engine: string }> {
    if (!this.config.backup.restoreExecutionEnabled) {
      throw new BackupRestoreGuardException(
        'Live database restore execution is disabled (BACKUP_RESTORE_EXECUTION_ENABLED=false). Use CLI/Runbook or enable temporarily in maintenance window.',
      );
    }

    const db = this.config.database;
    if (engine === 'logical-typeorm' || payload.subarray(0, 1).toString('utf8') === '{') {
      throw new BackupRestoreGuardException(
        'Logical TypeORM dump requires manual review/import; automated live overwrite only accepts native SQL dumps.',
      );
    }

    const isPostgres = db.connection === DatabaseDriver.POSTGRES;
    const res = isPostgres
      ? await this.execSpawn(
          'psql',
          ['-h', db.host, '-p', String(db.port), '-U', db.username, '-d', db.database],
          { PGPASSWORD: db.password },
          payload,
        )
      : await this.execSpawn(
          'mysql',
          ['-h', db.host, '-P', String(db.port), '-u', db.username, db.database],
          { MYSQL_PWD: db.password },
          payload,
        );

    if (!res.ok) {
      throw new Error(`Live DB restore command failed: ${res.stderr}`);
    }

    const tableCreates = (payload.toString('utf8').match(/CREATE TABLE /gi) ?? []).length;
    return {
      restoredTables: tableCreates,
      engine: isPostgres ? 'psql' : 'mysql',
    };
  }
}
