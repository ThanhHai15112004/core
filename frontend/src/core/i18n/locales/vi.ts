import { uiVi } from './ui.vi';
import { trVi } from './console/tr.vi';
import { dbVi } from './console/db.vi';
import { cacheVi } from './console/cache.vi';
import { storageVi } from './console/storage.vi';
import { messagingVi } from './console/messaging.vi';
import { wqVi } from './console/wq.vi';
import { jobsVi } from './console/jobs.vi';
import { logsVi } from './console/logs.vi';
import { schVi } from './console/sch.vi';
import { perfVi } from './console/perf.vi';
import { rtVi } from './console/rt.vi';
import { govVi } from './console/gov.vi';

export const vi = {
  ui: uiVi,
  nav: {
    overview: 'Tổng quan',
    runtimes: 'Runtimes',
    'http-traffic': 'HTTP Traffic',
    performance: 'Hiệu năng',
    database: 'Cơ sở dữ liệu',
    cache: 'Bộ nhớ đệm',
    storage: 'Lưu trữ',
    messaging: 'Messaging',
    worker: 'Worker & Queue',
    scheduler: 'Scheduler',
    jobs: 'Jobs',
    logs: 'Nhật ký',
    security: 'Bảo mật',
    secrets: 'Secrets',
    configuration: 'Cấu hình',
    packages: 'Packages',
    backToHome: 'Về trang chủ',
    systemConsole: 'System Console',
    group: {
      'runtime-traffic': 'Runtime & Traffic',
      infrastructure: 'Hạ tầng',
      background: 'Tác vụ nền',
      governance: 'Quản trị',
    },
  },
  overview: {
    title: 'Tổng quan hệ thống',
  },
  kpi: {
    reqSec: 'Request / giây',
    p95Latency: 'Độ trễ P95',
    errorRate: 'Tỷ lệ lỗi',
    cpuUsage: 'Mức dùng CPU',
    memoryUsage: 'Mức dùng RAM',
    activeAlerts: 'Cảnh báo',
  },
  header: {
    systemConsole: 'System Console',
    home: 'Trang chủ',
    auth: 'Xác thực & Bảo mật',
    organizations: 'Đơn vị & Tổ chức',
    iam: 'Người dùng & Xác thực',
    files: 'Quản lý File & Media',
    languageToggle: 'Ngôn ngữ',
    themeLight: 'Sáng',
    themeDark: 'Tối',
  },
  footer: {
    platformStatus: 'Hạ tầng Core đang chạy',
    controlPlane: 'Bảng Điều Khiển',
    architecture: 'Kiến trúc',
    documentation: 'Tài liệu',
    copyright: 'Bản quyền thuộc về Core Architecture Team. Sẵn sàng cho Microservices.',
  },
  console: {
    status: {
      healthy: 'Hoạt động tốt',
      warning: 'Cảnh báo',
      error: 'Lỗi',
      idle: 'Chờ',
      unknown: 'Chưa rõ',
      down: 'Ngừng hoạt động',
      critical: 'Nghiêm trọng',
      degraded: 'Suy giảm',
      ok: 'Ổn định',
      normal: 'Bình thường',
      active: 'Đang chạy',
      info: 'Thông tin',
    },
    healthStatus: { down: 'Mất kết nối' },
    toast: {
      connectionLostTitle: 'Mất kết nối',
      connectionLostMessage: 'Không kết nối được Core API Gateway. Đang hiển thị trạng thái gần nhất.',
      actionSucceeded: 'Thực thi thành công',
      actionWarning: 'Thực thi có cảnh báo',
      actionFailed: 'Thực thi thất bại',
    },
    topbar: {
      latency: 'Độ trễ round-trip tới /health',
    },
  },
  home: {
    badge: 'Core Framework đã khởi tạo thành công',
    heroTitle: 'Phát triển web hiện đại',
    heroHighlight: 'với React + Vite',
    heroDescription: 'Cấu trúc frontend sẵn sàng cho production: kiến trúc rõ ràng, design system hiện đại và TypeScript đầy đủ.',
    counter: 'Trạng thái tương tác: {{count}}',
    resetCounter: 'Đặt lại',
    consoleTitle: 'Bảng điều khiển hệ thống cho Developer & DevOps',
    consoleDescription: 'Dashboard hạ tầng để theo dõi runtime, package, database, cache và cấu hình bảo mật.',
    consoleLaunch: 'Mở System Console',
    featuresTitle: 'Cấu trúc & tính năng dự án',
    layoutTitle: 'Cấu trúc thư mục Frontend (AGENTS.md)',
    features: {
      react: { title: 'React 19 & TypeScript', description: 'Dùng React mới nhất cùng kiểm tra kiểu nghiêm ngặt.' },
      vite: { title: 'Vite', description: 'HMR cực nhanh và build production tối ưu.' },
      modular: { title: 'Kiến trúc module', description: 'Tách rõ tầng core dùng chung và các module nghiệp vụ độc lập.' },
      backend: { title: 'Sẵn sàng kết nối Backend', description: 'Service API đã cấu hình để làm việc với backend NestJS Fastify.' },
    },
  },
  ov: {
    env: {
      production: 'Production',
      staging: 'Staging',
      development: 'Development',
      unknown: 'Chưa rõ môi trường',
      tooltip: 'Môi trường backend đang kết nối',
    },
    sidebar: {
      subtitle: 'Core Control Plane',
      problemPackages: 'Số package đang cảnh báo/lỗi',
    },
    page: {
      healthyCount: '{{healthy}}/{{total}} ổn định',
      components: 'Thành phần',
      problems: 'Cần chú ý',
      activity: 'Hoạt động gần đây',
      allLogs: 'Xem nhật ký',
      uptime: 'Uptime {{value}}',
      lastSync: 'Lần cuối kết nối được {{ago}}',
      overviewError: 'Không tải được dữ liệu tổng quan',
      metric: { throughput: 'Lưu lượng', latency: 'Độ trễ P95', errors: 'Tỷ lệ lỗi', cpu: 'CPU' },
    },
    map: {
      category: { runtime: 'Runtime', infrastructure: 'Hạ tầng', governance: 'Bảo mật' },
      item: {
        'runtime-api': 'API Gateway',
        'runtime-worker': 'Worker',
        'runtime-scheduler': 'Scheduler',
        'infra-db': 'Cơ sở dữ liệu',
        'infra-cache': 'Bộ nhớ đệm',
        'infra-storage': 'Lưu trữ',
        'infra-messaging': 'Messaging',
        'gov-security': 'Bảo mật & Xác thực',
      },
    },
    offline: {
      title: 'Không kết nối được Core API',
      neverSynced: 'Chưa kết nối thành công lần nào trong phiên này.',
    },
  },
  tr: trVi,
  db: dbVi,
  cache: cacheVi,
  storage: storageVi,
  messaging: messagingVi,
  wq: wqVi,
  jobs: jobsVi,
  logs: logsVi,
  sch: schVi,
  perf: perfVi,
  rt: rtVi,
  gov: govVi,
};

export type TranslationKey = typeof vi;
