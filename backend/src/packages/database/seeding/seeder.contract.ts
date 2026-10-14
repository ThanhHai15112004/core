import type { EntityManager } from 'typeorm';

export type SeederScope = 'master' | 'development';

export interface SeederContext {
  manager: EntityManager;
  driver: string;
  environment: string;
}

export interface SeederItemResult {
  name: string;
  scope: SeederScope;
  status: 'completed' | 'skipped' | 'failed';
  affected: number;
  durationMs: number;
  details?: string;
  error?: string;
}

export interface SeederRunSummary {
  at: string;
  environment: string;
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  items: SeederItemResult[];
}

export interface SeederContract {
  readonly name: string;
  readonly scope: SeederScope;
  readonly order?: number;
  run(ctx: SeederContext): Promise<{ affected: number; details?: string }>;
}
