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
