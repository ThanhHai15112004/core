export interface DatabaseConnectionContract {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  ping(): Promise<boolean>;
}

export interface SlowQueryRecord {
  at: number;
  sql: string;
  durationMs: number;
  failed: boolean;
  instance: string;
  correlationId: string | null;
}
