import type { LogEntryLevel } from './log-sink.contract.js';

/** Thông tin nhóm lỗi (mẫu gần nhất) — số lần / lần đầu / lần cuối lưu ở key riêng. */
export interface ErrorGroupMeta {
  fingerprint: string;
  errorType: string | null;
  /** Message đã chuẩn hoá (`User {n} not found`). */
  template: string;
  context: string | null;
  /** Khung stack đầu tiên thuộc code ứng dụng. */
  frame: string | null;
  level: LogEntryLevel;
  sample: {
    id: string | null;
    at: number;
    message: string;
    runtime: string | null;
    instance: string | null;
    correlationId: string | null;
    requestId: string | null;
    jobId: string | null;
    jobType: string | null;
    route: string | null;
  };
}

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

/** Tình trạng ghi log của một instance. */
export interface LogIngestState {
  runtime: string;
  instance: string;
  /** Lần ghi vào kho log thành công gần nhất (epoch ms). */
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  /** Tổng log bị mất kể từ khi process chạy (buffer đầy / kho log lỗi). */
  dropped: number;
  /** Level đang áp dụng và level gốc — runtime tự báo. */
  level: string;
  baseLevel: string;
  overrideUntil: number | null;
  overrideModules: string[];
  /** Log bị bỏ qua vì dưới level (không phải mất dữ liệu). */
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
