import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import { cacheKeys } from '@packages/cache/index.js';
import { storageKeys } from '@packages/storage/index.js';
import { queueKeys } from '@packages/queue/index.js';
import { messagingKeys } from '@packages/messaging/index.js';
import { schedulerKeys } from '@packages/scheduler/index.js';
import { databaseKeys, type DbEventRecord } from '@packages/database/index.js';
import { logsKeys } from '@packages/logging/index.js';
import { runtimeKeys } from '@packages/runtime/index.js';
import type { AuditDomain, AuditEventDto, AuditListDto } from '../responses/logs-ops.response.js';

/** Bản ghi thao tác của các module (cùng khung: id, at, action, target, result, actor, ip…). */
interface OperationLike {
  id?: string;
  at: number;
  action: string;
  target?: string;
  result?: 'success' | 'failed';
  detail?: string | null;
  reason?: string | null;
  affected?: number;
  durationMs?: number;
  actor?: string | null;
  ip?: string | null;
  error?: string | null;
  executionId?: string | null;
  jobType?: string | null;
}

/** Sự kiện DB là thao tác của người vận hành (không phải sự cố tự phát). */
const DB_AUDIT_EVENTS = new Set([
  'query_cancelled',
  'session_terminated',
  'migration_completed',
  'migration_failed',
]);
/** Sự kiện runtime do lệnh từ Console (restart / pause / resume). */
const RUNTIME_AUDIT_EVENTS = new Set(['restart_requested', 'paused', 'resumed', 'command_failed']);
const RUNTIME_EVENT_SCAN = 2000;

export interface AuditQuery {
  from: number | null;
  to: number | null;
  domain: AuditDomain | null;
  result: 'success' | 'failed' | null;
  q: string | null;
  cursor: string | null;
  limit: number;
}

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Audit log hợp nhất — tách khỏi application log: ai đã làm gì trên hệ thống (xoá cache, retry job, tắt task, đổi
 * log level…). Chỉ đọc; không có thao tác xoá (retention do từng module giữ N bản ghi gần nhất).
 */
@Injectable()
export class LogAuditService {
  constructor(private readonly redis: RedisService) {}

  private sources(): { domain: AuditDomain; key: string }[] {
    const r = this.redis;
    return [
      { domain: 'cache', key: cacheKeys(r).operations() },
      { domain: 'storage', key: storageKeys(r).operations() },
      { domain: 'queue', key: queueKeys(r).operations() },
      { domain: 'messaging', key: messagingKeys(r).operations() },
      { domain: 'scheduler', key: schedulerKeys(r).operations() },
      { domain: 'logs', key: logsKeys(r).operations() },
    ];
  }

  /** Mọi bản ghi audit, mới nhất trước. */
  public async all(): Promise<{ items: AuditEventDto[]; domains: AuditListDto['domains'] }> {
    if (!this.redis.isReady()) return { items: [], domains: [] };
    const sources = this.sources();
    const pipe = this.redis.client.pipeline();
    for (const s of sources) pipe.lrange(s.key, 0, -1);
    pipe.lrange(databaseKeys(this.redis).events(), 0, -1);
    pipe.xrevrange(runtimeKeys(this.redis).events(), '+', '-', 'COUNT', RUNTIME_EVENT_SCAN);
    const results = (await pipe.exec()) ?? [];
    const items: AuditEventDto[] = [];
    const domains: AuditListDto['domains'] = [];
    const push = (domain: AuditDomain, list: AuditEventDto[]) => {
      items.push(...list);
      const oldest = list.reduce<number | null>((m, e) => {
        const t = Date.parse(e.at);
        return m === null || t < m ? t : m;
      }, null);
      domains.push({
        domain,
        entries: list.length,
        oldestAt: oldest ? new Date(oldest).toISOString() : null,
      });
    };

    sources.forEach((s, i) => {
      const [err, raws] = results[i] ?? [];
      if (err || !Array.isArray(raws)) return;
      push(
        s.domain,
        (raws as string[])
          .map((raw) => parse<OperationLike>(raw))
          .filter(
            (o): o is OperationLike =>
              !!o && typeof o.at === 'number' && typeof o.action === 'string',
          )
          .map((o, j) => this.fromOperation(s.domain, o, j)),
      );
    });

    const [dbErr, dbRaws] = results[sources.length] ?? [];
    if (!dbErr && Array.isArray(dbRaws)) {
      push(
        'database',
        (dbRaws as string[])
          .map((raw) => parse<DbEventRecord>(raw))
          .filter((e): e is DbEventRecord => !!e && DB_AUDIT_EVENTS.has(e.type))
          .map((e) => ({
            id: `database:${e.id}`,
            at: new Date(e.at).toISOString(),
            domain: 'database' as const,
            action: e.type,
            target:
              e.type === 'query_cancelled' || e.type === 'session_terminated'
                ? `#${e.params.session ?? '?'}`
                : null,
            result: e.type === 'migration_failed' ? ('failed' as const) : ('success' as const),
            actor: null,
            ip: null,
            detail: e.type.startsWith('migration')
              ? `count=${e.params.count ?? 0}`
              : [e.params.runtime, e.params.query].filter(Boolean).join(' · ') || null,
            error: e.type === 'migration_failed' ? String(e.params.error ?? '') || null : null,
            durationMs: null,
          })),
      );
    }

    const [rtErr, rtRaws] = results[sources.length + 1] ?? [];
    if (!rtErr && Array.isArray(rtRaws)) {
      const list: AuditEventDto[] = [];
      for (const [id, fields] of rtRaws as [string, string[]][]) {
        const rec: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) rec[fields[i]!] = fields[i + 1]!;
        if (!RUNTIME_AUDIT_EVENTS.has(rec.type ?? '')) continue;
        const data = parse<Record<string, unknown>>(rec.data ?? '{}') ?? {};
        list.push({
          id: `runtime:${id}`,
          at: rec.at ?? new Date(Number(id.split('-')[0])).toISOString(),
          domain: 'runtime',
          action: rec.type!,
          target: rec.runtime ?? null,
          result: rec.type === 'command_failed' ? 'failed' : 'success',
          actor: null,
          ip: null,
          detail: typeof data.mode === 'string' ? `mode=${data.mode}` : null,
          error: typeof data.error === 'string' ? data.error : null,
          durationMs: null,
        });
      }
      push('runtime', list);
    }

    items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (b.id < a.id ? -1 : 1));
    return { items, domains };
  }

  private fromOperation(domain: AuditDomain, o: OperationLike, index: number): AuditEventDto {
    const detail = [
      o.detail ?? null,
      o.jobType ? `type=${o.jobType}` : null,
      typeof o.affected === 'number' ? `affected=${o.affected}` : null,
      o.reason ? `reason=${o.reason}` : null,
      o.executionId ? `execution=${o.executionId}` : null,
    ].filter(Boolean);
    return {
      id: `${domain}:${o.id ?? `${o.at}-${index}`}`,
      at: new Date(o.at).toISOString(),
      domain,
      action: o.action,
      target: o.target ?? null,
      result: o.result === 'failed' ? 'failed' : 'success',
      actor: o.actor ?? null,
      ip: o.ip ?? null,
      detail: detail.length ? detail.join(' · ') : null,
      error: o.error ?? null,
      durationMs: typeof o.durationMs === 'number' ? o.durationMs : null,
    };
  }

  public async list(q: AuditQuery): Promise<AuditListDto> {
    const { items, domains } = await this.all();
    const text = q.q?.toLowerCase().trim() ?? '';
    const filtered = items.filter((e) => {
      const at = Date.parse(e.at);
      if (q.from !== null && at < q.from) return false;
      if (q.to !== null && at > q.to) return false;
      if (q.domain && e.domain !== q.domain) return false;
      if (q.result && e.result !== q.result) return false;
      if (text) {
        const hay =
          `${e.action} ${e.target ?? ''} ${e.actor ?? ''} ${e.detail ?? ''} ${e.error ?? ''}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });
    const start = q.cursor ? Math.max(0, filtered.findIndex((e) => e.id === q.cursor) + 1) : 0;
    const page = filtered.slice(start, start + q.limit);
    const hasMore = start + q.limit < filtered.length;
    return {
      items: page,
      nextCursor: hasMore && page.length ? page[page.length - 1]!.id : null,
      total: filtered.length,
      domains,
    };
  }
}
