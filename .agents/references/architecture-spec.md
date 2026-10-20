# AGENTS.md — Hướng Dẫn Dành Cho AI Assistants & Developers

Tài liệu này là cẩm nang hướng dẫn toàn diện dành cho các AI Assistant (Antigravity, Cursor, Claude, Copilot, ChatGPT...) và Lập trình viên khi làm việc trên dự án **Core Framework**.

---

## 1. TỔNG QUAN DỰ ÁN & TRIẾT LÝ THIẾT KẾ

### 1.1. Mục tiêu cốt lõi
Dự án **Core** được xây dựng như một **Application Chassis (Khung gầm ứng dụng)** và **Base Platform**.
Mục tiêu là cung cấp sẵn toàn bộ hạ tầng kỹ thuật (Infrastructure, Cross-cutting Concerns), cho phép lập trình viên có thể cắm (plug-in) **bất kỳ mã nguồn nghiệp vụ nào** vào một cách nhanh chóng (E-commerce, CRM, LMS, Social, API Gateway, Microservice, Worker, v.v.) mà không bao giờ phải viết lại hạ tầng từ đầu.

### 1.2. Triết lý thiết kế sống còn
1. **Core hoàn toàn độc lập với nghiệp vụ (Domain-Agnostic)**:
   - Tuyệt đối KHÔNG viết business logic cụ thể của một dự án vào tầng Core (`packages/`).
   - Core chỉ cung cấp hạ tầng kỹ thuật thuần (đặt trong `packages/`): Kernel, Config, HTTP, Redis, Database, Logging (Pino/Redis Stream), Metrics (Prometheus/prom-client), Runtime, Security, Cache, Queue (BullMQ), Messaging, Storage, HTTP Client, i18n.
2. **Kiến trúc Modular Monolith hướng Microservices (Microservices-Ready)**:
   - Mỗi module trong `modules/` là một **Bounded Context tự chủ độc lập** (tự quản lý Entity, DTO, Repository, Service, Controller, Events).
   - Thiết kế chuẩn mực để khi cần, có thể tách bất kỳ module nào thành **Microservice độc lập trong 5 phút** mà **KHÔNG CẦN VIẾT LẠI LOGIC NGHIỆP VỤ**.
3. **Multi-Runtime Ready**:
   - Cùng 1 codebase Core có thể chạy ở các chế độ khác nhau: HTTP API server (`apps/api`), Background Worker (`apps/worker`), Cron Scheduler (`apps/scheduler`), hoặc CLI command (`apps/cli`).

---

## 2. CẤU TRÚC THƯ MỤC DỰ ÁN (DIRECTORY TREE)

Cây dưới đây là **danh mục đầy đủ các thư mục con được phép dùng** trong `backend/src/` (chỉ vẽ thư mục, KHÔNG vẽ file). Đây là bảng từ vựng chuẩn cho AI: khi cần tạo thư mục, **phải dùng đúng tên có trong cây này**, không tự đặt tên khác.

> - Không bắt buộc tạo sẵn hết mọi thư mục cho mọi module/app/package. Chỉ tạo thư mục nào **thực sự có nội dung** để đặt vào — xem lưu ý ở 3.3. Cây này là để tra "khi cần X thì thư mục đúng tên là gì", không phải khung phải tạo sẵn 100%.
> - Mỗi `apps/<runtime>/` có riêng 1 file `main.ts` ở gốc — 4 runtime (`api`, `worker`, `scheduler`, `cli`) là 4 entrypoint **độc lập hoàn toàn**, không dùng chung 1 `main.ts` như trước.
> - Mỗi `apps/<runtime>/` có 1 file `<runtime>.module.ts` ở gốc; mỗi `packages/<ten>/` có 1 file `<ten>.module.ts` ở gốc; mỗi `modules/<module-name>/` (và `project-modules/<module-name>/`) có 1 file `<module-name>.module.ts` cùng 1 file `module.manifest.json` ở gốc khai báo metadata, dependencies và database tables.
> - Tại gốc `backend/` có file `project.manifest.json` quản lý toàn bộ phiên bản dự án, phiên bản Core framework và danh sách các module đang được kích hoạt (`enabledModules`).

```text
core/
├── .agents/                     # Quy tắc, skill & hướng dẫn cho AI Agent (không build/deploy)
│   ├── rules/                    # Luật bất biến, nạp tự động vào ngữ cảnh AI
│   ├── skills/                    # Kỹ năng chuyên môn, chỉ nạp khi task cần
│   ├── guide/                     # Prompt phân tích/implement/review theo BE - FE - Fullstack
│   └── task/                      # Hồ sơ phân tích chi tiết theo từng task đã thực hiện
│
├── backend/                     # Ứng dụng Backend chính (NestJS + Fastify)
│   ├── src/
│   │   ├── apps/                  # Entrypoint theo runtime — mỗi runtime tách biệt hoàn toàn, xem 3.1
│   │   │   ├── api/                 # HTTP API Gateway
│   │   │   │   ├── bootstrap/         # Từng bước khởi tạo app, 1 file = 1 bước (swagger, global pipe, filter, interceptor, security...)
│   │   │   │   └── runtime/           # RuntimeContributor của runtime (metric riêng + hook pause/resume/drain) gửi về packages/runtime
│   │   │   │
│   │   │   ├── worker/              # Message Queue Consumer & Background Processors (BullMQ)
│   │   │   │   ├── bootstrap/         # Từng bước khởi tạo worker (logging, graceful shutdown...)
│   │   │   │   ├── runtime/           # RuntimeContributor của worker
│   │   │   │   └── processors/        # Logic xử lý job theo domain (@Processor BullMQ), nhóm theo domain nghiệp vụ
│   │   │   │       ├── system/
│   │   │   │       ├── notification/
│   │   │   │       ├── report/
│   │   │   │       └── user/
│   │   │   │
│   │   │   ├── scheduler/           # Scheduled Tasks Runner (BullMQ Job Schedulers)
│   │   │   │   ├── bootstrap/         # Từng bước khởi tạo scheduler (graceful shutdown...)
│   │   │   │   ├── registry/          # ScheduledTaskRegistry — khai báo task; bootstrap/sync-schedules đồng bộ vào BullMQ (upsert/removeJobScheduler)
│   │   │   │   ├── runtime/           # RuntimeContributor của scheduler
│   │   │   │   └── tasks/             # Tác vụ định kỳ (định nghĩa lịch cron/interval), nhóm theo domain nghiệp vụ
│   │   │   │       ├── user/
│   │   │   │       ├── notification/
│   │   │   │       └── system/
│   │   │   │
│   │   │   └── cli/                 # Command Line Tool
│   │   │       ├── bootstrap/         # Khởi tạo CLI context
│   │   │       ├── dispatcher/        # Engine điều phối định tuyến lệnh & in bảng help
│   │   │       ├── services/          # Services hỗ trợ (manifest, scaffolder, architecture linter)
│   │   │       └── commands/          # Lệnh CLI, nhóm theo domain nghiệp vụ
│   │   │           ├── system/          # queue:publish, runtime:status
│   │   │           ├── module/          # module:create, module:add, module:list
│   │   │           ├── health/          # doctor / core:health
│   │   │           ├── database/        # migration:check [--run]
│   │   │           └── architecture/    # arch:check
│   │   │
│   │   ├── packages/              # Core hạ tầng, domain-agnostic — xem 3.2
│   │   │   ├── kernel/              # Base class & contract thuần — KHÔNG phụ thuộc package nào khác
│   │   │   │   ├── base/
│   │   │   │   ├── contracts/
│   │   │   │   ├── errors/
│   │   │   │   └── types/
│   │   │   │
│   │   │   ├── config/              # Cấu hình tinh gọn chuẩn (CoreConfigService + ConfigInspectorService audit cấu hình)
│   │   │   │
│   │   │   ├── http/                # Tầng HTTP/Fastify dùng chung (inbound)
│   │   │   │   ├── contracts/
│   │   │   │   ├── filters/
│   │   │   │   ├── interceptors/
│   │   │   │   ├── decorators/
│   │   │   │   ├── exceptions/
│   │   │   │   └── utils/
│   │   │   │
│   │   │   ├── redis/               # Kết nối Redis dùng chung (RedisService + RedisManageableAdapter)
│   │   │   │
│   │   │   ├── database/            # Kết nối & transaction database (TypeORM + slow query log sang Pino)
│   │   │   │   ├── constants/
│   │   │   │   ├── contracts/
│   │   │   │   ├── config/
│   │   │   │   ├── providers/
│   │   │   │   ├── monitoring/          # Provider giám sát theo engine (mysql, postgres, basic qua performance_schema/stat)
│   │   │   │   ├── operations/          # Thao tác quản trị gọi từ Console
│   │   │   │   ├── transaction/
│   │   │   │   └── utils/               # Phân loại lỗi DB, pool stats, chuẩn hóa SQL
│   │   │   │
│   │   │   ├── logging/             # Structured logging (Pino + Redis Stream transport MAXLEN 50.000)
│   │   │   │   ├── constants/
│   │   │   │   ├── contracts/
│   │   │   │   ├── context/
│   │   │   │   ├── middleware/
│   │   │   │   ├── interceptors/
│   │   │   │   ├── providers/
│   │   │   │   ├── serializers/
│   │   │   │   ├── redaction/
│   │   │   │   └── utils/
│   │   │   │
│   │   │   ├── metrics/             # Prometheus metrics (prom-client registry, hook Fastify onResponse cho HTTP, PrometheusQueryClient PromQL)
│   │   │   │   ├── contracts/
│   │   │   │   ├── providers/
│   │   │   │   └── utils/               # round / changePercent dùng chung cho số đo
│   │   │   │
│   │   │   ├── runtime/             # Runtime agent: heartbeat (TTL ≥ 30s), ResourceSampler (CPU, event loop, GC, cgroup), lệnh pause/resume
│   │   │   │   ├── constants/
│   │   │   │   ├── contracts/
│   │   │   │   └── providers/
│   │   │   │
│   │   │   ├── security/            # Auth hạ tầng dùng toàn hệ thống (SecretRegistryService, TokenService, Guard, SecretProvider)
│   │   │   │   ├── constants/
│   │   │   │   ├── contracts/
│   │   │   │   ├── guards/
│   │   │   │   ├── decorators/
│   │   │   │   ├── strategies/
│   │   │   │   ├── providers/
│   │   │   │   └── types/
│   │   │   │
│   │   │   ├── queue/               # Queue & Job BullMQ (provider, monitoring, operations, key Redis của scheduler)
│   │   │   │   ├── constants/
│   │   │   │   ├── contracts/
│   │   │   │   ├── providers/
│   │   │   │   ├── monitoring/
│   │   │   │   ├── operations/
│   │   │   │   └── utils/
│   │   │   │
│   │   │   ├── messaging/           # Message broker infra — publish message dùng chung + prom-client counters
│   │   │   │   ├── contracts/
│   │   │   │   ├── constants/
│   │   │   │   ├── config/
│   │   │   │   ├── providers/
│   │   │   │   ├── monitoring/
│   │   │   │   ├── operations/
│   │   │   │   ├── serializers/
│   │   │   │   └── utils/
│   │   │   │
│   │   │   ├── cache/                # Cache abstraction (driver memory/redis, monitoring SCAN/INFO, operations)
│   │   │   │   ├── constants/
│   │   │   │   ├── contracts/
│   │   │   │   ├── config/
│   │   │   │   ├── drivers/
│   │   │   │   ├── providers/
│   │   │   │   ├── monitoring/
│   │   │   │   ├── operations/
│   │   │   │   └── utils/
│   │   │   │
│   │   │   ├── storage/              # Object storage abstraction (driver local/S3/MinIO, monitoring list/head, operations)
│   │   │   │   ├── constants/
│   │   │   │   ├── contracts/
│   │   │   │   ├── config/
│   │   │   │   ├── drivers/
│   │   │   │   ├── providers/
│   │   │   │   ├── monitoring/
│   │   │   │   ├── operations/
│   │   │   │   └── utils/
│   │   │   │
│   │   │   ├── http-client/          # Gọi HTTP ra 3rd-party (outbound)
│   │   │   │   ├── contracts/
│   │   │   │   ├── config/
│   │   │   │   ├── providers/
│   │   │   │   └── interceptors/
│   │   │   │
│   │   │   └── i18n/                 # Bản địa hóa hạ tầng
│   │   │       ├── context/
│   │   │       ├── contracts/
│   │   │       ├── middleware/
│   │   │       ├── resolvers/
│   │   │       ├── formatters/
│   │   │       ├── providers/
│   │   │       └── locales/
│   │   │           ├── vi/
│   │   │           └── en/
│   │   │
│   │   ├── modules/               # Module nghiệp vụ dùng chung — mỗi module = 1 Bounded Context
│   │   │   ├── health/              # Healthcheck @nestjs/terminus (GET /health: database, Redis, heap)
│   │   │   ├── organizations/       # Cây đơn vị tổ chức, phòng ban, chi nhánh (organization_units)
│   │   │   ├── roles/               # Vai trò, quyền hạn RBAC, Data Scope & Audit Log (roles, permissions)
│   │   │   ├── users/               # Quản lý người dùng, đa vai trò, đa đơn vị, Import/Export CSV/XLSX
│   │   │   ├── auth/                # Đăng nhập JWT, Sessions, MFA (TOTP/Email OTP/Recovery), Security Settings, Service Accounts
│   │   │   ├── codes/               # Từ điển danh mục động & Hybrid Enum (code_types, code_values)
│   │   │   ├── settings/            # Cấu hình hệ thống động (5.1) & Bật tắt tính năng Feature Flags (5.2) (setting_groups, system_settings, feature_flags...)
│   │   │   ├── system-ops/          # Overview, packages, secrets, configuration của System Console (/api/v1/ops/*)
│   │   │   │   ├── controllers/
│   │   │   │   ├── services/
│   │   │   │   ├── responses/
│   │   │   │   └── routes/
│   │   │   ├── runtimes/ · traffic/ · performance/   # Module vận hành từng khu vực Console (xem 13.4)
│   │   │   ├── database-ops/ · cache-ops/ · storage-ops/ · messaging-ops/
│   │   │   ├── worker-ops/ · scheduler-ops/ · jobs-ops/ · logs-ops/
│   │   │   └── <module-name>/       # Cấu trúc chuẩn của 1 module nghiệp vụ:
│   │   │       ├── entities/          # (hoặc models/)
│   │   │       ├── enums/
│   │   │       ├── interfaces/
│   │   │       ├── requests/
│   │   │       ├── responses/
│   │   │       ├── repositories/
│   │   │       ├── services/
│   │   │       ├── import/            # Xử lý nhập dữ liệu hàng loạt (Excel .xlsx / CSV parser & importer)
│   │   │       ├── export/            # Xử lý xuất dữ liệu & file mẫu (Excel .xlsx / CSV formatter & exporter)
│   │   │       ├── controllers/
│   │   │       ├── routes/
│   │   │       ├── exceptions/
│   │   │       ├── middlewares/
│   │   │       ├── guards/
│   │   │       ├── decorators/
│   │   │       ├── events/
│   │   │       ├── listeners/
│   │   │       ├── mappers/
│   │   │       └── locales/
│   │   │           ├── vi/
│   │   │           └── en/
│   │   │
│   │   └── project-modules/       # Module nghiệp vụ riêng của dự án cắm vào Core
│   │
│   ├── test/                      # Toàn bộ kiểm thử hệ thống — CẤM TUYỆT ĐỐI để test trong src/
│   │   ├── fixtures/              # Dữ liệu mẫu, env mock phục vụ test
│   │   ├── concerns/              # Helpers/Traits khởi tạo môi trường test Fastify
│   │   ├── unit/                  # Unit tests cô lập (config, services, utils)
│   │   ├── feature/               # Feature / API tests (feature/api/...)
│   │   └── README.md              # Hướng dẫn chi tiết quy chuẩn test
│   ├── project.manifest.json      # Quản lý metadata dự án & enabledModules
│   └── package.json, tsconfig.json, .env*   # Scripts, cấu hình build, biến môi trường
│
├── frontend/                    # Ứng dụng Frontend mẫu & System Console (React 19 + Vite)
├── pnpm-workspace.yaml           # Cấu hình monorepo workspace
└── package.json                    # Root package quản lý scripts & git hooks
```

---

## 3. MỤC ĐÍCH & TRÁCH NHIỆM CỦA TỪNG THƯ MỤC

### 3.1. Thư mục Runtimes (`apps/`)
Mỗi runtime có `main.ts` + `<runtime>.module.ts` riêng ở gốc — 4 runtime độc lập hoàn toàn với nhau, không dùng chung entrypoint.
- **`apps/api/`**: Khởi tạo máy chủ HTTP Fastify. `bootstrap/` chứa từng bước khởi tạo riêng biệt (setup swagger, global pipe, global filter, interceptor, security...) — mỗi bước 1 file, không dồn hết vào 1 file bootstrap. Expose `/metrics` cho Prometheus scraper.
- **`apps/worker/`**: Xử lý Message Queue & Background Jobs qua BullMQ. `bootstrap/` khởi tạo worker (logging, graceful shutdown). `processors/<domain>/` chứa các processor `@Processor` của BullMQ xử lý job theo domain nghiệp vụ (vd `system/`, `notification/`, `report/`, `user/`). Expose port metrics `:9101/metrics`.
- **`apps/scheduler/`**: Quản lý tác vụ định kỳ bằng BullMQ Job Schedulers (KHÔNG dùng `@nestjs/schedule`/`@Cron` chạy in-memory). `registry/` chứa `ScheduledTaskRegistry`; `tasks/<domain>/` khai báo task; `bootstrap/sync-schedules.ts` (`ScheduleSyncService`) gọi `upsertJobScheduler` cho task đang bật và `removeJobScheduler` cho task bị tắt/xoá khi khởi động. Logic chạy ở `apps/worker/processors/<domain>/`. Expose port metrics `:9102/metrics`.
- **`apps/<runtime>/runtime/`**: Mỗi runtime (api/worker/scheduler) có 1 `*-runtime.contributor.ts` implement `RuntimeContributor` (`packages/runtime/contracts/`) — cung cấp metric riêng và hook điều khiển (pause/resume/drain) cho `RuntimeAgentService`, để trang Runtimes trên Console hiển thị và điều khiển.
- **`apps/cli/`**: Thực thi lệnh dòng lệnh (`npm run cli -- <command>`). `bootstrap/cli.bootstrap.ts` khởi tạo CLI context và timeout. Bao gồm:
  - `dispatcher/cli-dispatcher.service.ts`: Engine điều phối lệnh CLI, routing tự động theo tên command, hiển thị help menu có nhóm domain, cờ `--help`, tính toán thời gian thực thi.
  - `services/`:
    - `manifest.service.ts`: Phát hiện module tự động trong `modules/` và `project-modules/`, đọc, ghi và xác thực `module.manifest.json` và `project.manifest.json` theo Zod schema.
    - `module-scaffolder.service.ts`: Scaffolding generator sinh cấu trúc 11 file chuẩn của module độc lập theo AGENTS.md.
    - `architecture-linter.service.ts`: Static analyzer kiểm tra 4 quy tắc kiến trúc (Cross-Module Isolation, Packages Purity, No test in `src/`, Circular Dependencies).
  - `commands/<domain>/`: Các lệnh CLI theo domain nghiệp vụ:
    - `module/`: `module:create <name>` (tạo module mới), `module:add <name>` (kích hoạt module vào dự án), `module:list` (liệt kê module và trạng thái).
    - `health/`: `doctor` hoặc `core:health` (kiểm tra toàn diện môi trường Node, DB, Redis, manifests).
    - `database/`: `migration:check` (kiểm tra migration TypeORM pending, `--run` để thực thi).
    - `architecture/`: `arch:check` (rà soát vi phạm ranh giới kiến trúc).
    - `system/`: `queue:publish`, `runtime:status`.

### 3.2. Thư mục Core Hạ Tầng (`packages/`)
- **`packages/kernel/`**: Base class & contract thuần (`base/`, `contracts/`, `errors/`, `types/`) — tầng thấp nhất, KHÔNG phụ thuộc package nào khác, KHÔNG chứa gì liên quan HTTP hay Database cụ thể.
- **`packages/config/`**: Cấu hình tinh gọn đọc biến môi trường qua `env()` với cơ chế Fail-Fast, cấu hình theo file phẳng `<domain>.config.ts`. Cung cấp `CoreConfigService` và `ConfigInspectorService` (cho phép Console duyệt cấu hình domain và tự động che dấu trường nhạy cảm `••••••••`).
- **`packages/http/`**: Tầng HTTP/Fastify dùng chung — Global Exception Filter (`filters/`), Response Interceptor (`interceptors/`), decorator & exception class dùng chung (`decorators/`, `exceptions/`).
- **`packages/redis/`**: `RedisService` — kết nối Redis dùng chung duy nhất (file phẳng). Mọi package cần Redis inject service này. Cung cấp `RedisManageableAdapter` cho Console giám sát INFO/memory/clients/keyspace.
- **`packages/database/`**: Kết nối DB (`config/`), base repository/provider theo DB engine (`providers/`), quản lý transaction / unit-of-work (`transaction/`). Giám sát pool connection và slow query logger gửi trực tiếp sang Pino.
- **`packages/logging/`**: Structured logging hiệu năng cao dựa trên **Pino** & `pino-http` — tự động lưu log có cấu trúc vào Redis Stream (`MAXLEN ~50.000`) phục vụ lọc và xem thời gian thực trên Console, tự động che dữ liệu nhạy cảm (`redaction/`).
- **`packages/metrics/`**: Prometheus metrics qua `prom-client` — registry riêng mỗi runtime (nhãn `runtime`, default node/process metrics), `HttpMetricsHook` ghi `http_request_duration_seconds` ở hook Fastify `onResponse` (đếm cả 404/400/guard), `MetricsRegistryService.counter/gauge/histogram` cho package khác, và `PrometheusQueryClient` (`query`/`range`/`safe*`, có `offsetSec`) để Console đọc lại bằng PromQL. Tên metric thống nhất ở 3.4.1.
- **`packages/runtime/`**: `RuntimeAgentService` (heartbeat Redis TTL ≥ 30s, sự kiện vòng đời, lệnh pause/resume qua pub/sub) + `ResourceSampler` (CPU% theo delta `process.cpuUsage()`, `monitorEventLoopDelay`, GC qua `PerformanceObserver`, giới hạn RAM cgroup v2/v1 — không có cgroup thì so heap với giới hạn V8). Định nghĩa contract `RuntimeContributor` và token `RUNTIME_IDENTITY`. Restart/stop do Docker quản lý.
- **`packages/security/`**: JWT, Token hashing (`providers/`), Auth Guard toàn hệ thống (`guards/`), Decorator (`decorators/`), Strategy (`strategies/`), Secret provider env/file. Cung cấp `SecretRegistryService` kiểm kê danh sách secret key và nguồn cấu hình (không bao giờ lộ giá trị).
- **`packages/queue/`**: Hạ tầng BullMQ Job/Queue abstraction — quản lý queue, job lifecycle (retry, clean, remove, promote), key Redis của scheduler (`schedulerKeys`: định nghĩa task, set disabled).
- **`packages/messaging/`**: Hạ tầng publish message dùng chung (kết nối broker, đăng ký queue, serialize envelope, đếm `messages_published_total`). Chỗ buộc phải tự `queue.add` (Run Now cần `jobId` riêng) gọi `BaseMessagePublisherProvider.recordPublished()`. Lỗi consume = job failed / chờ retry của BullMQ (`MessagingMonitoringService.failures()`), không tự lưu.
- **`packages/cache/`**: Abstraction cache với driver `memory`/`redis` (`drivers/`), giám sát keyspace/namespace qua Redis SCAN/INFO (`monitoring/`), thao tác quản trị flush namespace (`operations/`).
- **`packages/storage/`**: Abstraction Object Storage với driver `local`/`s3` (S3, MinIO) trong `drivers/`, giám sát dung lượng (`monitoring/`), thao tác object (`operations/`).
- **`packages/http-client/`**: Gọi HTTP ra ngoài tới API bên thứ 3 (outbound).
- **`packages/i18n/`**: Locale resolver (đọc `Accept-Language`), middleware + context locale theo request, formatter ngày/giờ/số theo vùng (`resolvers/`, `formatters/`), và bản dịch dùng chung không thuộc nghiệp vụ module nào (`locales/vi/`, `locales/en/`...).

#### 3.2.1. Khung thư mục chuẩn của package hạ tầng có giám sát
Các package `database`, `cache`, `storage`, `queue`, `messaging` đã thống nhất cùng một khung — package hạ tầng mới cần giám sát trên Console phải theo đúng khung này:

| Thư mục | Vai trò |
| :--- | :--- |
| `constants/` | Token DI + `*.keys.ts` (tên key Redis cho metric/event/lệnh) |
| `contracts/` | Interface public + `*-events.types.ts` |
| `drivers/` | Implement theo backend (`<name>.driver.ts` + interface `*-driver.ts`) — chỉ khi có nhiều backend |
| `providers/` | `*-connection.service.ts` (vòng đời kết nối), provider chính, `*-manageable.adapter.ts` (implement `ManageablePackage`) |
| `monitoring/` | `*-monitoring.service.ts` + provider giám sát theo backend — chỉ đọc, không thay đổi dữ liệu |
| `operations/` | `*-operations.service.ts` — thao tác quản trị gọi từ Console (có thể thay đổi dữ liệu) |
| `utils/` | `*-errors.ts` (phân loại lỗi), helper chuẩn hóa, pool stats |

### 3.3. Thư mục Module Nghiệp Vụ (`modules/<module-name>/`)
Mỗi thư mục con trong `modules/` là một **Bounded Context** độc lập, tự quản lý entity, request/response DTO, repository, service, controller, event, và cả bản dịch ngôn ngữ của riêng nó — xem cây đầy đủ ở Mục 2.

- `entities/` (hoặc `models/`): chọn đúng 1 tên và dùng nhất quán cho **toàn bộ modules** trong dự án, không trộn 2 tên khác nhau.
- `requests/` / `responses/`: thay cho `dtos/` cũ — tách rõ DTO đầu vào và đầu ra.
- `middlewares/`: middleware riêng của module (khác middleware toàn hệ thống ở `packages/logging/middleware`).
- `routes/`: file `<module>.routes.ts` export hằng `X_ROUTES = { PREFIX, ..., buildXPath() }`. Controller dùng `@Controller(X_ROUTES.PREFIX)`; test/feature dùng các hàm build path — KHÔNG hardcode chuỗi path rải rác.
- `exceptions/`: exception riêng của module, extends `AppException` (`@packages/kernel`), mang `code` + message key i18n (vd `storage.error.notConnected`).

> **Không tạo sẵn đủ bộ thư mục con cho mọi module.** Chỉ tạo thư mục nào module thực sự có file để đặt vào, và phải đặt đúng tên đã quy ước trong cây ở Mục 2 (không tự chế tên khác). Ví dụ module `health` chỉ cần controller + module, chưa cần `entities/`, `requests/`, `locales/`... vì chưa dùng.

#### 3.3.1. Quy chuẩn Manifests (`module.manifest.json` & `project.manifest.json`)
Hệ thống sử dụng cơ chế khai báo Manifest dạng JSON để quản lý danh tính, phân quyền, sự kiện và sự phụ thuộc giữa các module độc lập:

1. **`module.manifest.json` (Manifest cấp Module)**:
   - Bắt buộc phải có trong mỗi module tại `modules/<tên-module>/module.manifest.json` hoặc `project-modules/<tên-module>/module.manifest.json` (tham khảo mẫu chuẩn: [module.manifest.json](file:///home/thanhhai/myProjects/CoreProjects/core/backend/src/modules/health/module.manifest.json)).
   - Định nghĩa hợp đồng tự trị của module:
     - `name`: Tên định danh module (kebab-case, ví dụ `health`, `system-ops`, `order`).
     - `displayName` & `version`: Tên hiển thị thân thiện và phiên bản SemVer của module.
     - `type`: `core` (module hạ tầng dùng chung) hoặc `project` (module nghiệp vụ riêng của dự án).
     - `description`: Mô tả vai trò và chức năng của module.
     - `dependencies`: Danh sách tên các module Core khác mà module này phụ thuộc (phải kích hoạt trước).
     - `permissions`: Danh sách mã quyền do module định nghĩa/yêu cầu (ví dụ: `["health:read"]`).
     - `events`: Danh sách Domain Events mà module phát ra (`publishes`) hoặc lắng nghe (`subscribes`).
     - `database`: Khai báo thực thể TypeORM và migration nếu module sở hữu bảng riêng (`entities`, `migrations`, `seeders`).
   - Xác thực: Xác thực chặt chẽ lúc runtime bằng Zod schema [manifest.schema.ts](file:///home/thanhhai/myProjects/CoreProjects/core/backend/src/packages/kernel/schemas/manifest.schema.ts) và có JSON Schema [module.manifest.schema.json](file:///home/thanhhai/myProjects/CoreProjects/core/backend/src/packages/kernel/schemas/module.manifest.schema.json) để IDE gợi ý tự động (Intellisense).
   - Vai trò Microservices-Ready: Đảm bảo module là một Bounded Context tự chứa đầy đủ metadata, giúp việc trích xuất thành Microservice độc lập diễn ra tức thì trong 5 phút mà không thất thoát định nghĩa phân quyền, event hay dependency.

2. **`project.manifest.json` (Manifest cấp Dự án)**:
   - Đặt tại thư mục gốc backend: [backend/project.manifest.json](file:///home/thanhhai/myProjects/CoreProjects/core/backend/project.manifest.json).
   - Xác thực bằng Zod schema và JSON Schema [project.manifest.schema.json](file:///home/thanhhai/myProjects/CoreProjects/core/backend/src/packages/kernel/schemas/project.manifest.schema.json).
   - Quản lý danh sách các module đang được kích hoạt nạp vào hệ thống (`enabledModules`), phiên bản dự án (`version`), phiên bản Core tương thích (`coreVersion`), và cài đặt toàn cục (`settings`).
   - Lệnh CLI `module:add <name>` sẽ tự động kiểm tra sự tồn tại và tính hợp lệ của module trước khi kích hoạt vào mảng `enabledModules`.

### 3.4. Bảng Đối Chiếu Package → Thư Viện Chuẩn (Battle-tested Libraries)
Nhằm giữ Core tinh gọn (Lean Core) và dễ bảo trì, mọi hạ tầng giám sát và cross-cutting concerns đều tận dụng trực tiếp các thư viện chuẩn nguồn mở đã được kiểm chứng qua sản xuất:

| Khối Chức Năng | Package / Module Core | Thư Viện / Tiêu Chuẩn Nền Tảng | Vai Trò & Nguồn Dữ Liệu |
| :--- | :--- | :--- | :--- |
| **HTTP Metrics & PromQL** | `packages/metrics` | `prom-client` + Prometheus Server | HTTP duration histogram ghi ở hook Fastify `onResponse`, metric của từng package (bảng 3.4.1). `PrometheusQueryClient` là nguồn lịch sử/biểu đồ duy nhất — không tự lưu time-series. |
| **Structured Logging** | `packages/logging` | `pino`, `pino-http`, `nestjs-pino`, Redis Stream | Log JSON hiệu năng cao, đẩy stream Redis (`MAXLEN ~50.000`) để Console xem realtime, che dữ liệu nhạy cảm qua redaction. |
| **Queue, Jobs & Scheduler**| `packages/queue`, `apps/worker`, `apps/scheduler` | `bullmq`, `@nestjs/bullmq` | Queue job lifecycle, retry, pause/resume, promote. Job scheduler định kỳ (thay thế `@Cron`). Worker processors `@Processor`. |
| **Publish Messaging** | `packages/messaging` | `bullmq` / Redis pub/sub | Thin publisher kết hợp prom-client counters (`messages_published_total`). |
| **Database & Pool** | `packages/database` | `typeorm`, MySQL/Postgres drivers | Quản lý kết nối, transaction. Giám sát pool connection và slow query logger gửi trực tiếp sang Pino. |
| **Cache Driver & Keyspace**| `packages/cache`, `packages/redis` | `ioredis` | Driver Redis/Memory, giám sát qua `INFO`, `SCAN`, `MEMORY USAGE`. `RedisManageableAdapter` cho Console. |
| **Object Storage** | `packages/storage` | `@aws-sdk/client-s3`, Local FS | Driver S3/MinIO/Local, giám sát qua `ListObjectsV2`/`HeadBucket`. |
| **System Health** | `modules/health` | `@nestjs/terminus` | Health check endpoint `GET /health` kiểm tra Database, Redis, Heap memory. |
| **Governance: Secrets** | `packages/security` | `SecretRegistryService` | Liệt kê định danh secret key và driver (env/file). Tuyệt đối không để lộ giá trị secret. |
| **Governance: Config** | `packages/config` | `ConfigInspectorService` | Duyệt cấu hình domain đang nạp qua `CoreConfigService`, tự động che các giá trị nhạy cảm `••••••••`. |
| **System Operations Console**| `modules/system-ops` + module `*-ops` | Prometheus + Terminus + BullMQ + Redis | API của System Console dưới `/api/v1/ops/*` — `system-ops` lo overview/packages/secrets/configuration, mỗi khu vực còn lại có module riêng (13.4). |

#### 3.4.1. Tên metric Prometheus (dùng thống nhất khi ghi và khi đọc PromQL)

| Metric | Loại | Ghi ở đâu | Dùng cho |
| :--- | :--- | :--- | :--- |
| `http_request_duration_seconds{method,route,status}` | histogram | `HttpMetricsHook` (api) — `route="unmatched"` cho 404 | Traffic, Performance, Overview |
| `messages_published_total{queue,channel,result}` | counter | publisher; worker đếm job do Job Scheduler tạo ở lần nhận đầu | Messaging, Jobs, Worker |
| `messages_consumed_total{queue,channel,result}` | counter | `SystemProcessor` (worker) | Messaging, Jobs, Worker, Performance |
| `job_duration_seconds{queue,channel}`, `job_wait_seconds{queue}` | histogram | worker | Worker, Jobs, Messaging, Performance |
| `job_attempt_failures_total{queue,channel,final}`, `job_recovered_total{queue}` | counter | worker | Retry / Dead Letter (Messaging, Worker) |
| `core_queue_jobs{queue,state}` | gauge | monitor Worker & Queue (api) | Độ sâu queue, lag (Worker, Messaging, Performance) |
| `core_redis_keyspace_hits` / `_misses`, `core_redis_evicted_keys`, `core_redis_expired_keys` | gauge lũy kế từ INFO (đọc bằng `rate()`) | monitor Cache (api) | Cache, Performance |
| `core_redis_used_memory_bytes`, `core_redis_connected_clients`, `core_redis_ops_per_sec`, `core_cache_keys`, `core_cache_bytes` | gauge | monitor Cache (api) | Cache, Performance |
| `core_db_statements_total`, `core_db_statement_seconds_total`, `core_db_statement_errors_total` | counter (delta digest của DB) | monitor Database (api) | Database, Performance (`dbLatency` = trung bình) |
| `core_db_pool_connections{state}`, `core_db_sessions` | gauge | monitor Database (api) | Database, Performance (pool) |
| `process_*`, `nodejs_*` (eventloop lag p99, gc duration…) | mặc định prom-client, nhãn `runtime` | mọi runtime | Runtimes, Performance |

### 3.5. Hướng Dẫn Mở Rộng Hoặc Thêm Khu Vực Console Mới
Khi hệ thống có thêm một thành phần hạ tầng hoặc dịch vụ cần giám sát/vận hành trên System Console:
1. **Backend Adapter (nếu là Package)**:
   - Trong `packages/<package>/providers/`, tạo adapter `<package>-manageable.adapter.ts` implement `ManageablePackage` (`@packages/kernel/index.js`, file gốc `packages/kernel/contracts/manageable-package.contract.ts`).
   - Đăng ký adapter vào `PackageRegistryService` để hiển thị trong mục Governance -> Packages.
2. **Backend Ops Controller & Service (nếu có API riêng)**:
   - Tạo module `modules/<area>-ops/` (controllers, services, responses, routes) với route hằng số tiền tố `/ops/<ten-khu-vuc>`, rồi import vào `SystemOpsModule`.
   - Số liệu hiện tại đọc từ API gốc của hạ tầng; lịch sử/biểu đồ đọc Prometheus. Thiếu nguồn → `null` / "không khả dụng", **không trả 0** (PITFALL-015).
   - Bản dịch đặt cùng chỗ với các khu vực hiện có: `packages/i18n/locales/<lang>/<area>.json` (xem 17.7).
3. **Frontend API Client**:
   - Thêm phương thức gọi API trong `frontend/src/modules/system-console/services/<ten>.api.ts`.
4. **Frontend UI Section**:
   - Tạo thư mục `frontend/src/modules/system-console/sections/<ten>/` với `<Ten>Section.tsx` dựng bằng bộ UI chung `frontend/src/core/ui` (PageHeader, PageTabs ≤ 4 tab, StatTile/StatGrid, Panel, DataTable, MetricChart, AlertList, ActivityFeed, DetailSheet, ConfirmDialog, ConfigSheet…). Mẫu: `sections/logs/`, `sections/overview/`.
   - Dữ liệu: `useLiveQuery` (theo nút làm mới chung), thao tác: `useAppMutation` + `ConfirmDialog`. Route: `useSectionRoute(TABS, ALIASES)`.
   - Bắt buộc: dùng chung → `core/`; không hardcode màu (token theme), chữ (`t()`, file `core/i18n/locales/console/<ns>.{vi,en}.ts`), số (constants). Header không subtext — giải thích để trong `hint`. `npm run lint` chạy `check-hardcode`.
5. **Đăng Ký Điều Hướng (Navigation)**:
   - Thêm entry vào `frontend/src/modules/system-console/shell/sections.ts` (icon, group, component lazy, `controls: { ranges }`, `crumb`). URL dạng path: `/system-console/<ten>/<tab>`.

---

## 4. NGUYÊN TẮC THIẾT KẾ ĐỂ SẴN SÀNG CHUYỂN SANG MICROSERVICES (ZERO REFACTORING)

1. **Cô Lập Dữ Liệu Tuyệt Đối (Database Independence)**:
   - Mỗi module sở hữu bảng của riêng nó.
   - **CẤM TUYỆT ĐỐI**: Không tạo Foreign Key vật lý giữa bảng của Module A sang bảng của Module B trong Database (chỉ lưu khóa tham chiếu dưới dạng trường giá trị, ví dụ: `userId: string`).
2. **Giao Tiếp Phân Tách (Decoupled Communication)**:
   - Module A KHÔNG ĐƯỢC inject Repository hoặc truy vấn trực tiếp bảng của Module B.
   - Giao tiếp đồng bộ chỉ thông qua Public Facade/Service xuất khẩu qua file `index.ts` của module đó.
   - Ưu tiên giao tiếp bất đồng bộ qua `events/` để khi chuyển sang RabbitMQ/Kafka không cần sửa code nghiệp vụ.
3. **Thin Transport**:
   - `controllers/` chỉ đóng vai trò là adapter nhận dữ liệu. Service không phụ thuộc vào Fastify Request hay Express.
4. **Bản địa hóa Tự Trị (i18n Self-Contained)**:
   - Message dịch thuộc về nghiệp vụ của module (lỗi validate, label, nội dung email...) phải đặt trong `modules/<module>/locales/` của chính module đó, KHÔNG dồn vào một file ngôn ngữ chung toàn hệ thống.
   - `packages/i18n/locales/` chỉ chứa các chuỗi dùng chung không thuộc nghiệp vụ nào (mã lỗi HTTP chung, validation chung của kernel).
   - Nhờ vậy khi tách module thành microservice, bản dịch của module đó đi theo module, không phải trích xuất lại từ một file ngôn ngữ dùng chung.

---

## 5. BẢNG TRA CỨU VỊ TRÍ ĐẶT FILE CHO AI

Khi AI cần tạo một thành phần mới, bắt buộc phải đặt đúng vào thư mục tương ứng. Trong `modules/<module>/`, chỉ tạo thư mục con khi có file thật để đặt vào (xem lưu ý ở 3.3) — không tạo sẵn cho đủ bộ.

| Muốn tạo thành phần gì | Thư mục bắt buộc đặt vào |
| :--- | :--- |
| **Bước khởi tạo app API (swagger, global pipe/filter/interceptor, security...)** | `apps/api/bootstrap/` |
| **Logic xử lý job theo domain nghiệp vụ (Processor `@Processor` BullMQ)** | `apps/worker/processors/<domain>/` |
| **Tác vụ chạy định kỳ (đăng ký qua `ScheduledTaskRegistry` vào BullMQ)** | `apps/scheduler/tasks/<domain>/` |
| **Lệnh CLI (module, health, migration, arch, system) theo domain** | `apps/cli/commands/<domain>/` |
| **Bộ điều phối CLI & Services (dispatcher, scaffolder, manifest, arch-linter)** | `apps/cli/dispatcher/`, `apps/cli/services/` |
| **Manifest của module (`module.manifest.json`)** | `modules/<module>/module.manifest.json` hoặc `project-modules/<module>/module.manifest.json` |
| **Manifest của dự án (`project.manifest.json`)** | `backend/project.manifest.json` |
| **Schema Zod, JSON Schema & Interface của Manifests** | `packages/kernel/contracts/`, `packages/kernel/schemas/` |
| **RuntimeContributor của 1 runtime (metric + hook pause/resume/drain)** | `apps/<runtime>/runtime/` |
| **Hằng số route của module (PREFIX + build path)** | `modules/<module>/routes/` |
| **Exception riêng của module** | `modules/<module>/exceptions/` |
| **Thực thể dữ liệu (Entity / Model)** | `modules/<module>/entities/` (hoặc `models/` nếu dự án đã chọn tên này) |
| **Hằng số định danh (Enum)** | `modules/<module>/enums/` |
| **Interface / Types nội bộ module** | `modules/<module>/interfaces/` |
| **DTO đầu vào (body/query/param)** | `modules/<module>/requests/` |
| **DTO đầu ra (response shape)** | `modules/<module>/responses/` |
| **Truy vấn DB (Repository)** | `modules/<module>/repositories/` |
| **Nghiệp vụ (Service)** | `modules/<module>/services/` |
| **Nhập dữ liệu hàng loạt (Excel .xlsx / CSV Import & Parser)** | `modules/<module>/import/` |
| **Xuất dữ liệu & Template mẫu (Excel .xlsx / CSV Export & Formatter)** | `modules/<module>/export/` |
| **Routing / HTTP Handler (Controller)** | `modules/<module>/controllers/` |
| **Middleware riêng của 1 module** | `modules/<module>/middlewares/` |
| **Guard riêng của 1 module** | `modules/<module>/guards/` |
| **Decorator riêng của 1 module** | `modules/<module>/decorators/` |
| **Sự kiện nghiệp vụ module này phát ra (Domain Event)** | `modules/<module>/events/` |
| **Handler lắng nghe event từ module khác** | `modules/<module>/listeners/` |
| **Transform Entity <-> DTO** | `modules/<module>/mappers/` |
| **Bản dịch message/label thuộc nghiệp vụ của module** | `modules/<module>/locales/<locale>/` |
| **Base class / Contract / Error / Type thuần, không phụ thuộc gì** | `packages/kernel/base|contracts|errors|types/` |
| **Cấu hình domain chuẩn & audit cấu hình** | `packages/config/<domain>.config.ts`, `packages/config/config-inspector.service.ts` |
| **Filter / Interceptor / Decorator / Exception tầng HTTP dùng chung** | `packages/http/filters|interceptors|decorators|exceptions/` |
| **Kết nối DB, transaction, base repository provider, slow query logger** | `packages/database/providers|transaction|utils/` |
| **Logging structured (Pino), Redis Stream transport, redaction** | `packages/logging/interceptors|middleware|context|providers|serializers|redaction/` |
| **Prometheus metrics (prom-client, PromQL query client)** | `packages/metrics/providers|interceptors|contracts/` |
| **Guard / Decorator / Strategy / Provider auth / Secret audit** | `packages/security/guards|decorators|strategies|providers/` |
| **Publish message dùng chung & prom-client counters** | `packages/messaging/providers|constants|serializers/` |
| **Queue/Job provider BullMQ, giám sát, thao tác, Job Scheduler** | `packages/queue/providers|monitoring|operations/` |
| **Kết nối Redis dùng chung & Manageable adapter** | `packages/redis/` (`RedisService`, `redis-manageable.adapter.ts`) |
| **Runtime agent (heartbeat, resource sampler, log sink)** | `packages/runtime/providers/` |
| **Cache provider / driver (memory, Redis...)** | `packages/cache/providers|drivers/` |
| **Storage provider / driver (S3/MinIO/local)** | `packages/storage/providers|drivers/` |
| **Hạ tầng quản trị vận hành System Operations (gộp 13 module ops, phục vụ System Console)** | `modules/system-ops/controllers|services|requests|responses/` |
| **Health check hệ thống (Terminus /health)** | `modules/health/` |
| **Giám sát (chỉ đọc) của 1 package hạ tầng** | `packages/<ten>/monitoring/` |
| **Thao tác quản trị của 1 package hạ tầng (gọi từ Console)** | `packages/<ten>/operations/` |
| **Key Redis cho metric/event/lệnh của package** | `packages/<ten>/constants/<ten>.keys.ts` |
| **Gọi HTTP ra 3rd-party (outbound)** | `packages/http-client/providers|interceptors/` |
| **Locale resolver / formatter / middleware dùng chung** | `packages/i18n/resolvers|formatters|providers|middleware/` |
| **Bản dịch message chung không thuộc module nào** | `packages/i18n/locales/<locale>/` |
| **Module nghiệp vụ riêng của 1 dự án cắm vào Core (không tái sử dụng cho dự án khác)** | `project-modules/<ten-nghiep-vu>/` |
| **Test Fixtures & env mock** | `backend/test/fixtures/` |
| **Test Concerns / Helpers (Fastify app)** | `backend/test/concerns/` |
| **Unit tests cô lập** | `backend/test/unit/<domain>/` |
| **Feature / API tests** | `backend/test/feature/api/<domain>/` |

---

## 6. TECH STACK & TIÊU CHUẨN KỸ THUẬT

### 6.1. Backend
- **Node.js Runtime**: `>= 22.0.0 < 25` (ESM module chuẩn: `"type": "module"`).
- **Ngôn ngữ**: TypeScript 5.8+ ở chế độ **Strict cao nhất**:
  - `module: "NodeNext"`, `moduleResolution: "NodeNext"`.
  - Bật đầy đủ: `strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess`, `noImplicitOverride`.
- **Framework Backend**: NestJS 11 kết hợp **Fastify Adapter** (`@nestjs/platform-fastify`) nhằm tối đa hóa hiệu năng I/O.
- **ORM**: TypeORM 1.x với `autoLoadEntities: true`, hỗ trợ đa DB driver: `mysql` | `postgres` | `mssql` | `sqlite`.
- **Validation & Configuration**: `Zod` (v4) kiểm tra kiểu dữ liệu tĩnh và runtime an toàn.
- **Build Tool**: `tsc` + `tsc-alias` (để resolve path aliases sau khi biên dịch).
- **Git Hooks & Chuẩn Commit**: Husky + Commitlint (`@commitlint/config-conventional`) + Lint-Staged.

### 6.2. Frontend
- **Framework**: React 19 + Vite 8.
- **Ngôn ngữ**: TypeScript ~6.0 (strict).
- **Linter**: oxlint (nhanh hơn ESLint).
- **Port mặc định**: `5175` (tránh trùng với Vite default `5173`).
- **Biến env**: Dùng `VITE_` prefix; đọc qua `import.meta.env['VITE_API_BASE_URL']`.

### 6.3. Hạ tầng & Containerization
- **Container Runtime**: Docker + Docker Compose v2.
- **Reverse Proxy (Production)**: Nginx.
- **SSL/TLS**: Let's Encrypt + Certbot (tự động gia hạn mỗi 12h).
- **Package Manager**: npm (từng workspace); pnpm workspace ở root để quản lý monorepo.
- **Monorepo Structure**: `pnpm-workspace.yaml` khai báo 3 workspace: `backend`, `frontend`, `backend/src/packages/*`.

---

## 7. QUY TẮC CODE CHUẨN (CODING CONVENTIONS)

### 7.1. Import & Path Aliases (TypeScript ESM NodeNext)
Backend sử dụng path alias định nghĩa trong `tsconfig.json`:
```typescript
import { CoreConfigService } from '@packages/config/index.js';
import { BaseEntity } from '@packages/kernel/index.js';
import { ApiModule } from '@apps/api/api.module.js';
import { HealthModule } from '@modules/health/index.js';
```
> **LƯU Ý CỰC KỲ QUAN TRỌNG VỀ ESM**: Khi import relative nội bộ, **BẮT BUỘC** phải có đuôi `.js`:
> ```typescript
> // ĐÚNG
> import { AppService } from './app.service.js';
> // SAI (Sẽ lỗi TS2835 khi biên dịch hoặc Node.js ESM crash lúc runtime)
> import { AppService } from './app.service';
> ```

### 7.2. Chuẩn hoá Response & Error Envelope
Tất cả các API trả về cho Client được chuẩn hoá tự động qua Interceptor và Filter:
- **Thành công**:
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": { ... },
    "meta": { "page": 1, "limit": 10, "total": 100 },
    "timestamp": "2026-09-20T10:00:00.000Z"
  }
  ```
- **Thất bại**:
  ```json
  {
    "success": false,
    "statusCode": 404,
    "error": {
      "code": "RESOURCE_NOT_FOUND",
      "message": "Không tìm thấy dữ liệu yêu cầu",
      "details": []
    },
    "timestamp": "2026-09-20T10:00:00.000Z"
  }
  ```

### 7.3. Đọc Config an toàn (Không dùng `process.env` trực tiếp & Không Overthinking)
- KHÔNG BAO GIỜ đọc trực tiếp `process.env.MY_VAR` trong Service hoặc Controller.
- BẮT BUỘC định nghĩa file cấu hình domain trong `@packages/config/<domain>.config.ts` qua `env()` và inject `CoreConfigService`.
- Giữ cấu hình tinh gọn (KISS): Không thêm kiểm tra range/format vô cớ, dùng các biến chuẩn cơ bản (`DB_HOST`, `DB_PORT`... thay vì ép dùng URL).

### 7.4. Fastify Compatibility
- Dùng Fastify, KHÔNG dùng API của Express như `res.send()`, `res.status()`.
- Inject `@Req() req: FastifyRequest`, `@Res() reply: FastifyReply` khi cần thiết.

---

## 8. CÁC LỆNH VẬN HÀNH DỰ ÁN

| Mục đích | Lệnh chạy tại Root | Lệnh chạy trong `backend/` |
| :--- | :--- | :--- |
| Chạy Development | `npm run dev` | `npm run dev` |
| Chạy từng runtime (dev) | `npm run dev:api` / `dev:worker` / `dev:scheduler` | `npm run dev:api` / `dev:worker` / `dev:scheduler` |
| Chạy Frontend (dev) | `npm run dev:fe` | N/A |
| Biên dịch Build | `npm run build` (FE: `npm run build:fe`) | `npm run build` |
| Chạy Production | `npm start` | `npm run start:api` / `start:worker` / `start:scheduler` |
| Kiểm tra toàn bộ (Lint + Typecheck + Test + Build) | `npm run check` | `npm run check` |
| Test unit / feature | `npm test` | `npm run test:unit` / `npm run test:feature` |
| Kiểm tra Typecheck | N/A | `npm run typecheck` |
| Format mã nguồn | N/A | `npm run format` |

> Theo Global Rules, khi chạy trong môi trường dev Docker phải bọc lệnh qua `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T backend <lệnh> < /dev/null`, và test phải chạy trên DB test riêng.

---

## 9. SỔ TAY BÀI HỌC KINH NGHIỆM & CÁC LỖI CẤM KỴ (LESSONS LEARNED & KNOWN PITFALLS)

Mọi AI Assistant và Lập trình viên **BẮT BUỘC ĐỌC** trước khi viết mã nguồn và **BẮT BUỘC CẬP NHẬT** sau khi sửa bất kỳ lỗi phát sinh mới nào để ngăn chặn vĩnh viễn việc tái diễn lỗi.

### 🛑 Nguyên tắc vàng
1. **Không lặp lại lỗi đã được ghi nhận**: Đã ghi nhận trong tài liệu này mà tái phạm = vi phạm nghiêm trọng.
2. **Quy trình ghi nhận lỗi mới**: Gặp lỗi mới -> Tìm ra Root Cause -> Thêm ngay vào cuối mục này theo mẫu chuẩn.

---

### 📋 Mẫu ghi nhận lỗi mới (Template)
```markdown
### [PITFALL-XXX] Tiêu đề ngắn gọn về lỗi
- **Hiện tượng**: Thông báo lỗi hoặc hành vi sai lệch thực tế.
- **Nguyên nhân gốc rễ (Root Cause)**: Tại sao lỗi này xảy ra?
- **Giải pháp chuẩn (Correct Solution)**: Cách viết hoặc cấu hình đúng.
- **Điều cấm tuyệt đối (Never Do)**: Điều không bao giờ được làm.
```

---

### 📚 Danh mục bài học kinh nghiệm đã được đúc kết

#### [PITFALL-001] Thiếu phần mở rộng `.js` trong relative import của TypeScript ESM
- **Hiện tượng**: Lỗi khi biên dịch `tsc` hoặc khi chạy Node.js: `Cannot find module './some-file' or its corresponding type declarations. TS2835: Did you mean to import './some-file.js'?`
- **Nguyên nhân gốc rễ**: Dự án dùng `"module": "NodeNext"`. Node.js ESM bắt buộc relative import phải có đuôi `.js`.
- **Giải pháp chuẩn**: Luôn thêm `.js` vào relative import: `import { Service } from './service.js';`.
- **Điều cấm tuyệt đối**: Không import relative không đuôi mở rộng.

#### [PITFALL-002] Quên chạy `tsc-alias` sau khi build `tsc`
- **Hiện tượng**: `npm run build` thành công nhưng chạy `npm start` crash vì không resolve được `@packages/*`.
- **Nguyên nhân gốc rễ**: `tsc` không tự chuyển đổi path aliases trong thư mục `dist/`.
- **Giải pháp chuẩn**: Luôn dùng `"build": "tsc -p tsconfig.build.json && tsc-alias"`.

#### [PITFALL-003] Nhầm lẫn API của Fastify với Express trong Controller/Interceptor
- **Hiện tượng**: Gọi các phương thức Express như `res.status(200).json(...)` hoặc `res.send(...)` gây lỗi runtime hoặc treo request.
- **Nguyên nhân gốc rễ**: Nền tảng dùng Fastify, đối tượng response là `FastifyReply`.
- **Giải pháp chuẩn**: Trả về dữ liệu trực tiếp (`return data`) hoặc dùng API của Fastify.

#### [PITFALL-004] Rò rỉ logic nghiệp vụ cụ thể vào tầng Core Packages (`packages/`)
- **Hiện tượng**: Viết entity `User`, `Cart` hoặc nghiệp vụ bán hàng vào `packages/kernel`.
- **Nguyên nhân gốc rễ**: Đặt nhầm chỗ làm Core không thể tái sử dụng cho dự án khác.
- **Giải pháp chuẩn**: `packages/*` chỉ chứa base abstractions và infrastructure. Mọi nghiệp vụ phải đặt trong `modules/`.

#### [PITFALL-005] Đọc biến môi trường trực tiếp qua `process.env`
- **Hiện tượng**: Viết `process.env.PORT` rải rác dẫn đến lỗi khi thiếu biến hoặc sai kiểu.
- **Nguyên nhân gốc rễ**: Bỏ qua cơ chế validate schema.
- **Giải pháp chuẩn**: Định nghĩa schema Zod trong `@packages/config` và inject `CoreConfigService`.

#### [PITFALL-006] Phụ thuộc vòng (Circular Dependencies) giữa các Packages
- **Hiện tượng**: `kernel` import `security` và `security` lại import `kernel` gây lỗi runtime `undefined constructor`.
- **Nguyên nhân gốc rễ**: Phân cấp package chưa chuẩn một chiều.
- **Giải pháp chuẩn**: Phân cấp một chiều:
  1. `kernel`, `i18n`, `http-client` — không phụ thuộc package nào khác.
  2. `config` — chỉ phụ thuộc `kernel`.
  3. Nền dùng chung: `redis` (→ config, i18n), `logging` (→ config, redis), `runtime` (→ config, redis), `http` (→ kernel, i18n, logging), `metrics` (→ config, http).
  4. Package hạ tầng nghiệp vụ kỹ thuật: `security`, `database`, `cache`, `storage`, `messaging`, `queue` — được phụ thuộc các tầng 1–3; phụ thuộc ngang hàng hiện có và được chấp nhận: `storage → security`, `messaging → cache, metrics`, `queue → messaging`. **Không thêm chiều ngược lại** (vd `messaging` không được import `queue`, `cache` không import `messaging`).
  5. `modules` — phụ thuộc các `packages/*` ở trên, không có chiều ngược lại.
  6. `apps` — phụ thuộc `modules` + `packages/*`, không package/module nào được import ngược từ `apps`.
  - Ngoại lệ đã biết: `redis` cần token `RUNTIME_IDENTITY` của `runtime` → import **trực tiếp file** `@packages/runtime/constants/runtime.tokens.js`, KHÔNG import qua `@packages/runtime/index.js` (xem PITFALL-013).

#### [PITFALL-007] Code Overthink / Suy Diễn Thừa Thãi Trong File Config
- **Hiện tượng**: Tự ý thêm các đoạn kiểm tra range, format (như port, maxConnections, secret length) hoặc ép ghép URL kết nối phức tạp (`DATABASE_URL`, `REDIS_URL`) khiến file cấu hình rối rắm, khó đọc.
- **Nguyên nhân gốc rễ**: Overthink yêu cầu, vi phạm nguyên tắc KISS.
- **Giải pháp chuẩn**: File config chỉ đọc biến qua `env('KEY')` / `env.number('KEY')` và trả về config object. Dùng các biến chuẩn tách biệt (`DB_HOST`, `DB_PORT`, `DB_DATABASE`...).

#### [PITFALL-008] Đặt File Test Rải Rác Trong Thư Mục `src/`
- **Hiện tượng**: Tạo các file `*.spec.ts`, `*.test.ts` nằm xen lẫn trong `backend/src/`.
- **Nguyên nhân gốc rễ**: Thói quen mặc định của NestJS template cũ.
- **Giải pháp chuẩn**: Thư mục `src/` chỉ chứa 100% production code. Mọi bài test PHẢI đặt trong `backend/test/` theo cấu trúc `fixtures/`, `concerns/`, `unit/`, `feature/`.

#### [PITFALL-009] Lỗi Sandboxed Process.env & Treo Jest Khi Chạy Node.js 22 ESM
- **Hiện tượng**: Node.js 22 `process.loadEnvFile()` không cập nhật vào Jest Proxy; Jest ESM chạy đa luồng worker bị treo.
- **Giải pháp chuẩn**: `env.ts` nạp trực tiếp vào `process.env[key] = value`; script test luôn thêm cờ `--runInBand`.

---

## 10. CẤU TRÚC THƯ MỤC FRONTEND (DIRECTORY TREE)

Cùng triết lý như backend (Mục 2): tách rõ tầng **dùng lại được** (`core/`) khỏi tầng **nghiệp vụ của riêng app này** (`modules/`). `core/` phải copy nguyên thư mục sang một dự án FE khác là chạy được ngay — đây chính là "core" bạn có thể mang đi dùng lại (Button, Table, Dropdown/Select...).

Cây dưới đây chỉ vẽ thư mục (không vẽ file), là từ vựng chuẩn — dùng đúng tên có sẵn, không tự chế tên khác. Không bắt buộc tạo sẵn hết; chỉ tạo khi có nội dung thật (giống lưu ý ở Mục 3.3).

```text
frontend/src/
├── core/                        # Tầng kỹ thuật + UI dùng chung, KHÔNG chứa nghiệp vụ — di chuyển nguyên vẹn sang dự án FE khác được, xem 10.1
│   ├── components/                # UI primitive dùng chung — mỗi component 1 thư mục riêng
│   │   ├── button/
│   │   ├── input/
│   │   ├── select/                  # Dropdown / Select
│   │   ├── table/
│   │   ├── modal/
│   │   ├── drawer/
│   │   ├── pagination/
│   │   ├── tabs/
│   │   ├── tag/
│   │   ├── tooltip/
│   │   ├── avatar/
│   │   ├── checkbox/
│   │   ├── radio/
│   │   ├── form/
│   │   └── empty-state/
│   │
│   ├── layouts/                   # Khung trang dùng chung — Header, Footer, Sidebar, PageContainer, AuthLayout, MainLayout
│   ├── i18n/                      # Hạ tầng i18n FE — LocaleProvider, translate(), locales/ (chuỗi chung)
│   ├── hooks/                     # Hook thuần kỹ thuật — useFetch, useNow, useDebounce, usePagination, useDisclosure, useLocalStorage
│   ├── services/                  # HTTP client dùng chung (axios/fetch instance, interceptor request/response)
│   ├── theme/                     # Design token — color, spacing, typography, breakpoint (CSS variable)
│   ├── utils/                     # Helper thuần — formatDate, formatCurrency, classNames, validator chung
│   ├── types/                     # Type dùng chung toàn app — ApiResponse, PaginationMeta...
│   ├── constants/                 # Hằng số dùng chung — route path chung, HTTP status, regex chung
│   └── icons/                     # Bộ icon dùng chung (nếu tự quản lý SVG icon riêng)
│
├── modules/                     # Module nghiệp vụ của app này — mỗi module = 1 Bounded Context, xem 10.2
│   └── <module-name>/              # vd: auth, user, order... — nên đặt tên khớp module tương ứng ở backend
│       ├── components/              # Component riêng của module — ghép từ core/components
│       ├── pages/                    # Component cấp route (page)
│       ├── sections/                 # Màn hình con trong 1 page dạng console/dashboard (vd system-console/sections/<area>/)
│       ├── layouts/                  # Khung riêng của module (sidebar, topbar riêng)
│       ├── context/                  # React Context riêng của module (data, route, theme)
│       ├── hooks/                     # Hook riêng nghiệp vụ module
│       ├── services/                   # Gọi API riêng của module (dùng core/services làm nền)
│       ├── store/                       # State riêng của module, nếu cần ngoài state cục bộ của component
│       ├── types/                        # Type nghiệp vụ riêng module
│       ├── constants/                     # Enum/constant hiển thị riêng module
│       ├── utils/                          # Helper riêng module (format số liệu, map trạng thái...)
│       ├── styles/                         # CSS riêng module
│       └── locales/                        # Bản dịch riêng module — cùng nguyên tắc "i18n tự trị" ở Mục 4
│           ├── vi/
│           └── en/
│
├── routes/                      # Định nghĩa route, route guard
├── providers/                   # Provider gốc toàn app — Theme, QueryClient, ErrorBoundary, AuthContext
├── assets/                      # Ảnh, font, svg tĩnh
└── config/                      # Cấu hình build-time/env (API base URL...)
```

### 10.1. `core/` — điều kiện để thực sự "mang đi dùng lại được"

- **Một chiều tuyệt đối**: `core/` không được import bất kỳ thứ gì từ `modules/`. Nếu 1 file trong `core/` cần thứ gì đó từ `modules/`, đó là dấu hiệu nó không thuần kỹ thuật nữa — phải chuyển ra `modules/` hoặc rút phần thật sự chung vào `core/`.
- **Không hardcode nghiệp vụ**: `core/components/` không hardcode text/label nghiệp vụ, route path nghiệp vụ, hay gọi API nghiệp vụ cụ thể. Component nhận dữ liệu qua props/callback (data-driven), không tự fetch bên trong.
- **API theo hình dạng dữ liệu, không theo tên field nghiệp vụ**: ví dụ `Table` nhận `columns` + `data` kiểu generic, không hardcode field như `hoTen`, `diemThi`.
- Nhờ 3 điều trên, `core/` có thể copy nguyên thư mục sang một project React khác và chạy được ngay (chỉ cần cùng bộ dependency nền: React, và UI lib nếu project đó chọn dùng).

### 10.2. `modules/<module-name>/` — nghiệp vụ riêng của app này

- Được phép phụ thuộc `core/`, nhưng `core/` không được phụ thuộc ngược lại.
- Không tạo sẵn đủ bộ thư mục con cho mọi module — chỉ tạo khi có nội dung thật, giống quy ước ở backend (Mục 3.3).
- Khi 1 component ở `modules/<a>/components/` được cần dùng lại ở `modules/<b>/` khác → áp dụng đúng thứ tự tái sử dụng ở `core-development-rule.md` Mục 4; nếu quyết định "tách dùng chung", nơi tách tới là `core/components/`, không phải copy sang module kia.

---

## 11. BẢNG TRA CỨU VỊ TRÍ ĐẶT FILE FRONTEND CHO AI

| Muốn tạo thành phần gì | Thư mục bắt buộc đặt vào |
| :--- | :--- |
| **UI primitive dùng chung (Button, Table, Dropdown/Select, Modal...)** | `core/components/<ten-component>/` |
| **Layout khung trang dùng chung (Header, Footer, Sidebar)** | `core/layouts/` |
| **Hook thuần kỹ thuật, không gắn nghiệp vụ** | `core/hooks/` |
| **HTTP client / interceptor dùng chung** | `core/services/` |
| **Design token (màu, spacing, typography, breakpoint)** | `core/theme/` |
| **Helper thuần (format, validate chung)** | `core/utils/` |
| **Type dùng chung toàn app** | `core/types/` |
| **Hằng số dùng chung toàn app** | `core/constants/` |
| **Icon dùng chung** | `core/icons/` |
| **Hạ tầng i18n FE dùng chung (provider, translate)** | `core/i18n/` |
| **Component riêng của 1 module nghiệp vụ** | `modules/<module>/components/` |
| **Page / component cấp route** | `modules/<module>/pages/` |
| **Màn hình con trong page dạng console** | `modules/<module>/sections/<area>/` |
| **Layout / Context / Utils / CSS riêng module** | `modules/<module>/layouts|context|utils|styles/` |
| **Hook riêng nghiệp vụ module** | `modules/<module>/hooks/` |
| **Gọi API riêng nghiệp vụ module** | `modules/<module>/services/` |
| **State riêng của module** | `modules/<module>/store/` |
| **Type nghiệp vụ riêng module** | `modules/<module>/types/` |
| **Enum/constant hiển thị riêng module** | `modules/<module>/constants/` |
| **Bản dịch riêng nghiệp vụ module** | `modules/<module>/locales/<locale>/` |
| **Định nghĩa route / route guard** | `routes/` |
| **Provider gốc toàn app (Theme, QueryClient, Auth)** | `providers/` |
| **Ảnh / font / svg tĩnh** | `assets/` |
| **Cấu hình env / API base URL** | `config/` |

---

## 12. KIẾN TRÚC MANAGEABLE PACKAGE (PATTERN NỘI BỘ)

Đây là một **design pattern đặc trưng của Core Framework**, giúp mỗi package hạ tầng tự khai báo trạng thái và khả năng vận hành của mình về trung tâm quản lý (System-Ops module).

### 12.1. Giao diện `ManageablePackage` (định nghĩa tại `packages/kernel/contracts/`)

```typescript
interface ManageablePackage {
  readonly packageId: string;       // ID duy nhất (vd: 'cache', 'database')
  readonly displayName: string;     // Tên hiển thị
  readonly category: PackageCategory; // Phân loại: cache | queue | logging | database | storage | custom
  readonly icon: string;

  getStatus(): Promise<PackageStatusReport>; // Bắt buộc báo cáo trạng thái
  getActions?(): PackageActionDescriptor[];  // Tùy chọn: danh sách hành động quản trị
  executeAction?(actionId, params?): Promise<...>; // Tùy chọn: thực thi hành động
}
```

### 12.2. Cách Package Đăng Ký

Các Adapter triển khai `ManageablePackage` đặt trong `packages/<ten>/providers/`:
- `DatabaseManageableAdapter` (`packages/database/providers/database-manageable.adapter.ts`)
- `CacheManageableAdapter` (`packages/cache/providers/cache-manageable.adapter.ts`)
- `LoggingManageableAdapter` (`packages/logging/providers/logging-manageable.adapter.ts`)
- `MessagingManageableAdapter` (`packages/messaging/providers/messaging-manageable.adapter.ts`)
- `SecurityManageableAdapter` (`packages/security/providers/security-manageable.adapter.ts`)
- `StorageManageableAdapter` (`packages/storage/providers/storage-manageable.adapter.ts`)
- `QueueManageableAdapter`, `MetricsManageableAdapter`, `RuntimeManageableAdapter` (`packages/<ten>/providers/`) và `RedisManageableAdapter` (`packages/redis/redis-manageable.adapter.ts`)

> `config`, `i18n`, `http-client` chưa có adapter; `kernel` và `http` không có gì để giám sát. Khi bổ sung, theo đúng quy tắc 12.3.

Mỗi Module đăng ký adapter bằng Multi-Provider token:
```typescript
@Module({
  providers: [
    {
      provide: MANAGEABLE_PACKAGE,  // Multi-token từ packages/kernel
      useClass: DatabaseManageableAdapter,
      multi: true,
    }
  ]
})
export class DatabaseModule {}
```

### 12.3. Quy tắc cho AI khi làm việc với ManageablePackage

- Khi tạo Package hạ tầng mới: **BẮT BUỘC** tạo kèm file `*-manageable.adapter.ts` trong `providers/` của package đó.
- Adapter PHẢI implement interface `ManageablePackage` từ `@packages/kernel/index.js`.
- Đặt tên theo mẫu: `<PackageName>ManageableAdapter`.
- Đăng ký vào module với `multi: true` dưới token `MANAGEABLE_PACKAGE`.
- KHÔNG tạo adapter với `getActions()` nếu package đó chưa thực sự cần thao tác quản trị.

---

## 13. MODULE SYSTEM-OPS (NỘI BỘ DASHBOARD)

`modules/system-ops/` là module dashboard vận hành nội bộ — **không phải nghiệp vụ của dự án cụ thể nào**, mà là tiện ích theo dõi hạ tầng Core tích hợp sẵn.

### 13.1. Endpoints đã được expose

| Method | Endpoint | Mô tả |
| :----- | :------- | :----- |
| `GET` | `/api/v1/ops/packages` | Liệt kê tất cả package đã đăng ký và trạng thái tổng quan |
| `GET` | `/api/v1/ops/packages/:packageId` | Chi tiết trạng thái + danh sách hành động của 1 package |
| `POST` | `/api/v1/ops/packages/:packageId/actions/:actionId` | Thực thi một hành động quản trị |
| `GET` | `/api/v1/ops/overview` | Tổng quan System Console (health map, KPI, sự cố) |
| `GET` | `/api/v1/ops/secrets` | Metadata secret (key, driver, có/thiếu, độ dài) — không bao giờ trả giá trị |
| `GET` | `/api/v1/ops/configuration`, `/api/v1/ops/configuration/:domain` | Cấu hình đang chạy, key nhạy cảm bị che `••••••••` |

> **Lưu ý bảo mật**: Tất cả endpoint `/ops/*` hiện được đánh dấu `@Public()` để phục vụ dashboard nội bộ. Khi deploy production thực tế, nên thêm IP whitelist hoặc basic auth qua Nginx cho route này.

### 13.2. `PackageRegistryService`

Service trung tâm (`modules/system-ops/services/package-registry.service.ts`) nhận injection tất cả `MANAGEABLE_PACKAGE` token qua `@Inject(MANAGEABLE_PACKAGE)`. Nó tổng hợp trạng thái của toàn bộ package và cung cấp cho controller.

### 13.3. Giao diện Frontend

Không còn trang "System Ops" riêng — mọi thứ nằm trong System Console (`frontend/src/modules/system-console/`). Package hiển thị ở mục Governance → Packages (`sections/packages/PackagesSection.tsx`, API `services/packages.api.ts`, type `types/packages.types.ts`).

### 13.4. Các module vận hành `*-ops` & System Console

Ngoài `system-ops`, các module dưới đây cũng là tiện ích vận hành nội bộ (không phải nghiệp vụ). Tất cả nằm dưới global prefix `API_PREFIX` (vd `/api/v1`):

| Module | Route PREFIX | Nội dung |
| :--- | :--- | :--- |
| `health` | `health` | Health check |
| `system-ops` | `ops` | Overview, packages/actions, secrets, configuration |
| `runtimes` | `ops/runtimes` | Danh sách runtime, chi tiết, logs, time-series (Prometheus), lệnh pause/resume — **không** còn restart/stop/start (Docker quản lý) |
| `traffic` | `ops/traffic` | Summary, timeseries, endpoints, errors, insights (PromQL) — **không** còn chi tiết từng request (`/requests`, `/active`); xem request ở Logs theo `reqId` |
| `performance` | `ops/performance` | Overview, timeseries (+ baseline), bottleneck theo rule `PERF_*`, sự kiện, component |
| `database-ops` | `ops/database` | Kết nối, query (digest), bảng, transaction/session đang chạy, migration |
| `cache-ops` | `ops/cache` | Keyspace, namespace, key, thao tác cache |
| `storage-ops` | `ops/storage` | Container/bucket, object, thao tác — **không** còn traffic storage tự đo |
| `messaging-ops` | `ops/messaging` | Channel, consumer, message, retry, dead letter, lỗi (job failed), broker — **không** còn producers / kích thước payload |
| `worker-ops` | `ops/workers`, `ops/queues` | Worker & queue BullMQ, thao tác queue |
| `scheduler-ops` | `ops/scheduler` | Task, lịch sử chạy, timeline, Run Now/Enable/Disable |
| `jobs-ops` | `ops/jobs` | Job explorer, failures, performance, thao tác job |
| `logs-ops` | `ops/logs` | Log explorer, errors, trace, audit, cấu hình log |

Frontend tương ứng: `frontend/src/modules/system-console/` — registry điều hướng ở `shell/sections.ts` (sidebar, route path `/system-console/<area>`, breadcrumb, Ctrl K). Mỗi khu vực có `sections/<area>/` (tab, `use<Area>Page`, `<area>-keys.ts`), `components/<area>/`, `constants/<area>.ts`; UI dùng chung nằm ở `frontend/src/core/ui`.

---

## 14. QUẢN LÝ BÍ MẬT (SECRET MANAGEMENT)

### 14.1. Hai driver hỗ trợ (package `security/providers/`)

| Driver | Cách cấu hình | Khi nào dùng |
| :----- | :------------ | :----------- |
| `env` (mặc định) | Đọc `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` từ biến môi trường | Development, CI/CD đơn giản |
| `file` | Đặt `SECRET_DRIVER=file` + `JWT_ACCESS_SECRET_FILE=/path/to/file` | Production với Docker Secret hoặc Vault |

### 14.2. Quy tắc sử dụng

- Inject `SecretService` để đọc bí mật — KHÔNG đọc trực tiếp `process.env.JWT_ACCESS_SECRET`.
- Inject `TokenService` để ký/xác minh JWT.
- Guard toàn hệ thống: `AuthGuard` được đăng ký ở cấp `APP_GUARD` trong `api.module.ts`, chặn mọi route chưa có `@Public()`.
- Đánh dấu route công khai: `@Public()` (decorator từ `@packages/http/index.js`).

### 14.3. Mở rộng thêm Provider mới (ví dụ: Vault, AWS Secrets Manager)

1. Tạo file provider mới trong `packages/security/providers/<name>-secret.provider.ts`.
2. Implement interface `ISecretProvider` (`packages/security/contracts/secret-provider.contract.ts`).
3. Đăng ký vào `SecurityModule` và bổ sung vào factory chọn driver.
4. Thêm giá trị enum mới vào `SecretDriver` (`packages/security/types/secret.types.ts`).

---

## 15. DOCKER STACK & VẬN HÀNH

### 15.1. Cấu trúc Docker file

```text
core/
├── docker/
│   ├── backend/
│   │   ├── Dockerfile.dev         # Build image development (node:22-alpine, bind mount)
│   │   ├── Dockerfile.prod        # Build image production (multi-stage, optimized)
│   │   └── entrypoint.dev.sh      # Entrypoint dev: chạy npm run dev
│   ├── frontend/
│   │   ├── Dockerfile.dev         # Build image FE dev (Vite dev server)
│   │   ├── Dockerfile.prod        # Build image FE prod (static build)
│   │   └── entrypoint.dev.sh      # Entrypoint FE dev: chạy npm run dev
│   ├── nginx/
│   │   ├── Dockerfile             # Build Nginx image với config bên dưới
│   │   ├── nginx.conf             # Cấu hình chính (rate limit, worker, gzip, log)
│   │   ├── security-headers.conf  # Security headers (X-Frame-Options, HSTS...)
│   │   └── conf.d/
│   │       ├── app.conf           # Virtual host HTTP (upstream backend + serve FE SPA)
│   │       └── ssl.conf.template  # Template HTTPS — sinh ra từ docker-prod.sh ssl-init
│   └── entrypoint.prod.sh         # Entrypoint prod backend: chạy node dist/apps/api/main.js
├── docker-compose.yml             # Base config (dùng chung)
├── docker-compose.dev.yml         # Override cho development
├── docker-compose.prod.yml        # Cấu hình production đầy đủ (nginx + certbot + ssl)
├── docker-dev.sh                  # Script quản lý dev containers
└── docker-prod.sh                 # Script 1-click deploy production
```

### 15.2. Các lệnh Docker thường dùng

#### Development
```bash
./docker-dev.sh up                    # Khởi động toàn bộ (BE :3005 + FE :5175)
./docker-dev.sh up backend            # Chỉ khởi động backend
./docker-dev.sh logs backend          # Xem log realtime backend
./docker-dev.sh logs frontend         # Xem log realtime frontend
./docker-dev.sh restart backend       # Restart backend
./docker-dev.sh bash backend          # Vào shell container backend
./docker-dev.sh down                  # Dừng và xóa containers
./docker-dev.sh ps                    # Xem trạng thái containers
```

#### Production
```bash
./docker-prod.sh up                   # Build & khởi động toàn bộ production stack
./docker-prod.sh ssl-init             # Cấp chứng chỉ SSL Let's Encrypt lần đầu
./docker-prod.sh status               # Xem trạng thái + RAM/CPU realtime
./docker-prod.sh logs nginx           # Xem log nginx
./docker-prod.sh restart backend      # Restart backend production
./docker-prod.sh down                 # Dừng production stack
```

### 15.3. Topology Docker Network (Production)

```text
Internet
    │ :80 / :443
    ▼
[Nginx Container] ──────────────────── core_prod_net
    │ proxy_pass /api/ → backend:3005
    │ serve static /  → /var/www/frontend (volume)
    ▼
[Backend Fastify Container] :3005 (không expose ra ngoài)
    │ connects to external MySQL/Redis (host IP hoặc managed DB)
    ▼
[Frontend Build Container] → volume frontend_dist → Nginx đọc
[Certbot Container]       → volume certbot_conf  → Nginx đọc
```

### 15.4. Giới hạn tài nguyên RAM mặc định

| Service | Development | Production |
| :------ | :---------: | :--------: |
| Backend (API) | 1536m limit / 512m reserved | 512m limit / 256m reserved |
| Worker | 512m limit / 256m reserved | 512m limit / 256m reserved |
| Scheduler | 256m limit / 128m reserved | 256m limit / 128m reserved |
| Frontend | 384m limit / 192m reserved | 128m limit (static build) |
| Nginx | — | 128m limit |
| `NODE_OPTIONS` (backend) | `--max-old-space-size=1024` (`.env.docker.dev`; file example ghi 384) | `--max-old-space-size=400` |

### 15.5. Lệnh thực thi trong Container (qua Docker Exec)

Theo quy tắc ở Global Rules, khi cần chạy lệnh Backend qua shell:
```bash
# Development
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T backend <command> < /dev/null

# Hoặc dùng helper
./docker-dev.sh bash backend
```

---

## 16. TRIỂN KHAI VPS (PRODUCTION DEPLOY)

### 16.1. Chuẩn bị VPS lần đầu (Ubuntu/Debian)

```bash
# Chạy script tự động cài Docker + UFW + Swap
sudo bash deploy/setup-vps.sh
```

Script thực hiện 5 bước:
1. `apt-get update && upgrade`
2. Tạo Swap File 2GB (tránh OOM khi build)
3. Cấu hình UFW (chỉ mở cổng 22, 80, 443)
4. Cài Docker Engine (official repo)
5. Báo cáo hoàn tất

### 16.2. Quy trình Deploy lần đầu

```bash
# 1. Clone repo vào /var/www/<project-name>
git clone <repo-url> /var/www/core
cd /var/www/core

# 2. Tạo file env production từ mẫu
cp .env.docker.prod.example .env.docker.prod
nano .env.docker.prod   # Điền DOMAIN_NAME, DB_*, JWT_*, CERTBOT_EMAIL

# 3. Khởi động stack (HTTP trước khi có SSL)
./docker-prod.sh up

# 4. Cấp chứng chỉ SSL Let's Encrypt
./docker-prod.sh ssl-init
```

### 16.3. Cài systemd Service (Auto-restart khi VPS reboot)

```bash
sudo cp deploy/core-framework.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable core-framework
sudo systemctl start core-framework
```

> **Lưu ý**: File `deploy/core-framework.service` mặc định trỏ `WorkingDirectory=/var/www/core`. Khi copy dự án sang tên mới, phải cập nhật đường dẫn này và đổi tên file service thành `<ten-du-an>.service`.

### 16.4. Các biến môi trường bắt buộc cho Production

| Biến | Ví dụ | Ghi chú |
| :--- | :----- | :------ |
| `DOMAIN_NAME` | `yourdomain.com` | Domain thật để Certbot cấp SSL |
| `CERTBOT_EMAIL` | `admin@yourdomain.com` | Email đăng ký SSL |
| `DB_HOST` | `127.0.0.1` | IP database server |
| `DB_DATABASE` | `core_prod_db` | Tên database production (KHÔNG dùng chung với dev) |
| `DB_PASSWORD` | (chuỗi ngẫu nhiên) | Mật khẩu mạnh |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 32` | Tối thiểu 32 ký tự |
| `JWT_REFRESH_SECRET` | `openssl rand -base64 32` | Tối thiểu 32 ký tự, khác ACCESS |
| `REDIS_PREFIX` | `core_prod:` | Tránh xung đột nếu Redis dùng chung nhiều app |

---

## 17. HIỆN TRẠNG CODEBASE (TRẠNG THÁI ĐÃ TRIỂN KHAI)

Mục này ghi lại **những gì đã được xây dựng thực tế** trong codebase tính đến thời điểm tài liệu được cập nhật (**2026-10-13**, sau khi hoàn tất `.agents/cleanup_plan.md`). AI cần đọc mục này để tránh "nghĩ ra lại" những gì đã có sẵn. Mục này mô tả ở mức tính năng — danh sách file cụ thể luôn kiểm tra lại trên code.

> Tóm tắt: **Lean Core + System Console 17 mục, mọi số liệu có nguồn thật** (API gốc của hạ tầng cho trạng thái hiện tại, Prometheus cho lịch sử, `null` khi thiếu nguồn). **CHƯA có module nghiệp vụ nào** (`project-modules/` trống) và **chưa có Auth** — `/ops/*` vẫn `@Public()`, không deploy ra môi trường public.

### 17.1. Backend — packages (15 package)

| Package | Đã có |
| :------ | :----- |
| `kernel` | Base entity/value-object, contract repository/use-case/`ManageablePackage`, `AppException`/`DomainException`/`NotFoundException`, `Result` |
| `config` | `env()` fail-fast + `CoreConfigService` (app, auth, database, cache, storage, queue, messaging, jobs, logs, scheduler, runtime, traffic, performance, metrics) + `ConfigInspectorService` |
| `http` | Global exception filter, transform-response interceptor, `@Public()`, request annotations |
| `redis` | `RedisService` dùng chung + `RedisManageableAdapter` |
| `database` | Kết nối TypeORM thật, monitoring MySQL/Postgres/basic (digest, EXPLAIN MySQL), operations, slow query → Pino, adapter |
| `logging` | `nestjs-pino`, Redis Stream `logs:<env>` (`MAXLEN ~ 50.000`), redaction, đổi level tạm thời, adapter |
| `metrics` | Registry prom-client theo runtime, `HttpMetricsHook` (Fastify `onResponse`), `PrometheusQueryClient`, `round`/`changePercent`, adapter |
| `runtime` | `RuntimeAgentService` (heartbeat, sự kiện, pause/resume), `ResourceSampler`, lịch sử CLI, contract `RuntimeContributor`, adapter |
| `security` | JWT strategy, `AuthGuard` (APP_GUARD), `TokenService` (**skeleton**, Phase 11), secret provider env/file (`SECRET_DIR` từ config), `SecretRegistryService`, adapter |
| `cache` | Driver memory/redis, monitoring keyspace/namespace (INFO/SCAN), operations, adapter |
| `storage` | Driver local/S3, monitoring list/head, operations object, adapter |
| `queue` | BullMQ queue/job provider, monitoring + operations queue/job, key scheduler, adapter |
| `messaging` | Publisher (`messages_published_total`), queue registry, monitoring BullMQ (gồm `failures()`), operations, adapter |
| `http-client` | Provider + logging interceptor (outbound) |
| `i18n` | Header locale resolver, middleware/context, formatter, `I18nService`, locales vi/en (gồm bản dịch các khu vực ops) |

### 17.2. Backend — modules (13 module, toàn bộ là module vận hành)

`health`, `system-ops`, `runtimes`, `traffic`, `performance`, `database-ops`, `cache-ops`, `storage-ops`, `messaging-ops`, `worker-ops`, `scheduler-ops`, `jobs-ops`, `logs-ops` — route prefix xem Mục 13.4. Mỗi module gồm `controllers/`, `services/`, `responses/`, `routes/` (+ `exceptions/` nếu có). Các monitor nền (`*-monitor.service.ts`, `PerformanceMonitorService`) chạy trong runtime API, mỗi chu kỳ một instance nhờ lock Redis, ghi gauge Prometheus và sự kiện/cảnh báo vào Redis (list có giới hạn).

### 17.3. Backend — apps runtimes

| Runtime | Đã có | Trạng thái |
| :------ | :----- | :--------- |
| `api` | `bootstrap/server.bootstrap.ts`, `runtime/api-runtime.contributor.ts`, `GET /api/v1/metrics` | ✅ Hoạt động đầy đủ |
| `worker` | `processors/system/system.processor.ts` (`@Processor` queue `system.events`), runtime contributor, `:9101/metrics` | ✅ Chạy thật, chờ thêm processor nghiệp vụ |
| `scheduler` | `registry/scheduled-task.registry.ts`, `bootstrap/sync-schedules.ts`, `tasks/system/system.task.ts`, runtime contributor, `:9102/metrics` | ✅ Chạy thật, chờ thêm task nghiệp vụ |
| `cli` | `commands/system/system.command.ts` | ⚠️ Mới có 1 lệnh `system` |

### 17.4. Frontend

| Thư mục | Đã có |
| :------ | :----- |
| `core/` | `layouts/` (Header, Footer, MainLayout), `components/card/`, `hooks/` (useFetch, useNow), `i18n/` (LocaleProvider, translate, locales vi/en), `services/api.ts`, `types/`, `constants/` |
| `modules/system-console/` | Giao diện quản lý duy nhất. **17 mục `ready`**: Overview, Runtimes, HTTP Traffic, Performance, Database, Cache, Storage, Messaging, Worker, Scheduler, Jobs, Logs, Security, Secrets, Configuration, Packages (+ registry điều hướng `shell/sections.ts`) |
| `modules/home/` | Trang chủ demo (Header có nút mở System Console) |
| `providers/`, `routes/` (`app.routes.ts`, `api.routes.ts`), `config/` | Provider gốc, định nghĩa route FE + route API, cấu hình env |

### 17.5. Test đã có

- `test/unit/` — 30 file: cache, config, database, i18n, jobs, logging, logs, messaging, performance, runtime, security, services, storage, system-ops, worker.
- `test/feature/api/` — 14 file: cache, database, governance (secrets/configuration), health, jobs, messaging, metrics (HTTP hook), performance, runtimes, scheduler, storage, system-ops, traffic, worker.
- `test/concerns/test-app.concern.ts`, `test/concerns/prometheus.concern.ts` (`stubPrometheus`: Prometheus giả, `configured = true`), `test/fixtures/env.fixture.ts`, `test/setup-env.ts` (BullMQ trỏ cổng đóng, Redis = ioredis-mock).

### 17.6. Chưa có / việc tiếp theo

- **Phase 11 — Auth**: `@nestjs/jwt`, `argon2`, `@nestjs/throttler`, `RolesGuard` + `@Roles('admin')` cho `/ops/*`, module `user`/`auth`, migration seed admin (xem `.agents/implementation_plan.md`).
- Module nghiệp vụ: `project-modules/` đang trống.
- CLI: lệnh `database/`, `user/`, `maintenance/`.
- Adapter `ManageablePackage` cho `config`, `i18n`, `http-client`.
- (Tuỳ chọn) gộp các module `*-ops` vào `modules/system-ops/` — đã cân nhắc và để ngoài phạm vi vì chỉ là di chuyển file.

### 17.7. Lệch quy ước đang tồn tại (nợ kỹ thuật — KHÔNG nhân rộng)

- **i18n của module `*-ops` nằm ở `packages/i18n/locales/<locale>/*.json`** (cache, database, jobs, logs, messaging, ops, overview, performance, runtime, scheduler, storage, traffic, worker) thay vì `modules/<module>/locales/` như Mục 4.4. Khu vực Console mới theo đúng chỗ này cho nhất quán; module nghiệp vụ mới PHẢI đặt bản dịch trong `modules/<module>/locales/`.
- **Không phải package nào cũng có `<ten>.module.ts` đúng tên**: `runtime` dùng `runtime-agent.module.ts`. Package mới vẫn theo quy ước `<ten>.module.ts`.
- **Phụ thuộc ngang hàng giữa packages** nhiều hơn mô hình lý tưởng — đã ghi nhận cụ thể ở PITFALL-006, không thêm chiều mới.

---

## 18. BỔ SUNG PITFALL

#### [PITFALL-010] Quên đổi `COMPOSE_PROJECT_NAME` / container name khi fork dự án mới
- **Hiện tượng**: Chạy `docker-dev.sh up` cho dự án mới nhưng containers bị ghi đè lên Core Framework cũ đang chạy, dẫn đến conflict cổng hoặc mất môi trường dev của dự án gốc.
- **Nguyên nhân gốc rễ**: `COMPOSE_PROJECT_NAME` và `container_name` trong `docker-compose.dev.yml` giống hệt nhau giữa 2 dự án.
- **Giải pháp chuẩn**: Khi fork dự án, bắt buộc đổi `COMPOSE_PROJECT_NAME`, `container_name` và port mapping trước tiên. Xem hướng dẫn chi tiết tại mục trả lời cho câu hỏi "copy dự án này sang làm dự án khác thì cần chỉnh gì".

#### [PITFALL-011] Thiếu Adapter `ManageablePackage` khi thêm Package mới
- **Hiện tượng**: Tạo package hạ tầng mới nhưng System Console (Governance → Packages) không hiển thị trạng thái của package đó.
- **Nguyên nhân gốc rễ**: Quên tạo file `*-manageable.adapter.ts` và đăng ký với `MANAGEABLE_PACKAGE` multi-token.
- **Giải pháp chuẩn**: Mỗi package hạ tầng mới BẮT BUỘC có kèm adapter ManageablePackage. Xem Mục 12 để biết chi tiết.

#### [PITFALL-012] Dùng sai token `@Public()` từ nhầm package
- **Hiện tượng**: Route không được bảo vệ hoặc lỗi inject khi dùng `@Public()` từ import sai.
- **Nguyên nhân gốc rễ**: Có 2 nơi có thể có decorator `@Public()` nếu không cẩn thận.
- **Giải pháp chuẩn**: Luôn import `@Public()` từ `@packages/http/index.js`, đây là decorator duy nhất được chuẩn hóa cho toàn hệ thống.

#### [PITFALL-013] Vòng import `redis` ↔ `runtime` qua barrel `index.ts`
- **Hiện tượng (nguy cơ)**: Class/token có thể bị `undefined` lúc khởi động (Nest báo không resolve được dependency) nếu `RedisService` import từ `@packages/runtime/index.js`. Code hiện tại đã tránh bằng cách import thẳng file token.
- **Nguyên nhân gốc rễ**: `runtime` phụ thuộc `redis`, `logging`, `metrics` (đều phụ thuộc `redis`). Nếu `redis` import barrel của `runtime` → ESM nạp vòng, một phía nhận binding chưa khởi tạo.
- **Giải pháp chuẩn**: Package tầng thấp cần token của package tầng cao chỉ import **trực tiếp file hằng số** không có side-effect (vd `@packages/runtime/constants/runtime.tokens.js`). Tốt hơn nữa: chuyển token xuống package tầng thấp hơn.
- **Điều cấm tuyệt đối**: Không import `@packages/runtime/index.js` (hoặc barrel của bất kỳ package tầng cao nào) từ `redis`, `logging`, `metrics`.

#### [PITFALL-014] Đo HTTP bằng interceptor của Nest
- **Hiện tượng**: Trang HTTP Traffic không thấy 404, request bị guard từ chối hay lỗi parse body — số lỗi thấp hơn thực tế.
- **Nguyên nhân gốc rễ**: Interceptor của Nest chỉ chạy khi request khớp route và đã qua guard/pipe; 404 của Fastify, lỗi parse body và guard reject không đi qua interceptor.
- **Giải pháp chuẩn**: Metric HTTP phải ghi ở hook Fastify `onResponse` (`HttpMetricsHook`, đăng ký qua `HttpAdapterHost` trong `onModuleInit`), nhãn `route = req.routeOptions.url ?? 'unmatched'`. Có feature test `test/feature/api/metrics/` kiểm tra 404/400 được đếm.

#### [PITFALL-015] Lớp compat trả 0 để giữ code cũ compile
- **Hiện tượng**: Trang Console hiện 0 (hoặc "healthy", "now") trông như hệ thống nhàn rỗi trong khi thực ra không có nguồn số liệu — vd `MetricRecorder` rỗng, `inFlight: 0`, `cpuPercent: 0`, `lastReadAt = thời điểm gọi API`.
- **Nguyên nhân gốc rễ**: Khi gỡ một hệ đo cũ, giữ lại hàm/kiểu trả giá trị mặc định cho đỡ phải sửa nơi gọi.
- **Giải pháp chuẩn**: Xoá cả chuỗi (route → controller → service → DTO → FE api → type → view → i18n → test), hoặc trả `null` để UI hiện "không khả dụng". Prometheus không trả lời → `null`/503, không phải 0. Mọi key Redis được đọc phải có chỗ ghi trong `src`.
