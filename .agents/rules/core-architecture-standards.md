# QUY CHUẨN KIẾN TRÚC & PHÁT TRIỂN CORE (CORE ARCHITECTURE & CODING STANDARDS)

Quy tắc này áp dụng bắt buộc cho toàn bộ AI Assistant và nhà phát triển khi viết code trong dự án Core.

---

## 1. NGUYÊN TẮC THIẾT KẾ BẤT BIẾN (INVIOLABLE PRINCIPLES)

### 1.1. Core độc lập với Nghiệp vụ (Zero Domain Leakage)
- Tầng hạ tầng Core nằm tại `backend/src/packages/` bao gồm:
  - `kernel/`: Interface, Base classes, Utilities dùng chung.
  - `config/`: Nạp và kiểm tra tính hợp lệ của biến môi trường bằng Zod schema.
  - `logging/`: Structured logging (Pino) và Request Tracing.
  - `security/`: JWT, Password hashing, Auth Guards, Decorators.
- **CẤM TUYỆT ĐỐI**: Không đưa bất kỳ thực thể nghiệp vụ (User, Order, Product, Lesson, Payment...) hay logic nghiệp vụ cụ thể vào `packages/`.
- Khi cần phát triển một nghiệp vụ mới ("src mới"): Tạo module độc lập trong `backend/src/project-modules/<ten-nghiep-vu>/` hoặc `backend/src/modules/`.

### 1.2. Mở rộng thông qua Interface & Inversion of Control (IoC)
- Core cung cấp các interface (ví dụ: `IStorageProvider`, `IMailerProvider`, `IEventDispatcher`).
- Nghiệp vụ hoặc module adapter cài đặt (implement) các interface này.
- Không hardcode các dịch vụ bên thứ ba (AWS S3, SendGrid, Firebase...) trực tiếp vào lõi kernel.

### 1.3. Chuẩn Modular Monolith sẵn sàng Microservices (Microservices-Ready)
Mỗi module trong `backend/src/modules/<tên-module>/` đại diện cho một **Bounded Context tự chủ**:
1. **Cô lập dữ liệu (Data Isolation)**:
   - CẤM TUYỆT ĐỐI tạo Foreign Key vật lý giữa các bảng của 2 module khác nhau trong Database.
   - Chỉ lưu ID tham chiếu (ví dụ: `order.userId`).
2. **Giao tiếp phân tách (Decoupled Communication)**:
   - Module A KHÔNG ĐƯỢC inject Repository hoặc truy vấn trực tiếp bảng của Module B.
   - Giao tiếp đồng bộ chỉ qua `<Module>Facade` được xuất khẩu qua `index.ts`.
   - Ưu tiên giao tiếp bất đồng bộ qua Domain Events (`events/`) để khi chuyển sang RabbitMQ/Kafka không phải sửa code nghiệp vụ.
3. **Transport-Agnostic**:
   - Controller chỉ là lớp adapter (HTTP/gRPC/MessagePattern). Logic nghiệp vụ nằm gọn trong Service.

### 1.4. Chuẩn Module Manifest, Project Manifest & Core CLI
Để đảm bảo mỗi module là một Bounded Context tự chủ, sẵn sàng bóc tách thành Microservice độc lập mà không cần refactor:
1. **Module Manifest (`module.manifest.json`)**:
   - Mọi module tại `modules/<tên-module>/` hoặc `project-modules/<tên-module>/` BẮT BUỘC phải sở hữu tệp `module.manifest.json` (tham khảo: `backend/src/modules/health/module.manifest.json`).
   - Định nghĩa toàn vẹn định danh (`name`, `displayName`, `version`), loại module (`type: "core" | "project"`), `description`, danh sách `dependencies` (các module Core phụ thuộc), `permissions` (mã quyền nghiệp vụ), `events` (`publishes` & `subscribes`), và `database` (`entities`, `migrations`, `seeders`).
   - Định kiểu qua interface `ModuleManifest` (`@packages/kernel`), kiểm tra runtime bằng Zod schema (`packages/kernel/schemas/manifest.schema.js`) và hỗ trợ IDE intellisense qua JSON schema (`packages/kernel/schemas/module.manifest.schema.json`).
2. **Project Manifest (`project.manifest.json`)**:
   - Tệp tại gốc `backend/project.manifest.json` lưu trữ cấu hình toàn dự án và danh sách các module đang kích hoạt (`enabledModules`).
   - Tương tác kích hoạt module thông qua CLI: `npm run cli -- module:add <name>`.
3. **Core CLI Quản trị & Diagnostics (`npm run cli -- <command>`)**:
   - `npm run cli -- module:create <name>`: Tự động scaffold module mới với 11 tệp chuẩn kiến trúc kèm `module.manifest.json`.
   - `npm run cli -- module:add <name>`: Kiểm tra và kích hoạt module vào `project.manifest.json`.
   - `npm run cli -- module:list`: Liệt kê tất cả module phát hiện được và trạng thái kích hoạt.
   - `npm run cli -- doctor`: Kiểm tra toàn diện sức khỏe hệ thống (Node, ENV, Database, Redis, Manifests).
   - `npm run cli -- migration:check`: Kiểm tra trạng thái các bản di trú TypeORM (hỗ trợ cờ `--run`).
   - `npm run cli -- arch:check`: Kiểm tra tĩnh 4 quy tắc kiến trúc (Cross-Module Isolation, Packages Purity, No Tests in `src/`, Circular Dependencies).

### 1.5. Ranh giới giữa `@packages/config`, `modules/codes` và `modules/settings` (Chống lặp code)
Khi một module nghiệp vụ mới cần khai báo tham số hoặc danh mục, **BẮT BUỘC** chọn đúng 1 trong 3 cơ chế có sẵn dưới đây, tuyệt đối không tự tạo bảng hoặc service mới trùng lặp:
1. **`@packages/config` (`CoreConfigService`) — Cấu hình Hạ tầng Tĩnh (Boot-time `.env`)**:
   - Chỉ dùng cho thông số kết nối hạ tầng cần thiết để khởi động tiến trình (Host/Port của DB, Redis, Queue, JWT Secret, Storage bucket).
   - Không lưu vào Database, không thay đổi lúc runtime.
2. **`modules/codes` (`CodeRegistryService` & `CodesService`) — Danh mục Động & Hybrid Enum (`code_types`, `code_values`)**:
   - Dùng cho các tập hợp giá trị lựa chọn (Dropdown, Trạng thái `status`, Phân loại `type`, Cấp độ `level`...).
   - Mỗi phần tử có `numericCode` (`int` lưu trong bảng nghiệp vụ để tối ưu index), `code` (`string`), `behaviorCode` (neo logic hệ thống), `labels` đa ngôn ngữ (`vi`/`en`) và `aliases` (phục vụ đối sánh khi Import Excel/CSV).
   - Cách mở rộng: Khai báo mảng `"codeTypes"` trong `module.manifest.json` của module và gọi `CodeRegistryService` (`@packages/kernel`) để tra cứu/validate.
3. **`modules/settings` (`SettingRegistryService` & `SettingsService`) — Cấu hình Vận hành Động Đa Tầng (`setting_groups`, `system_settings`, `system_setting_scopes`, `system_setting_histories`)**:
   - Dùng cho các tham số điều khiển hành vi hệ thống có thể thay đổi lúc runtime bởi Admin (ví dụ: `security.password.min_length`, `file.upload.max_size_mb`, `email.smtp.host`, `email.smtp.password`, `ui.theme.default_mode`).
   - Hỗ trợ 4 kiểu dữ liệu có validate trước khi lưu (`TEXT`, `NUMBER`, `BOOLEAN`, `JSON`), phân giải 5 tầng (`UNIT_ENV -> UNIT_ALL -> GLOBAL_ENV -> GLOBAL -> DEFAULT`), tự động mã hóa `AES-256-GCM` & che `'••••••••'` cho biến nhạy cảm (`isSensitive: true`), lưu lịch sử người thay đổi (`system_setting_histories`) và Cache 2 tầng (L1 + L2).
   - Cách mở rộng: Khai báo `"settingGroups"` và `"settings"` trong `module.manifest.json` của module; đọc giá trị trong code qua `SettingRegistryService` (`getNumber`, `getBoolean`, `getString`, `getJson`, `resolve`) hoặc `SettingsService.getDecryptedValue()` (đối với secret).
4. **`modules/settings` (`FeatureFlagRegistryService` & `FeatureFlagsService`) — Bật/Tắt Tính năng & Rollout (`feature_flags`, `feature_flag_histories`)**:
   - Dùng để bật/tắt chức năng của các module đã được cài đặt (`enabledModules` trong `project.manifest.json` — không dùng flag thay cho việc cài module).
   - Hỗ trợ nhắm mục tiêu theo người dùng (`targetUserIds`), vai trò (`targetRoles`), đơn vị tổ chức (`targetOrganizationUnitIds`), rollout dần theo tỷ lệ phần trăm (`rolloutPercentage` $0..100\%$ dùng deterministic FNV-1a hash), tự động đóng tính năng thử nghiệm theo khung thời gian (`startsAt` / `endsAt`) và ghi lịch sử thay đổi (`feature_flag_histories`).
   - Cách mở rộng: Khai báo mảng `"featureFlags"` trong `module.manifest.json` của module; kiểm tra trong code qua `FeatureFlagRegistryService.isEnabled(key, context)` hoặc `FeatureFlagsService.evaluate(key, context)`.
5. **Hàm quét Manifest dùng chung (`scanModuleManifests` & `discoverInstalledModules`)**:
   - Mọi tính năng cần quét `module.manifest.json` của các module (`permissions`, `codeTypes`, `settingGroups`, `settings`, `featureFlags`...) bắt buộc gọi `scanModuleManifests()` từ `@packages/kernel`, không viết lặp lại vòng lặp đọc thư mục `src/modules` / `src/project-modules`.

---

## 2. QUY CHUẨN KỸ THUẬT TYPESCRIPT & ESM

### 2.1. Chuẩn ESM NodeNext
Dự án được cấu hình với `"module": "NodeNext"` và `"moduleResolution": "NodeNext"`.
- **Quy tắc relative import**: Mọi import tương đối trỏ tới file `.ts` nội bộ PHẢI thêm đuôi `.js`:
  ```typescript
  // ĐÚNG
  import { KernelService } from './kernel.service.js';
  import { AppConfig } from '../config/app.config.js';

  // SAI (TypeScript compiler sẽ báo lỗi TS2835 hoặc Node sẽ crash lúc runtime)
  import { KernelService } from './kernel.service';
  ```
- **Quy tắc Path Aliases**: Được phép sử dụng alias đã cấu hình trong `tsconfig.json`:
  - `@apps/*` trỏ tới `src/apps/*`
  - `@packages/*` trỏ tới `src/packages/*`
  - `@modules/*` trỏ tới `src/modules/*`
  - `@project-modules/*` trỏ tới `src/project-modules/*`
  *(Lưu ý: Sau khi biên dịch `tsc`, lệnh `tsc-alias` sẽ tự động chuyển các alias này về đường dẫn thực tế).*

### 2.2. Strict Type Safety
- **CẤM** sử dụng kiểu dữ liệu `any`. Thay vào đó, sử dụng `unknown` kết hợp type narrowing / Zod validation.
- Với các thuộc tính mảng hoặc object dictionary có thể undefined do `noUncheckedIndexedAccess`, phải kiểm tra tồn tại hoặc dùng optional chaining `?.`.

---

## 3. QUY CHUẨN NESTJS + FASTIFY

### 3.1. Phân biệt Fastify vs Express
Dự án sử dụng adapter `@nestjs/platform-fastify`. Do đó:
- **KHÔNG** sử dụng API của Express: Không gọi `res.send()`, `res.json()`, `res.status()`.
- Sử dụng NestJS response hoặc đối tượng của Fastify (`FastifyReply`, `FastifyRequest`).
- Không cài đặt hoặc phụ thuộc vào middleware chỉ chạy trên Express mà không có Fastify plugin tương ứng.

### 3.2. Cấu hình tinh gọn theo phong cách Laravel (Flat Config — No Overthinking)
- Cấu trúc thư mục `@packages/config` được tổ chức phẳng và trực quan theo từng domain (như `config/*.php` của Laravel):
  `app.config.ts`, `database.config.ts`, `auth.config.ts`, `cache.config.ts`, `storage.config.ts`.
- Sử dụng helper `env('KEY')`, `env.number('KEY')`, `env.boolean('KEY')` với cơ chế **Fail-Fast**:
  Ném lỗi `[ConfigError]` ngay khi thiếu biến môi trường cần thiết, tuyệt đối không dùng fallback ngầm để tránh che giấu lỗi.
- **NGUYÊN TẮC CHỐNG OVERTHINKING TRONG CONFIG**:
  - Config chỉ làm nhiệm vụ duy nhất: đọc biến từ môi trường và trả về object cấu hình sạch sẽ.
  - **CẤM** tự ý thêm các logic kiểm tra điều kiện phức tạp (như `if (port < 1024)`, `if (maxConnections <= 0)`, `if (secret.length < 32)`).
  - **CẤM** ép ghép chuỗi URL kết nối phức tạp (`DATABASE_URL`, `REDIS_URL`). Luôn sử dụng các biến chuẩn cơ bản, tách biệt, dễ đọc:
    `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, `REDIS_HOST`, `REDIS_PORT`...

### 3.3. Chuẩn hóa Vỏ bọc API (API Response Envelope)
Mọi endpoint HTTP trả về dữ liệu đều phải đi qua `TransformInterceptor` để bọc payload chuẩn:
```typescript
{
  success: boolean,
  statusCode: number,
  data: T,
  meta?: PaginationMeta,
  timestamp: string
}
```
Mọi ngoại lệ (Exception) phải được bắt bởi `GlobalExceptionFilter` để trả về định dạng lỗi đồng nhất, không làm lộ stack trace nội bộ ra môi trường production.

---

## 4. QUY CHUẨN KIẾN TRÚC KIỂM THỬ (TESTING ARCHITECTURE)

Dự án áp dụng quy chuẩn phân tầng kiểm thử chuyên nghiệp (mô phỏng theo cấu trúc test của hệ thống Coaching):

### 4.1. Cách ly tuyệt đối: Không để file Test trong `src/`
- Thư mục `backend/src/` **CHỈ CHỨA PRODUCTION CODE**.
- **CẤM TUYỆT ĐỐI** tạo bất kỳ file `*.spec.ts`, `*.test.ts`, `*.feature-spec.ts` nào rải rác bên trong `src/`.

### 4.2. Cấu trúc thư mục `backend/test/`
```text
backend/test/
├── fixtures/        # Dữ liệu mẫu, env mock phục vụ test (vd env.fixture.ts)
├── concerns/        # Helper/Traits khởi tạo môi trường test (vd test-app.concern.ts)
├── unit/            # Pure unit tests cô lập (config, services, utils)
├── feature/         # Feature/API tests kiểm thử endpoint qua Fastify inject (feature/api/...)
└── README.md        # Hướng dẫn chi tiết quy chuẩn kiểm thử
```

### 4.3. Các lệnh kiểm thử (WSL2 / Linux Bash)
- `npm test`: Chạy toàn bộ test suite (với cờ `--runInBand` cho Node.js 22 ESM).
- `npm run test:unit`: Chạy riêng các bài kiểm thử Unit.
- `npm run test:feature`: Chạy riêng các bài kiểm thử Feature / API.

---

## 5. MÔI TRƯỜNG THỰC THI & QUY TRÌNH KIỂM TRA TRƯỚC KHI BÀN GIAO

- **Môi trường**: Linux WSL2 Ubuntu, shell `bash` trực tiếp. Không sử dụng `cmd.exe` hay `powershell.exe`.
- **Quy trình kiểm tra toàn diện bắt buộc**:
  Trước khi bàn giao hoặc tạo commit, BẮT BUỘC chạy `npm run check` (hoặc `npm --prefix backend run check`), bao gồm:
  1. `npm run lint`: Đảm bảo 100% không lỗi ESLint/Prettier.
  2. `npm run typecheck`: Đảm bảo 100% không lỗi TypeScript.
  3. `npm run test`: Toàn bộ Unit và Feature tests đều xanh.
  4. `npm run build`: Biên dịch TypeScript và `tsc-alias` hoàn tất không lỗi.
- Đảm bảo tuân thủ Conventional Commits (ví dụ: `feat: ...`, `fix: ...`, `refactor: ...`, `chore: ...`).
