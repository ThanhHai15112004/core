# Core Framework

**Application Chassis — Khung gầm ứng dụng Node.js/TypeScript chuẩn sản xuất**

Dự án **Core** cung cấp toàn bộ hạ tầng kỹ thuật cần thiết (Infrastructure & Cross-cutting Concerns) để bạn có thể cắm (plug-in) bất kỳ mã nguồn nghiệp vụ nào vào một cách nhanh chóng — mà không bao giờ phải viết lại hạ tầng từ đầu.

---

## Tech Stack

| Lớp | Công nghệ |
| :--- | :--- |
| **Runtime** | Node.js ≥ 22 (ESM `"type": "module"`) |
| **Ngôn ngữ** | TypeScript 5.8+ (strict mode, NodeNext) |
| **Backend Framework** | NestJS 11 + Fastify Adapter |
| **ORM** | TypeORM 1.x — hỗ trợ MySQL, PostgreSQL, MSSQL, SQLite |
| **Validation** | Zod v4 |
| **Frontend** | React 19 + Vite 8 |
| **Linter FE** | oxlint |
| **Containerization** | Docker + Docker Compose v2 |
| **Reverse Proxy** | Nginx (production) |
| **SSL** | Let's Encrypt + Certbot |
| **Package Manager** | npm (workspace) + pnpm (monorepo) |
| **Git Hooks** | Husky + Commitlint + Lint-Staged |

---

## Cấu Trúc Thư Mục

```text
core/
├── .agents/                     # Quy tắc & hướng dẫn cho AI Agent
├── backend/                     # Backend NestJS + Fastify
│   ├── src/
│   │   ├── apps/                  # 4 Runtime entrypoints độc lập
│   │   │   ├── api/               #   HTTP API Server (:3005)
│   │   │   ├── worker/            #   Message Queue Consumer
│   │   │   ├── scheduler/         #   Cron Task Runner
│   │   │   └── cli/               #   CLI Command Tool
│   │   ├── packages/              # Core hạ tầng (domain-agnostic)
│   │   │   ├── kernel/            #   Base classes, contracts, types
│   │   │   ├── config/            #   Environment config (Fail-Fast)
│   │   │   ├── http/              #   HTTP filter, interceptor, decorator
│   │   │   ├── database/          #   TypeORM multi-driver
│   │   │   ├── logging/           #   Structured logging (correlation-id, redaction)
│   │   │   ├── security/          #   JWT Auth, SecretService (env/file driver)
│   │   │   ├── messaging/         #   Message Queue publisher
│   │   │   ├── cache/             #   Redis abstraction
│   │   │   ├── storage/           #   Object storage (local/S3)
│   │   │   ├── http-client/       #   Outbound HTTP client
│   │   │   └── i18n/              #   Internationalization
│   │   ├── modules/               # Modules nghiệp vụ dùng chung
│   │   │   ├── health/            #   GET /api/v1/health
│   │   │   └── system-ops/        #   Dashboard quản trị hạ tầng /api/v1/ops/*
│   │   └── project-modules/       # Modules nghiệp vụ riêng của dự án (cắm vào)
│   └── test/                    # Test suite (unit + feature)
├── frontend/                    # React 19 + Vite 8
│   └── src/
│       ├── core/                  # UI + kỹ thuật dùng chung (copy được sang dự án khác)
│       └── modules/               # UI nghiệp vụ (home, system-ops)
├── docker/                      # Dockerfiles + Nginx config
├── deploy/                      # Scripts VPS setup + systemd service
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── docker-dev.sh                # Helper quản lý dev containers
└── docker-prod.sh               # Helper 1-click deploy production
```

---

## Khởi Chạy Development

### Yêu cầu
- Docker & Docker Compose v2
- MySQL và Redis đang chạy trên host (WSL2 hoặc máy local)

### Bước 1: Tạo file cấu hình môi trường
```bash
cp .env.docker.dev.example .env.docker.dev
```

Chỉnh sửa `.env.docker.dev` — các giá trị quan trọng cần đổi:
```env
DB_DATABASE=core_db          # Tên database (phải tạo sẵn trong MySQL)
DB_PASSWORD=your_password
REDIS_PREFIX=core:
JWT_ACCESS_SECRET=...        # Tối thiểu 32 ký tự (openssl rand -base64 32)
JWT_REFRESH_SECRET=...       # Tối thiểu 32 ký tự, khác ACCESS
```

### Bước 2: Khởi động containers
```bash
./docker-dev.sh up
```

Truy cập:
- **Backend API**: http://localhost:3005/api/v1/health
- **System-Ops Dashboard**: http://localhost:3005/api/v1/ops/packages
- **Runtimes API**: http://localhost:3005/api/v1/ops/runtimes
- **Frontend**: http://localhost:5175 (System Console: `#system-console/runtimes`)

> `./docker-dev.sh up` chạy 4 service: `backend` (API, build + watch), `worker`, `scheduler`
> (dùng chung thư mục `dist` do `backend` build) và `frontend`. Cần Redis đang chạy (container `redis` trên WSL, cổng 6379).

### Các lệnh Docker Dev thường dùng
```bash
./docker-dev.sh up                  # Khởi động api, worker, scheduler, frontend
./docker-dev.sh up backend          # Chỉ khởi động backend
./docker-dev.sh logs backend        # Xem log realtime
./docker-dev.sh bash backend        # Vào shell container
./docker-dev.sh restart backend     # Restart service
./docker-dev.sh down                # Dừng và xóa containers
./docker-dev.sh ps                  # Xem trạng thái
```

---

## Phát Triển Cục Bộ (Không Docker)

```bash
# Cài dependencies
cd backend && npm install
cd ../frontend && npm install

# Chạy backend (cần file backend/.env.development và Redis)
cd backend && npm run dev:api
# Worker / Scheduler (terminal khác, sau khi đã build dist)
npm run start:worker
npm run start:scheduler

# CLI
npm run cli -- queue:publish demo.ping '{"n":1}'   # đẩy job cho Worker
npm run cli -- runtime:status                      # xem heartbeat các runtime

# Chạy frontend
cd frontend && npm run dev
```

### Scripts Backend
```bash
npm run dev:api       # API HTTP server (watch mode)
npm run dev:worker    # Worker (watch mode)
npm run dev:scheduler # Scheduler (watch mode)
npm run build         # Build production
npm run typecheck     # TypeScript check
npm run lint          # ESLint + auto-fix
npm test              # Chạy toàn bộ tests
npm run test:unit     # Chỉ Unit tests
npm run test:feature  # Chỉ Feature/API tests
npm run check         # lint + typecheck + test + build
```

---

## Deploy Production (VPS)

### Bước 1: Chuẩn bị VPS (Ubuntu/Debian) — chạy 1 lần
```bash
sudo bash deploy/setup-vps.sh
# Cài Docker, cấu hình UFW (22/80/443), tạo Swap 2GB
```

### Bước 2: Clone và cấu hình
```bash
git clone <repo-url> /var/www/core
cd /var/www/core
cp .env.docker.prod.example .env.docker.prod
nano .env.docker.prod   # Điền DOMAIN_NAME, DB_*, JWT_*, CERTBOT_EMAIL
```

### Bước 3: Khởi động và cấp SSL
```bash
./docker-prod.sh up          # Build & khởi động toàn bộ
./docker-prod.sh ssl-init    # Cấp SSL Let's Encrypt (chạy sau khi DNS trỏ đúng)
```

### Bước 4 (tùy chọn): Auto-start khi reboot
```bash
sudo cp deploy/core-framework.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable core-framework
```

### Các lệnh Docker Prod thường dùng
```bash
./docker-prod.sh status      # Trạng thái + RAM/CPU realtime
./docker-prod.sh logs nginx  # Xem log nginx
./docker-prod.sh restart backend
./docker-prod.sh down
```

---

## Thêm Nghiệp Vụ Mới

### Backend — Tạo module nghiệp vụ
1. Tạo thư mục `backend/src/project-modules/<ten-module>/`
2. Xây dựng theo cấu trúc: `entities/`, `requests/`, `responses/`, `repositories/`, `services/`, `controllers/`, `<module>.module.ts`
3. Đăng ký vào [`api.module.ts`](backend/src/apps/api/api.module.ts):
   ```typescript
   @Module({ imports: [..., YourModule] })
   export class ApiModule {}
   ```

### Frontend — Tạo trang nghiệp vụ
1. Tạo thư mục `frontend/src/modules/<ten-module>/pages/`, `components/`, `services/`
2. Thêm vào [`App.tsx`](frontend/src/App.tsx) để điều hướng đến trang mới

---

## Kiến Trúc Nổi Bật

### ManageablePackage Pattern
Mỗi package hạ tầng tự báo cáo trạng thái (`healthy/warning/error`) về System-Ops dashboard thông qua interface `ManageablePackage`. Xem thêm tại [`.agents/AGENTS.md`](.agents/AGENTS.md) — Mục 12.

### Multi-Runtime Architecture
Cùng 1 codebase phục vụ 4 chế độ chạy độc lập: `api` (HTTP), `worker` (queue consumer BullMQ), `scheduler` (cron), `cli` (command line).

### Runtime Operations (System Console → Runtimes)
- Mỗi runtime chạy `RuntimeAgentModule` (`packages/runtime`): gửi heartbeat, time-series CPU/RAM/event loop, sự kiện vòng đời và log vào **Redis** (mọi key dưới `REDIS_PREFIX`, không dùng `FLUSHDB` — Redis có thể dùng chung).
- API tổng hợp ở `modules/runtimes` → `GET /ops/runtimes`, `/ops/runtimes/:id`, `/metrics`, `/events`, `/logs`, `/cli/history`.
- Điều khiển: `POST /ops/runtimes/:id/restart {mode: graceful|force}`, `/stop {confirm: "STOP"}`, `/start`.
  - **Restart**: runtime tự dừng (graceful chờ request/job/task đang chạy) rồi thoát; supervisor (`RUNTIME_SUPERVISOR=docker|pm2|systemd`) dựng lại. Không có supervisor → Restart bị khoá.
  - **Stop/Start**: tạm dừng/tiếp tục xử lý (Worker ngừng lấy job, Scheduler ngừng cron), process vẫn sống; trạng thái Stop được giữ qua restart. API không thể Stop.
- `/ops/*` chưa có RBAC → đặt `OPS_RUNTIME_ACTIONS_ENABLED=false` ở production cho tới khi có xác thực.

### HTTP Traffic (System Console → HTTP Traffic)
- `packages/traffic` gắn hook ở tầng Fastify → mọi route của mọi module (kể cả 401 từ guard, 404) được đo tự động,
  module nghiệp vụ mới **không cần import hay decorator**. Endpoint được tự phát hiện từ controller của Nest.
- Aggregate theo endpoint (count, status, histogram latency → P50/P95/P99) ở 3 tầng: 10s (2h), 1 phút (25h), 1 giờ (8 ngày).
- Log nhẹ cho mọi request (`TRAFFIC_REQUEST_LOG_SIZE`); chi tiết (header/body đã che, timeline) chỉ cho request chậm/lỗi/lấy mẫu, giữ 24h.
- Request ↔ log nối qua correlation ID (`#system-console/logs?runtime=api&correlationId=...`).
- API: `GET /ops/traffic/{summary,timeseries,endpoints,endpoints/:routeId,requests,requests/:id,slow,errors,active,insights}`.
- Cấu hình: nhóm biến `TRAFFIC_*` trong `.env*.example`. Rate limiting chưa có nên UI hiện "chưa cấu hình".

### Performance (System Console → Performance)
- `packages/telemetry` (`MetricRecorder`, cung cấp qua `RuntimeAgentModule`) ghi số đo theo bucket 10s/1m/1h giống traffic:
  runtime (CPU, RSS/heap, event loop, GC), database (latency query, lỗi, pool, slow query), cache, worker/queue, message publish.
- Database được đo bằng cách bọc `driver.createQueryRunner` của TypeORM `DataSource` (không phụ thuộc driver, không lưu params).
- Traffic gộp thêm thời gian theo giai đoạn (routing, guard, handler, DB, cache, gửi) → phân rã latency trung bình/request.
- Rule engine theo ngưỡng `PERF_*` (không có "điểm số"); `PerformanceMonitor` (API, lock Redis) ghi sự kiện bắt đầu/hồi phục nghẽn.
- API: `GET /ops/performance/{overview,timeseries,bottlenecks,events,components/:id}`.

### Database (System Console → Database)
- Kết nối TypeORM thật (`TypeOrmModule.forRootAsync`, `manualInitialization`) do `DatabaseConnectionService` mở nền có retry:
  API vẫn chạy khi DB chưa sẵn sàng; trạng thái connecting/connected/reconnecting/unavailable theo từng runtime. Module nghiệp vụ dùng
  `TypeOrmModule.forFeature` / `@InjectRepository` như thường; migration đặt ở `src/database/migrations/`.
- `DatabaseMonitoringService` chọn provider theo driver: MySQL (performance_schema, không cần quyền PROCESS), PostgreSQL
  (pg_stat_*, pg_stat_statements nếu có), driver khác chỉ phần chung. Phần không hỗ trợ trả lý do, không có số giả.
- Session được gắn tên runtime (`core-api`, `core-worker`…) để biết runtime nào giữ kết nối. SQL hiển thị đã bỏ literal.
- Thao tác: Test Connection, Cancel Query (`CANCEL`), Terminate Session (`TERMINATE`), Run Migrations (`MIGRATE`) — bật/tắt bằng
  `OPS_DATABASE_ACTIONS_ENABLED`, `OPS_DATABASE_MIGRATIONS_ENABLED`; chỉ tác động session của user DB của app.
- API: `GET /ops/database/{overview,metrics,queries,queries/stats,queries/stats/:digest[/explain],connections[/:id],transactions,
  tables[/:name],storage,migrations,events,errors,config}`, `POST /ops/database/{ping,queries/:id/cancel,connections/:id/terminate,migrations/run}`.

### Cache (System Console → Cache)
- `BaseCacheProvider` (API `CacheContract` không đổi) chọn driver theo `CACHE_DRIVER`: `redis` dùng chung giữa các runtime,
  key `<REDIS_PREFIX>cache:*`, value JSON; `memory` là Map riêng từng process. Lỗi Redis không ném ra caller (đọc = miss, ghi bỏ qua).
- Mọi thao tác được đo theo namespace (`cache.ns.<ns>.hit|miss|set|del`, latency, lỗi theo loại). Namespace = tối đa
  `CACHE_NAMESPACE_DEPTH` segment đầu, dừng ở segment trông như id (`data:users:12` → `data:users`).
- Monitor nền (API, lock Redis) quét keyspace bằng `SCAN` có giới hạn (không `KEYS`): số key, dung lượng (`MEMORY USAGE`), TTL,
  key lớn, key sắp hết hạn; đọc `INFO`/`CLIENT LIST` (chỉ đọc, không `CONFIG SET`) và đánh giá cảnh báo (hit rate so với baseline,
  miss storm kèm tải DB, bộ nhớ, eviction, expiration spike, key lớn). Số liệu server Redis gắn nhãn "dùng chung" khi Redis dùng chung.
- Thao tác: Delete Key (`DELETE`), Clear Namespace (gõ tên namespace), Flush cache của core (`FLUSH CACHE`) — `SCAN` + `UNLINK`
  chỉ trong vùng cache, không bao giờ `FLUSHDB`; ghi audit. Bật/tắt bằng `OPS_CACHE_ACTIONS_ENABLED`, `OPS_CACHE_FLUSH_ENABLED`;
  xem trước value (đã che field nhạy cảm, namespace session/token luôn ẩn) bằng `OPS_CACHE_VALUE_PREVIEW`.
- API: `GET /ops/cache/{overview,metrics,namespaces[/:name],keys,keys/detail?key=,memory,ttl,clients,events,errors,operations,config,
  flush/impact}`, `POST /ops/cache/{ping,namespaces/:name/clear,flush}`, `DELETE /ops/cache/keys?key=`.

### Storage (System Console → Storage)
- `BaseStorageProvider` (API `StorageContract` không đổi) chọn driver theo `STORAGE_DRIVER`: `local` ghi file thật dưới
  `STORAGE_LOCAL_PATH` (ghi tạm rồi rename, chặn path traversal/symlink), `s3` cho AWS S3/MinIO (`@aws-sdk/client-s3`,
  multipart có tiến độ cho file lớn). Credentials đọc qua `SecretService`, không bao giờ trả ra API.
- Mọi thao tác được đo (PUT/GET/DELETE/HEAD, bytes, lỗi theo loại, HTTP status với S3, theo container = prefix cấp 1);
  upload đang chạy được báo lên Redis để thấy tiến độ.
- `StorageMonitoringService` theo capability: local (duyệt thư mục có cursor, capacity thật qua `statfs`), S3 (ListObjectsV2 theo
  continuation token, multipart dở, lifecycle/versioning/object lock chỉ đọc, signed URL). Monitor nền quét usage có giới hạn
  (`STORAGE_SCAN_MAX_OBJECTS`), lưu điểm theo giờ để tính tăng trưởng, và đánh giá cảnh báo.
- Thao tác: Test Storage (connect → write → read → verify → delete), Delete object/version (`DELETE` / gõ lại key), Download,
  Signed URL, Preview (ảnh ≤ 2 MB, text 4 KB đầu, JSON đã che field nhạy cảm; prefix nhạy cảm không preview), Abort multipart
  (`ABORT`) — mỗi thao tác bật/tắt bằng `OPS_STORAGE_*` và ghi audit.
- API: `GET /ops/storage/{overview,metrics,traffic,usage,containers[/:id],objects,objects/detail?key=,objects/download?key=,
  objects/preview?key=,uploads,lifecycle,errors,events,operations,config}`, `POST /ops/storage/{test,objects/signed-url,
  uploads/abort}`, `DELETE /ops/storage/objects?key=&versionId=`.

### Messaging (System Console → Messaging)
- Transport là BullMQ trên Redis. `MessagePublisherContract.publish()` không đổi; envelope thêm `producer` (runtime) và
  `correlationId` (của request/tác vụ đã publish). Retry theo `MESSAGING_MAX_ATTEMPTS` + backoff; hết lượt → Dead Letter
  (failed set của BullMQ, giữ `MESSAGING_KEEP_DEAD_LETTER`).
- Consumer chạy qua `MessageConsumerRunner`: kiểm tra envelope (hỏng → dead letter ngay, không retry), chạy handler trong
  correlation ID của producer (log nối được), đo thời gian xử lý theo channel, ghi vòng đời vào job log
  (nhận → lỗi → hẹn retry → dead letter / replay), báo consumer đang chạy lên Redis. Processor tự khai báo `idempotent`.
- Monitor nền trong API (mỗi 15s, lock Redis): PING broker, gauge lag/độ sâu queue/dead letter, cảnh báo: broker
  unavailable, không có consumer, consumer tạm dừng, lag cao/đang tăng, tỷ lệ lỗi, publish lỗi, consumer chậm, dead
  letter, message lớn.
- Theo capability của provider (BullMQ: queue depth, consumer, browse, lifecycle, retry, dead letter, replay, discard,
  broker info); Kafka/RabbitMQ sau này thêm partitions/consumer groups/exchanges mà UI không phải đổi.
- Thao tác bật/tắt bằng env, có xác nhận và audit: Test Broker (queue `core.healthcheck` riêng: connect → publish →
  consume → ack), Retry ngay, Replay dead letter (gõ `REPLAY`, cảnh báo idempotency), Discard (gõ lại message ID),
  xem payload (đã che password/token/secret/thẻ, email).
- API: `GET /ops/messaging/{overview,metrics,channels[/:id],producers,consumers[/:id],messages[/:id[/payload]],retries,
  dead-letter,broker,errors,events,operations,config}`, `POST /ops/messaging/{test,messages/:id/retry,
  dead-letter/:id/replay}`, `DELETE /ops/messaging/dead-letter/:id`.

### Worker & Queue (System Console → Worker & Queue)
- Messaging trả lời "message có đi từ producer tới consumer không"; Worker & Queue trả lời "công việc nền có được worker
  thực thi kịp và thành công không". Queue provider (`packages/queue`, hiện là BullMQ) tách khỏi messaging provider về
  khái niệm, UI hiện phần tương ứng theo capability (workers, jobs, delayed, priority, stalled, pause, retry, drain).
- Số đo `wq.*` do consumer/publisher ghi (nhận vào, hoàn tất, lỗi, retry, hết lượt, thời gian chờ & xử lý theo queue);
  monitor nền trong API (mỗi 15s, lock Redis) ghi độ sâu từng queue và cảnh báo: backend unavailable, không có worker,
  queue tạm dừng còn job chờ, backlog, job chờ quá lâu, tỷ lệ lỗi, xử lý chậm, job treo, retry storm, gần hết
  concurrency, worker thiếu tài nguyên. Ngưỡng: `WORKER_QUEUE_*`.
- Worker instance lấy từ consumer tự báo (concurrency, job đang chạy) + telemetry tài nguyên theo instance; lịch sử
  restart lấy từ Runtime Monitor.
- Thao tác bật/tắt bằng env, có xác nhận và audit: Pause/Resume queue (toàn cục — worker làm xong job đang chạy rồi
  ngừng lấy job mới), Retry job lỗi (tối đa `OPS_QUEUE_RETRY_FAILED_MAX` mỗi lần, có xem trước), Drain (gõ `DRAIN`,
  mặc định tắt).
- API: `GET /ops/workers[/:id]`, `GET /ops/workers/{overview,metrics,failures,delayed,events,operations,config}`,
  `GET /ops/queues[/:name[/metrics|/jobs|/failures|/events]]`, `POST /ops/queues/:name/{pause,resume,retry-failed,drain}`.

### Scheduler (System Console → Scheduler)
- Scheduler trả lời "khi nào công việc phải được kích hoạt"; Worker & Queue trả lời "công việc nền đã tạo có được xử lý
  tốt không". Task nặng chỉ nên trigger / enqueue (khai báo `downstreamQueue`), Worker xử lý.
- Task khai báo trong code qua `ScheduledTaskRegistry` (`apps/scheduler/registry`): kiểu `cron` (theo múi giờ
  `SCHEDULER_TIMEZONE`, DST-aware), `interval` (căn mốc theo epoch) hoặc `one_time`; overlap policy (`skip` = Prevent,
  `allow`), misfire policy (`run_once`, `skip`), thời lượng dự kiến. Lịch sai → task "Misconfigured", không được lên lịch.
- Runtime (`TaskRunnerService`) ghi mỗi lần chạy vào Redis (`packages/scheduler`): scheduled / manual / recovery,
  success / failed / skipped / missed, drift so với lịch, instance, correlation ID (log và job enqueue mang cùng ID), job
  đã tạo. Nhiều instance: mỗi mốc lịch một instance nhận + lock Redis chống chạy chồng. Khởi động lại sau khi ngừng quá
  30s → ghi một bản ghi `missed` gộp số lần lỡ và áp dụng misfire policy. Lịch sử giữ `SCHEDULER_HISTORY_RETENTION_DAYS`
  (task `scheduler.history-prune` dọn chỉ mục mỗi giờ); số đo tổng hợp `sch.*` qua telemetry.
- Monitor nền trong API (mỗi 15s, lock Redis): mất heartbeat, lỗi liên tiếp, nhiều lần lỗi trong 1 giờ, chạy lâu bất
  thường (có thể bị treo — không tự huỷ), lỡ lịch, quá hạn, chạy chồng, chạy trùng, lock lỗi, trễ bắt đầu cao, cấu hình
  sai; lần chạy của instance đã chết → `failed / Interrupted`. Ngưỡng: `SCHEDULER_*`.
- Thao tác (bật/tắt bằng env, audit + sự kiện): Run Now (gửi lệnh tới runtime qua Redis, tôn trọng overlap policy),
  Enable / Disable (giữ định nghĩa task, không huỷ lần đang chạy). Không có sửa / xoá lịch.
- API: `GET /ops/scheduler/{overview,metrics,tasks[/:id[/executions]],executions[/:id],upcoming,timeline,failures,
  events,operations,config,cron}`, `POST /ops/scheduler/tasks/:id/{run,enable,disable}`.

### Jobs (System Console → Jobs)
- Worker & Queue trả lời "queue nào nghẽn, worker nào quá tải"; Jobs trả lời "job cụ thể nào có vấn đề": được tạo từ đâu,
  chờ bao lâu, worker nào xử lý, chạy bao lâu, retry mấy lần, vì sao lỗi, retry / huỷ được không.
- Publisher ghi metadata vào envelope: nguồn (HTTP request / lần chạy Scheduler / job cha / CLI / hệ thống — lấy từ
  request context), request ID, idempotency key, field nghiệp vụ được index và schema (`publish(topic, payload, queue,
  { idempotencyKey, index: { orderId }, schema, delayMs, priority })`). Chỉ mục Redis `jobs:idx:*` (TTL
  `JOBS_INDEX_RETENTION_DAYS`) cho tìm theo correlation / request / idempotency / `field=value` mà không quét payload.
- Consumer (`MessageConsumerRunner`): handler chạy trong context có `jobId` (log worker lọc được theo job), vòng đời mỗi
  lần thử ghi vào job log (instance, loại lỗi, retryable, dependency). Lỗi nghiệp vụ nên ném `JobError(type, message,
  { retryable, dependency })` — `retryable: false` không bị retry vô ích và Console tắt nút Retry. Tiến độ:
  `reportJobProgress(job, { processed, total, step, phases })` (không báo → Console không hiện %).
- Huỷ: job chưa chạy → xoá khỏi queue, giữ bản ghi Cancelled (`JOBS_CANCELLED_RETENTION_DAYS`); job đang chạy → yêu cầu
  huỷ hợp tác qua Redis pub/sub tới worker đang giữ job (BullMQ `cancelJob` → AbortSignal), chỉ khi processor khai báo
  `cancellable = true`. Không kill process. Stalled = job active mất khoá (không heartbeat); chạy lâu = vẫn heartbeat
  nhưng vượt `JOBS_LONG_RUNNING_*`.
- Thao tác (bật/tắt bằng env, audit + sự kiện): Retry, Retry nhiều job lỗi đã chọn (tối đa `OPS_JOBS_BULK_RETRY_MAX`),
  Cancel, Remove record (mặc định tắt), xem payload đã redact.
- API: `GET /ops/jobs` (lọc `status, queue, type, search, window, worker, source, minAttempts, minDurationMs, errorType,
  priority`, phân trang `cursor` + `limit`), `GET /ops/jobs/{overview,metrics,failures,report,events,operations,config}`,
  `GET /ops/jobs/:id[/attempts|/events|/payload]`, `POST /ops/jobs/:id/{retry,cancel}`, `POST /ops/jobs/retry`,
  `DELETE /ops/jobs/:id`.

### Logs (System Console → Logs)
- Investigation Center: tổng quan (volume, error, spike, nguồn / level / module), Explorer (tìm có cú pháp
  `level:error source:worker jobId:… status:5xx "cụm từ"`, dán một ID bất kỳ, More Filters, live tail với rolling buffer,
  Pause vẫn đếm log mới, cursor "Load older"), nhóm lỗi, trace theo correlation, audit hợp nhất, cấu hình.
- `CoreLoggerService` ghi log có cấu trúc: message + metadata + ngữ cảnh từ request context (correlation, request, job,
  message, lần chạy Scheduler, user) + lỗi (loại, mã, stack, fingerprint). Dữ liệu nhạy cảm (tên field như `password`,
  `authorization`… và mẫu trong chuỗi: Bearer, JWT, mật khẩu trong URL, `key=value`) bị che **trước** khi ghi console hay
  Redis. Nên log `logger.error({ message: 'Job processing failed', jobId, queue, attempt }, err.stack, 'ReportProcessor')`
  thay vì `JSON.stringify(object)`. `LOG_FORMAT=json` cho collector stdout.
- Lưu trữ: ring buffer Redis mỗi runtime (`RUNTIME_LOG_RETENTION`) — trang nói rõ tìm kiếm lịch sử có giới hạn; volume theo
  level / module / nhóm lỗi đo bằng telemetry (giữ 8 ngày); nhóm lỗi = loại lỗi + module + message chuẩn hoá + khung stack.
  Log bị mất (buffer đầy / Redis lỗi) được đếm và báo.
- Level tạm thời: `PUT /ops/logs/level { runtime, level, durationMin, modules? }` — runtime áp dụng trong 5 giây, tự hết
  hạn (có thể chỉ cho vài module), có audit; `DELETE /ops/logs/level/:runtime` trả lại.
- API: `GET /ops/logs` (lọc + `cursor`), `/ops/logs/{overview,metrics,tail,export,errors,errors/:fp,trace/:id,audit,report,
  config}`, `/ops/logs/entries/:id`. Màn khác mở Logs đã lọc qua URL: `logs/explorer?jobId=…` / `?correlationId=…`.

### Response Envelope chuẩn hóa
```json
{ "success": true, "statusCode": 200, "data": {}, "timestamp": "..." }
{ "success": false, "statusCode": 404, "error": { "code": "...", "message": "..." } }
```

---

## Tài Liệu Thêm

- [`.agents/AGENTS.md`](.agents/AGENTS.md) — Hướng dẫn đầy đủ cho AI Assistant & Developer
- [`backend/test/README.md`](backend/test/README.md) — Kiến trúc & quy chuẩn test

---

## Giấy Phép

ISC License
