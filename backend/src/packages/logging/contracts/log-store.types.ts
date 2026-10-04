/** Level tạm thời của một runtime (System Console đặt, runtime tự áp dụng và tự hết hạn). */
export interface LogLevelOverrideRecord {
  runtime: string;
  level: 'VERBOSE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  previous: string;
  /** epoch ms; null = tới khi đổi lại. */
  until: number | null;
  modules: string[];
  setAt: number;
  actor: string | null;
}

/** Tình trạng ghi log của một instance (runtime tự báo mỗi vài giây). */
export interface LogIngestState {
  runtime: string;
  instance: string;
  /** Lần ghi vào Redis Stream thành công gần nhất (epoch ms). */
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  /** Tổng log bị mất kể từ khi process chạy (buffer đầy / Redis lỗi). */
  dropped: number;
  /** Level đang áp dụng và level gốc. */
  level: string;
  baseLevel: string;
  overrideUntil: number | null;
  overrideModules: string[];
  suppressed: number;
  written: number;
  redacted: number;
  updatedAt: number;
}

export type LogsOperationAction = 'level_change' | 'level_revert' | 'export';

export interface LogsOperationRecord {
  id: string;
  at: number;
  action: LogsOperationAction;
  target: string;
  result: 'success' | 'failed';
  detail: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
}
