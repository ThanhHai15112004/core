export interface LoggingModuleOptions {
  /** `api` | `worker` | `scheduler` | `cli` — gắn vào mọi log (`runtime`). */
  runtime: string;
}

export const LOGGING_OPTIONS = Symbol('LOGGING_OPTIONS');
