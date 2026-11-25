export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  VERBOSE = 'VERBOSE',
}

export enum LoggingAction {
  SET_LEVEL_DEBUG = 'set_level_debug',
  SET_LEVEL_INFO = 'set_level_info',
  SET_LEVEL_WARN = 'set_level_warn',
}

/** Level cấu hình (`LOG_LEVEL`) → level pino. */
export const PINO_LEVEL: Record<string, string> = {
  VERBOSE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

/** Level pino (số) → nhãn. */
export const PINO_LEVEL_LABEL: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};
