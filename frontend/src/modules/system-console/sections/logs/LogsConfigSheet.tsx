import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Bug, RotateCcw, ShieldCheck } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useAppMutation, useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { cn } from '@core/lib/cn';
import { Badge, Button, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { ConfigSheet, ConfirmDialog, DataTable, DetailSection, KeyValueGrid, QueryView, RelativeTime } from '@core/ui/blocks';
import type { LevelState, LogsConfig, OverrideLevel } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { LEVEL_DURATIONS, OVERRIDE_LEVELS } from '../../constants/logs';
import { logTime } from '../../utils/logs-format';
import { logsKeys } from './logs-keys';

const PERMANENT = 'permanent';
const MAX_SCOPE_MODULES = 10;
const runtimeCol = createColumnHelper<LevelState>();
type InstanceRow = LevelState['instances'][number] & { runtime: string };
const instanceCol = createColumnHelper<InstanceRow>();

interface LevelRequest {
  state: LevelState;
  level: OverrideLevel;
}

/** Cấu hình Logs (sheet): backend, log level từng runtime (đổi tạm thời), pipeline ghi, thời gian giữ, che dữ liệu, quyền. */
export function LogsConfigSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLocale();
  const query = useLiveQuery(logsKeys.config(), () => logsApi.config(), { tier: 'slow', enabled: open });
  return (
    <ConfigSheet open={open} onOpenChange={onOpenChange} title={t('logs.page.settingsTitle')} subtitle={t('logs.config.backendNote')}>
      <QueryView query={query}>{(d) => <ConfigBody d={d} />}</QueryView>
    </ConfigSheet>
  );
}

function ConfigBody({ d }: { d: LogsConfig }) {
  const { t, locale } = useLocale();
  const f = useFormat();
  const [req, setReq] = useState<LevelRequest | null>(null);
  const [duration, setDuration] = useState<string>(String(LEVEL_DURATIONS[0]));
  const [modules, setModules] = useState<string[]>([]);
  const p = d.permissions;
  const prod = d.environment === 'production';

  const setLevel = useAppMutation({
    mutationFn: (r: LevelRequest) =>
      logsApi.setLevel({ runtime: r.state.runtime, level: r.level, durationMin: duration === PERMANENT ? null : Number(duration), modules }),
    invalidate: [logsKeys.all],
    success: (_d, r) => t('logs.config.levelSet', { runtime: t(`rt.name.${r.state.runtime}`), level: r.level }),
    onSuccess: () => setReq(null),
  });
  const revert = useAppMutation({
    mutationFn: (runtime: string) => logsApi.revertLevel(runtime),
    invalidate: [logsKeys.all],
    success: (_d, runtime) => t('logs.config.levelReverted', { runtime: t(`rt.name.${runtime}`) }),
  });

  const open = (state: LevelState, level: OverrideLevel) => {
    setReq({ state, level });
    setDuration(String(LEVEL_DURATIONS[0]));
    setModules([]);
  };

  const runtimeCols = useMemo(
    () => [
      runtimeCol.accessor('runtime', {
        header: t('logs.config.runtime'),
        cell: (c) => (
          <div>
            <div className="text-fg">{t(`rt.name.${c.getValue()}`)}</div>
            <div className="text-2xs text-faint">{c.row.original.running ? t('logs.config.instances', { count: c.row.original.instances.length }) : t('logs.config.notRunning')}</div>
          </div>
        ),
      }),
      runtimeCol.display({
        id: 'level',
        header: t('logs.config.current'),
        cell: (c) => {
          const inst = c.row.original.instances[0];
          if (!inst) return NO_VALUE;
          return (
            <div>
              <Badge className="font-mono">{inst.level}</Badge>
              {inst.baseLevel !== inst.level && <div className="text-2xs text-faint">{t('logs.config.base', { level: inst.baseLevel })}</div>}
            </div>
          );
        },
      }),
      runtimeCol.display({
        id: 'override',
        header: t('logs.config.temporary'),
        cell: (c) => {
          const o = c.row.original.override;
          if (!o) return <span className="text-faint">{NO_VALUE}</span>;
          return (
            <div>
              <Badge tone="warn" className="font-mono">
                {o.previous} → {o.level}
              </Badge>
              <div className="text-2xs text-faint">
                {o.until ? (
                  <>
                    {t('logs.config.until', { when: '' })}
                    <RelativeTime value={o.until} />
                  </>
                ) : (
                  t('logs.config.untilChanged')
                )}
                {o.modules.length > 0 && ` · ${o.modules.join(', ')}`}
              </div>
            </div>
          );
        },
      }),
      runtimeCol.display({
        id: 'actions',
        header: t('logs.config.change'),
        cell: (c) => {
          const r = c.row.original;
          return (
            <div className="flex flex-wrap gap-1">
              {OVERRIDE_LEVELS.map((l) => (
                <Button key={l} size="xs" disabled={!r.running || !p.levelChange} onClick={() => open(r, l)}>
                  {l === 'DEBUG' && <Bug />}
                  {l}
                </Button>
              ))}
              {r.override && (
                <Button size="xs" variant="danger-outline" disabled={!p.levelChange || revert.isPending} onClick={() => revert.mutate(r.runtime)}>
                  <RotateCcw />
                  {t('logs.config.revert')}
                </Button>
              )}
            </div>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, p.levelChange, revert.isPending],
  );

  const instances: InstanceRow[] = d.runtimes.flatMap((r) => r.instances.map((i) => ({ ...i, runtime: r.runtime })));
  const instanceCols = useMemo(
    () => [
      instanceCol.accessor('instance', {
        header: t('logs.config.instance'),
        cell: (c) => (
          <div className="min-w-0">
            <div>{t(`rt.name.${c.row.original.runtime}`)}</div>
            <div className="truncate font-mono text-2xs text-faint">{c.getValue()}</div>
          </div>
        ),
      }),
      instanceCol.accessor('written', { header: t('logs.config.written'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true } }),
      instanceCol.accessor('dropped', {
        header: t('logs.config.dropped'),
        cell: (c) => <span className={c.getValue() > 0 ? 'text-crit-fg' : 'text-faint'}>{f.compact(c.getValue())}</span>,
        meta: { align: 'right', mono: true },
      }),
      instanceCol.accessor('lastSuccessAt', {
        header: t('logs.config.lastWrite'),
        cell: (c) => (
          <div>
            <RelativeTime value={c.getValue()} />
            {c.row.original.lastError && <div className="truncate text-2xs text-crit-fg" title={c.row.original.lastError}>{c.row.original.lastError}</div>}
          </div>
        ),
      }),
    ],
    [t, f],
  );

  return (
    <>
      <DetailSection title={t('logs.config.backendTitle')}>
        <KeyValueGrid
          items={[
            { label: t('logs.pipeline.backend'), value: t('logs.backend.redis') },
            { label: t('logs.pipeline.history'), value: t('logs.pipeline.limited', { count: f.compact(d.backend.bufferSize) }) },
            { label: t('logs.config.search'), value: t('logs.config.searchScan') },
            { label: t('logs.config.format'), value: d.backend.consoleFormat, mono: true },
          ]}
        />
      </DetailSection>

      <DetailSection title={t('logs.config.levelTitle')}>
        <p className="mb-2 text-xs text-muted">{p.levelChange ? t('logs.config.levelHint') : t('logs.config.levelDisabled')}</p>
        <div className="overflow-hidden rounded-md border border-border">
          <DataTable data={d.runtimes} columns={runtimeCols} getRowId={(r) => r.runtime} />
        </div>
        <p className="mt-1.5 text-xs text-faint">{t('logs.config.levelNote')}</p>
      </DetailSection>

      <DetailSection title={t('logs.config.pipelineTitle')}>
        <div className="overflow-hidden rounded-md border border-border">
          <DataTable data={instances} columns={instanceCols} getRowId={(i) => i.instance} />
        </div>
        <h4 className="mb-1.5 mt-3 text-xs font-medium text-muted">{t('logs.config.buffers')}</h4>
        <KeyValueGrid
          columns={3}
          items={d.buffers.map((b) => ({
            key: b.runtime,
            label: t(`rt.name.${b.runtime}`),
            value: `${f.compact(b.entries)} / ${f.compact(b.capacity)}${b.oldestAt ? ` · ${t('logs.config.oldest', { time: logTime(b.oldestAt) })}` : ''}`,
            mono: true,
          }))}
        />
      </DetailSection>

      <DetailSection title={t('logs.config.retentionTitle')}>
        <KeyValueGrid items={d.retention.map((r) => ({ key: r.key, label: t(`logs.config.retention.${r.key}`), value: t(`logs.config.retentionValue.${r.key}`, { value: typeof r.value === 'number' ? f.number(r.value) : r.value }) }))} />
      </DetailSection>

      <DetailSection
        title={t('logs.config.redactionTitle')}
        actions={
          <Badge tone="ok">
            <ShieldCheck />
            {t('logs.pipeline.redactionOn')}
          </Badge>
        }
      >
        <p className="mb-2 text-sm text-fg-2">{t('logs.config.redactionNote')}</p>
        <div className="mb-2 flex flex-wrap gap-1">
          {d.redaction.keys.map((k) => (
            <Badge key={k} size="xs" className="font-mono">
              {k}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted">{t('logs.config.patterns', { list: d.redaction.patterns.join(', ') })}</p>
      </DetailSection>

      <DetailSection title={t('logs.config.permissionsTitle')}>
        <KeyValueGrid
          columns={3}
          items={[
            ...(['levelChange', 'levelPermanent', 'export', 'details', 'audit'] as const).map((k) => ({
              key: k,
              label: t(`logs.config.perm.${k}`),
              value: <Badge tone={p[k] ? 'ok' : 'unknown'}>{p[k] ? t('db.config.yes') : t('db.config.no')}</Badge>,
            })),
            { key: 'exportMax', label: t('logs.config.perm.exportMax'), value: p.exportMax.toLocaleString(locale), mono: true },
          ]}
        />
      </DetailSection>

      <DetailSection title={t('logs.config.rulesTitle')}>
        <KeyValueGrid columns={3} items={Object.entries(d.rules).map(([k, v]) => ({ key: k, label: t(`logs.config.rule.${k}`), value: String(v), mono: true }))} />
      </DetailSection>

      <ConfirmDialog
        open={req !== null}
        onOpenChange={(o) => !o && setReq(null)}
        title={req ? t('logs.config.modalTitle', { runtime: t(`rt.name.${req.state.runtime}`) }) : ''}
        description={req ? `${req.state.instances[0]?.level ?? NO_VALUE} → ${req.level} · ${t('logs.config.environment')}: ${d.environment.toUpperCase()}` : undefined}
        impact={req ? [req.level === 'DEBUG' ? t(prod ? 'logs.config.debugWarnProd' : 'logs.config.debugWarn') : t('logs.config.levelWarn')] : undefined}
        confirmLabel={req ? t('logs.config.apply', { level: req.level }) : ''}
        tone={prod && req?.level === 'DEBUG' ? 'danger' : 'primary'}
        loading={setLevel.isPending}
        onConfirm={() => req && setLevel.mutate(req)}
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">{t('logs.config.duration')}</span>
          <ToggleGroup type="single" value={duration} onValueChange={(v) => v && setDuration(v)} className="self-start">
            {LEVEL_DURATIONS.map((m) => (
              <ToggleGroupItem key={m} value={String(m)}>
                {t('logs.config.minutes', { count: m })}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem value={PERMANENT} disabled={!p.levelPermanent} title={p.levelPermanent ? undefined : t('logs.config.permanentDisabled')}>
              {t('logs.config.untilChanged')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {d.modules.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">{t('logs.config.scope')}</span>
            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
              {d.modules.map((m) => {
                const on = modules.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setModules((prev) => (on ? prev.filter((x) => x !== m) : [...prev, m].slice(0, MAX_SCOPE_MODULES)))}
                    className={cn('rounded-sm border px-1.5 py-0.5 font-mono text-xs', on ? 'border-primary bg-primary-subtle text-fg' : 'border-border-strong text-fg-2 hover:bg-panel-2')}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-faint">{modules.length ? t('logs.config.scopeSome', { list: modules.join(', ') }) : t('logs.config.scopeAll')}</span>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
