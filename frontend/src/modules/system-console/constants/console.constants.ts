export const CONSOLE_STORAGE_KEYS = {
  THEME: 'core_sys_console_theme_v2',
  LAST_SECTION: 'core_sys_console_last_section',
  NAV_COLLAPSED: 'core_sys_console_nav_collapsed',
} as const;

/** Chu kỳ tự cập nhật số liệu; người dùng không cần bấm làm mới. */
export const POLL_INTERVAL_MS = 5000;

/** Tông màu theo môi trường backend — production đỏ để tránh thao tác nhầm. */
export const ENV_TONE = { production: 'crit', staging: 'warn', development: 'info' } as const;
