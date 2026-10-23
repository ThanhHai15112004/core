import type { TranslationKey } from './vi';
import { trEn } from './console/tr.en';
import { dbEn } from './console/db.en';
import { cacheEn } from './console/cache.en';
import { storageEn } from './console/storage.en';
import { messagingEn } from './console/messaging.en';
import { wqEn } from './console/wq.en';
import { jobsEn } from './console/jobs.en';
import { logsEn } from './console/logs.en';
import { schEn } from './console/sch.en';
import { perfEn } from './console/perf.en';
import { rtEn } from './console/rt.en';
import { govEn } from './console/gov.en';
import { uiEn } from './ui.en';

export const en: TranslationKey = {
  ui: uiEn,
  nav: {
    overview: 'Overview',
    runtimes: 'Runtimes',
    'http-traffic': 'HTTP Traffic',
    performance: 'Performance',
    database: 'Database',
    cache: 'Cache',
    storage: 'Storage',
    messaging: 'Messaging',
    worker: 'Worker & Queue',
    scheduler: 'Scheduler',
    jobs: 'Jobs',
    logs: 'Logs',
    security: 'Security',
    secrets: 'Secrets',
    configuration: 'Configuration',
    packages: 'Packages',
    backToHome: 'Back to Home',
    systemConsole: 'System Console',
    group: {
      'runtime-traffic': 'Runtime & Traffic',
      infrastructure: 'Infrastructure',
      background: 'Background Operations',
      governance: 'Governance',
    },
  },
  overview: {
    title: 'System Overview',
  },
  kpi: {
    reqSec: 'Requests / Sec',
    p95Latency: 'P95 Latency',
    errorRate: 'Error Rate',
    cpuUsage: 'CPU Usage',
    memoryUsage: 'Memory Usage',
    activeAlerts: 'Active Alerts',
  },
  header: {
    systemConsole: 'System Console',
    home: 'Home',
    auth: 'Auth & Security',
    iam: 'Users & Auth',
    files: 'Files & Media',
    languageToggle: 'Language',
    themeLight: 'Light',
    themeDark: 'Dark',
  },
  footer: {
    platformStatus: 'Core Platform Active',
    controlPlane: 'Control Plane',
    architecture: 'Architecture',
    documentation: 'Documentation',
    copyright: 'Core Architecture Platform. Designed for Microservices.',
  },
  console: {
    status: {
      healthy: 'Healthy',
      warning: 'Warning',
      error: 'Error',
      idle: 'Idle',
      unknown: 'Unknown',
      down: 'Down',
      critical: 'Critical',
      degraded: 'Degraded',
      ok: 'OK',
      normal: 'Normal',
      active: 'Active',
      info: 'Info',
    },
    healthStatus: { down: 'Offline' },
    toast: {
      connectionLostTitle: 'Connection lost',
      connectionLostMessage: 'Unable to reach Core API Gateway. Showing last known state.',
      actionSucceeded: 'Action succeeded',
      actionWarning: 'Action warning',
      actionFailed: 'Execution failed',
    },
    topbar: {
      latency: 'Round-trip latency to /health',
    },
  },
  home: {
    badge: 'Core Framework initialized successfully',
    heroTitle: 'Modern Web Development',
    heroHighlight: 'Powered by React + Vite',
    heroDescription: 'Your frontend structure is ready for production: clean architecture, a modern design system and full TypeScript.',
    counter: 'Interactive state: {{count}}',
    resetCounter: 'Reset',
    consoleTitle: 'Developer & DevOps System Control Plane',
    consoleDescription: 'Infrastructure dashboard for runtimes, packages, database, cache and security configuration.',
    consoleLaunch: 'Launch System Console',
    featuresTitle: 'Project Structure & Features',
    layoutTitle: 'Frontend Directory Layout (AGENTS.md)',
    features: {
      react: { title: 'React 19 & TypeScript', description: 'Latest React release with strict type checking.' },
      vite: { title: 'Vite', description: 'Lightning fast HMR and optimized production builds.' },
      modular: { title: 'Modular Architecture', description: 'Clear split between reusable core and isolated business modules.' },
      backend: { title: 'Backend Ready', description: 'API service configured to work with the NestJS Fastify backend.' },
    },
  },
  ov: {
    env: {
      production: 'Production',
      staging: 'Staging',
      development: 'Development',
      unknown: 'Unknown environment',
      tooltip: 'Backend environment currently connected',
    },
    sidebar: {
      subtitle: 'Core Control Plane',
      problemPackages: 'Packages in warning/error state',
    },
    page: {
      healthyCount: '{{healthy}}/{{total}} healthy',
      components: 'Components',
      problems: 'Needs attention',
      activity: 'Recent activity',
      allLogs: 'Open logs',
      uptime: 'Uptime {{value}}',
      lastSync: 'Last connected {{ago}}',
      overviewError: 'Could not load overview data',
      metric: { throughput: 'Throughput', latency: 'P95 latency', errors: 'Error rate', cpu: 'CPU' },
    },
    map: {
      category: { runtime: 'Runtime', infrastructure: 'Infrastructure', governance: 'Governance' },
      item: {
        'runtime-api': 'API Gateway',
        'runtime-worker': 'Worker',
        'runtime-scheduler': 'Scheduler',
        'infra-db': 'Database',
        'infra-cache': 'Cache',
        'infra-storage': 'Storage',
        'infra-messaging': 'Messaging',
        'gov-security': 'Security & Auth',
      },
    },
    offline: {
      title: 'Unable to reach Core API',
      neverSynced: 'No successful connection in this session yet.',
    },
  },
  tr: trEn,
  db: dbEn,
  cache: cacheEn,
  storage: storageEn,
  messaging: messagingEn,
  wq: wqEn,
  jobs: jobsEn,
  logs: logsEn,
  sch: schEn,
  perf: perfEn,
  rt: rtEn,
  gov: govEn,
};
