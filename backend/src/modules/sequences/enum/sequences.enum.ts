export const MAX_IN_MEMORY_SETTING_HISTORY = 500;
export const MAX_IN_MEMORY_SEQUENCE_HISTORY = MAX_IN_MEMORY_SETTING_HISTORY;

export const SEQUENCES_AUDIT_META = {
  MODULE: 'sequences',
  FEATURES: {
    SEQUENCES: 'sequences',
  },
} as const;

export const SEQUENCE_HISTORY_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  RESET_COUNTER: 'RESET_COUNTER',
  ARCHIVE: 'ARCHIVE',
} as const;

export type SequenceHistoryActionType =
  (typeof SEQUENCE_HISTORY_ACTIONS)[keyof typeof SEQUENCE_HISTORY_ACTIONS];
