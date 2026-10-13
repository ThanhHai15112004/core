/** Class theo log level — màu lấy từ token level / tone của theme. */
export const LOG_LEVEL_CLASS = {
  fatal: 'bg-level-fatal text-primary-fg border-transparent',
  error: 'border-crit-border bg-crit-bg text-crit-fg',
  warn: 'border-warn-border bg-warn-bg text-warn-fg',
  info: 'border-info-border bg-info-bg text-info-fg',
  debug: 'border-border-strong bg-panel-2 text-muted',
  verbose: 'border-border-strong bg-panel-2 text-faint',
} as const;

export type LogLevel = keyof typeof LOG_LEVEL_CLASS;
