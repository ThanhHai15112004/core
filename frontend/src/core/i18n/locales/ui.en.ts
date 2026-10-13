import type { UiTranslation } from './ui.vi';

export const uiEn: UiTranslation = {
  toast: {
    done: 'Done',
    failed: 'Action failed',
    copied: 'Copied',
  },
  state: {
    empty: 'No data yet',
    error: 'Could not load data',
    noSource: 'No data source configured',
    retry: 'Retry',
    offline: 'Lost connection to the server — showing the last known data',
  },
  action: {
    refresh: 'Refresh',
    copy: 'Copy',
    close: 'Close',
    cancel: 'Cancel',
    showMore: 'Show more',
    showLess: 'Show less',
    loadMore: 'Load more',
    fullscreen: 'Fullscreen',
    settings: 'Settings',
    search: 'Search',
    clear: 'Clear filters',
  },
  time: {
    range: 'Time range',
    last: 'Last {{range}}',
    ranges: {
      '5m': '5 minutes',
      '15m': '15 minutes',
      '1h': '1 hour',
      '6h': '6 hours',
      '24h': '24 hours',
      '7d': '7 days',
    },
  },
  refresh: {
    label: 'Auto refresh',
    off: 'Off',
    every: 'Every {{value}}',
  },
  theme: {
    toggle: 'Toggle theme',
    dark: 'Dark',
    light: 'Light',
  },
  locale: {
    toggle: 'Switch language',
  },
  table: {
    sortAsc: 'Sort ascending',
    sortDesc: 'Sort descending',
    rows: '{{count}} rows',
    noMatch: 'No rows match the filter',
  },
  confirm: {
    typeToConfirm: 'Type {{word}} to confirm',
    impact: 'Impact',
  },
  command: {
    pages: 'Pages',
    actions: 'Actions',
    open: 'Quick search',
    placeholder: 'Type a page, queue, task…',
    empty: 'Nothing found',
    hint: 'Ctrl K',
  },
  sidebar: {
    collapse: 'Collapse sidebar',
    expand: 'Expand sidebar',
    menu: 'Open menu',
  },
  chart: {
    metric: 'Metric',
    current: 'Current',
    average: 'Average',
    peak: 'Peak',
    noData: 'No data in this range',
    threshold: 'Threshold',
  },
  feed: {
    all: 'All',
    empty: 'No activity yet',
  },
  compare: {
    metric: 'Metric',
    current: 'Today',
    previous: 'Yesterday',
    change: 'Change',
  },
  alerts: {
    none: 'No problems',
    okChecks: '{{count}} checks passing',
  },
  json: {
    empty: 'No data',
  },
  mask: {
    hidden: 'Secret value — always masked',
  },
  source: {
    unsupportedBy: '{{driver}} does not provide this data',
    unsupported: 'Not provided by the current source',
    disconnected: 'Not connected — no data yet',
    error: 'Could not read this part',
  },
  config: {
    configured: 'Configured',
    notConfigured: 'Not configured',
    yes: 'Yes',
    no: 'No',
    copy: 'Copy (without secrets)',
  },
  status: {
    ok: 'Healthy',
    warn: 'Warning',
    crit: 'Critical',
    info: 'Info',
    unknown: 'Unknown',
  },
};
