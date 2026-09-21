# Backend — Core Framework

Backend API Server xây dựng trên **NestJS 11 + Fastify**, theo kiến trúc **Modular Monolith hướng Microservices**.

---

## Cấu Trúc Thư Mục `src/`

```text
src/
├── apps/                          # 4 Runtime entrypoints — độc lập hoàn toàn
│   ├── api/                       # HTTP API Server
│   │   ├── main.ts                #   Entrypoint
│   │   ├── api.module.ts          #   Root module (import tất cả packages + modules)
│   │   └── bootstrap/             #   Các bước khởi tạo (server, cors, prefix...)
│   ├── worker/                    # Message Queue Consumer
│   │   ├── main.ts
│   │   ├── worker.module.ts
│   │   ├── bootstrap/
│   │   └── processors/system/     #   Scaffold — thêm processor nghiệp vụ tại đây
│   ├── scheduler/                 # Cron Task Runner
│   │   ├── main.ts
│   │   ├── scheduler.module.ts
│   │   ├── bootstrap/
│   │   └── tasks/system/          #   Scaffold — thêm cron task tại đây
│   └── cli/                       # CLI Command Tool
│       ├── main.ts
│       ├── cli.module.ts
│       ├── bootstrap/
│       └── commands/system/       #   Scaffold — thêm CLI command tại đây
│
├── packages/                      # Core hạ tầng — Domain-Agnostic, KHÔNG chứa nghiệp vụ
│   ├── kernel/                    # Tầng thấp nhất — base class, contract, type
│   │   ├── base/                  #   BaseEntity, BaseValueObject
│   │   ├── contracts/             #   ManageablePackage, IRepository, IUseCase
│   │   ├── errors/                #   AppException, DomainException
│   │   └── types/                 #   Result<T,E>, DatabaseDriverEnum, ManageablePackageEnum
│   ├── config/                    # Đọc .env với Fail-Fast (env() helper)
│   │   ├── app.config.ts          #   PORT, HOST, APP_NAME, API_PREFIX
│   │   ├── auth.config.ts         #   JWT secrets, expiration
│   │   ├── cache.config.ts        #   Redis host/port/prefix
│   │   ├── database.config.ts     #   DB_CONNECTION, host, port, database...
│   │   ├── storage.config.ts      #   STORAGE_DRIVER, STORAGE_LOCAL_PATH
│   │   ├── env.ts                 #   Hàm env(), env.number(), env.boolean()
│   │   └── config.service.ts      #   CoreConfigService — inject vào toàn hệ thống
│   ├── http/                      # HTTP/Fastify dùng chung (inbound)
│   │   ├── filters/               #   GlobalExceptionFilter
│   │   ├── interceptors/          #   TransformResponseInterceptor (chuẩn hóa response)
│   │   ├── decorators/            #   @Public() — bypass AuthGuard
│   │   └── exceptions/            #   BadRequestException
│   ├── database/                  # TypeORM multi-driver (mysql/pgsql/mssql/sqlite)
│   │   ├── providers/             #   TypeOrmConfigService, DatabaseProvider, DatabaseManageableAdapter
│   │   ├── contracts/             #   IDatabaseContract
│   │   └── transaction/           #   IUnitOfWork contract
│   ├── logging/                   # Structured logging (Pino)
│   │   ├── context/               #   RequestContextService (correlation-id)
│   │   ├── interceptors/          #   LoggingInterceptor
│   │   ├── middleware/            #   CorrelationIdMiddleware
│   │   ├── providers/             #   LoggerService, LoggingManageableAdapter
│   │   ├── redaction/             #   redact.util.ts — che dữ liệu nhạy cảm
│   │   └── constants/             #   Logging constants
│   ├── security/                  # JWT Auth + Secret Management
│   │   ├── guards/                #   AuthGuard (APP_GUARD toàn hệ thống)
│   │   ├── strategies/            #   JwtStrategy (bearer token)
│   │   ├── providers/             #   EnvSecretProvider, FileSecretProvider, SecretService, TokenService
│   │   ├── decorators/            #   @CurrentUser()
│   │   ├── constants/             #   SECRET_PROVIDER token
│   │   ├── contracts/             #   ISecretProvider
│   │   └── types/                 #   SecretDriver enum, AuthPayload type
│   ├── messaging/                 # Message Queue publisher (BullMQ/RabbitMQ)
│   │   ├── providers/             #   MessagePublisherProvider
│   │   ├── contracts/             #   IMessagePublisher
│   │   ├── serializers/           #   MessageSerializer
│   │   └── constants/             #   Queue names
│   ├── cache/                     # Redis abstraction
│   │   ├── providers/             #   CacheProvider, CacheManageableAdapter
│   │   └── contracts/             #   ICacheContract
│   ├── storage/                   # Object Storage (local / S3)
│   │   ├── providers/             #   StorageProvider
│   │   └── contracts/             #   IStorageContract
│   ├── http-client/               # Outbound HTTP (gọi API bên ngoài)
│   │   ├── providers/             #   HttpClientProvider
│   │   ├── interceptors/
│   │   └── contracts/
│   └── i18n/                      # Internationalization
│       ├── resolvers/             #   Đọc Accept-Language header
│       ├── formatters/            #   Định dạng ngày/số theo locale
│       ├── providers/
│       └── locales/vi|en/         #   Bản dịch chuỗi dùng chung (không thuộc module nào)
│
├── modules/                       # Modules nghiệp vụ dùng chung (Bounded Context)
│   ├── health/                    # Health check endpoint
│   │   ├── controllers/           #   GET /api/v1/health
│   │   └── services/              #   HealthService
│   └── system-ops/                # Dashboard quản trị hạ tầng
│       ├── controllers/           #   GET|POST /api/v1/ops/packages/*
│       ├── services/              #   PackageRegistryService
│       └── constants/             #   Route constants
│
└── project-modules/               # ← THÊM NGHIỆP VỤ MỚI VÀO ĐÂY
    └── .gitkeep                   #   Cắm module nghiệp vụ của dự án vào thư mục này
```

---

## Scripts

```bash
# Development (watch mode)
npm run dev:api          # HTTP API Server
npm run dev:worker       # Worker runtime
npm run dev:scheduler    # Scheduler runtime

# Production
npm run build            # tsc + tsc-alias → dist/
npm run start:api        # node dist/apps/api/main.js
npm run start:worker     # node dist/apps/worker/main.js
npm run start:scheduler  # node dist/apps/scheduler/main.js
npm run cli              # node dist/apps/cli/main.js

# Kiểm tra chất lượng
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint + auto-fix
npm run format           # Prettier
npm test                 # Tất cả tests
npm run test:unit        # Chỉ unit tests
npm run test:feature     # Chỉ feature/API tests
npm run test:cov         # Tests + coverage report
npm run check            # lint + typecheck + test + build (CI)
```

---

## Biến Môi Trường

Tạo file từ mẫu:
```bash
cp .env.example .env.development
```

| Biến | Mô tả | Bắt buộc |
| :--- | :---- | :-------: |
| `NODE_ENV` | `development` \| `production` \| `test` | ✅ |
| `PORT` | Cổng API server | ✅ |
| `HOST` | Bind host (`0.0.0.0`) | ✅ |
| `APP_NAME` | Tên ứng dụng | ✅ |
| `API_PREFIX` | Prefix route (`api/v1`) | ✅ |
| `DB_CONNECTION` | `mysql` \| `pgsql` \| `mssql` \| `sqlite` | ✅ |
| `DB_HOST` | Database host | ✅ |
| `DB_PORT` | Database port | ✅ |
| `DB_DATABASE` | Tên database | ✅ |
| `DB_USERNAME` | Database user | ✅ |
| `DB_PASSWORD` | Database password | ✅ |
| `REDIS_HOST` | Redis host | ✅ |
| `REDIS_PORT` | Redis port | ✅ |
| `REDIS_PREFIX` | Key prefix cho Redis | ✅ |
| `JWT_ACCESS_SECRET` | JWT secret access (≥ 32 ký tự) | ✅ |
| `JWT_REFRESH_SECRET` | JWT secret refresh (≥ 32 ký tự) | ✅ |
| `JWT_ACCESS_EXPIRATION` | Thời hạn access token (`15m`) | ✅ |
| `JWT_REFRESH_EXPIRATION` | Thời hạn refresh token (`7d`) | ✅ |
| `STORAGE_DRIVER` | `local` \| `s3` | ✅ |
| `STORAGE_LOCAL_PATH` | Đường dẫn lưu file local | ✅ |
| `SECRET_DRIVER` | `env` (mặc định) \| `file` | ❌ |
| `DB_SYNCHRONIZE` | Tự đồng bộ schema (`false` cho prod) | ❌ |
| `DB_LOGGING` | Bật TypeORM query log | ❌ |

---

## Path Aliases

Khai báo trong `tsconfig.json`, dùng trong mọi import:

```typescript
import { CoreConfigService }    from '@packages/config/index.js';
import { BaseEntity }           from '@packages/kernel/index.js';
import { AuthGuard }            from '@packages/security/index.js';
import { HealthModule }         from '@modules/health/index.js';
import { ApiModule }            from '@apps/api/api.module.js';
```

> ⚠️ **Bắt buộc có đuôi `.js`** trong mọi import (Node.js ESM NodeNext requirement).

---

## Quy Tắc Quan Trọng

1. **`packages/`** = hạ tầng thuần — KHÔNG viết nghiệp vụ vào đây.
2. **`project-modules/`** = nghiệp vụ riêng của dự án — thêm vào đây, đăng ký vào `api.module.ts`.
3. **Foreign Key vật lý** giữa bảng của 2 module khác nhau = CẤM.
4. **`process.env` trực tiếp** trong Service/Controller = CẤM. Dùng `CoreConfigService`.
5. **File test** trong `src/` = CẤM. Đặt trong `test/`.

---

## API Endpoints Sẵn Có

| Method | Endpoint | Mô tả |
| :----- | :------- | :---- |
| `GET` | `/api/v1/health` | Health check — trạng thái hệ thống |
| `GET` | `/api/v1/ops/packages` | Danh sách package + trạng thái tổng quan |
| `GET` | `/api/v1/ops/packages/:packageId` | Chi tiết 1 package |
| `POST` | `/api/v1/ops/packages/:packageId/actions/:actionId` | Thực thi action quản trị |
