# AGENTS.md — Quy Chuẩn & Bản Đồ Điều Hướng Kỹ Thuật (Core Chassis)

Tài liệu này là **Hiến pháp kỹ thuật cốt lõi** dành cho AI Assistants và Developers. Bản đặc tả chi tiết đầy đủ (cây thư mục 300 dòng, đặc tả 15 packages, 4 runtimes, CLI và System Console) được lưu trữ tại [architecture-spec.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/references/architecture-spec.md) để tra cứu theo nhu cầu (On-Demand), giúp tối ưu hóa ngữ cảnh và tiết kiệm token.

> **🚨 QUY TRÌNH 3 BƯỚC BẮT BUỘC TRƯỚC KHI CODE (CẤM NHẢY VÀO VIẾT CODE MỚI NGAY)**:
> 1. **Bước 1 — Đọc Component & Hàm dùng chung trước tiên**: Rà soát các hàm tiện ích tại `@packages/*` (`kernel`, `http`, `security`, `database`, `cache`), các UI Component/Hook dùng chung (`frontend/src/components/`, `hooks/`) và các Module nền tảng đã có trongMục 1 bên dưới.
> 2. **Bước 2 — Kiểm tra & Đối chiếu luồng hiện tại**: Dùng `codegraph` (`explore`, `node`, `query`, `callers`, `callees`, `impact`) kiểm tra code thực tế, đối chiếu theo thứ tự: **`Dùng lại → Kết hợp → Mở rộng → Tách dùng chung (≥ 2 nơi dùng)`**.
> 3. **Bước 3 — Cuối cùng mới được viết mới**: Chỉ tạo hàm/component/logic mới khi Bước 1 & Bước 2 xác nhận chưa có sẵn. Tuyệt đối không viết lại helper cục bộ gây lặp code.

---

## 1. DANH MỤC HÀM DÙNG CHUNG, COMPONENT & MODULE NỀN TẢNG (BẮT BUỘC ĐỌC TRƯỚC TIÊN)

Hệ thống đã triển khai sẵn các tiện ích tại `backend/src/packages/` và các Module Core trong `backend/src/modules/`. **BẮT BUỘC ĐỌC VÀ TÁI SỬ DỤNG** trước khi nghĩ đến việc viết code mới:

### 1.1. Các Hàm & Provider Dùng Chung tại `backend/src/packages/`
- **`@packages/kernel`**:
  - `safeJsonParse`, `safeJsonParseList`, `safeJsonParseObject`, `safeJsonParseStringArray` (`utils/json.util.ts`).
  - `formatBytes`, `maskEmail`, `maskPhone` (`utils/format.util.ts`).
  - `parseSpreadsheetBuffer`, `buildCsvBuffer`, `buildXlsxBuffer`, `normalizeHeaderKey` (`utils/spreadsheet.util.ts`).
  - `scanModuleManifests`, `discoverInstalledModules` (`utils/manifest-scanner.util.ts`).
  - `CodeRegistryService`, `SettingRegistryService`, `FeatureFlagRegistryService`, `SequenceRegistryService`, `MenuRegistryService` & hệ thống `AppException` (`contracts/`).
- **`@packages/http`**:
  - `isPrintableString`, `optionalQueryParam`, `booleanQueryParam`, `csvQueryParam`, `parseListQuery`, `parseOrThrow`, `formatZodIssues` (`utils/query-list.util.ts`).
  - `maskIp`, `maskEmails`, `redactPayload`, `extractRequestContext` (`utils/capture.ts`).
  - `stripDisallowedFields`, `findDisallowedFields`, `applyUnknownFieldPolicy` (`utils/validation.util.ts`).
- **`@packages/security`**:
  - `PasswordHasherService` (`hashPassword`, `verifyPassword`, `hashSha256Hex`, `safeEqualHex`), `FieldEncryptionService`, `TokenService`, `DataScopeService`, `PlatformSecurityService`.
- **`@packages/database` & `@packages/cache`**:
  - `BaseRepository`, `TransactionManager` (`runInTransaction`), `BaseCacheProvider`.

### 1.2. Các Module Nền Tảng tại `backend/src/modules/` (Cấm tự ý tạo bảng/module trùng)

| Module (`src/modules/`) | Bảng DB sở hữu | Service / Registry tái sử dụng | Trách nhiệm cốt lõi |
| :--- | :--- | :--- | :--- |
| **`organizations`** | `organization_units` | `OrganizationsService`, `ORGANIZATIONS_PUBLIC_SERVICE` | Cây đơn vị tổ chức/phòng ban/chi nhánh (`parentId`, `path`), kiểm tra vòng lặp, chặn xóa khi còn đơn vị con/nhân sự. |
| **`roles`** | `roles`, `permissions`, `role_permissions` | `RolesService`, `ROLES_PUBLIC_SERVICE`, `DataScopeService`, `AuditLogService` | RBAC, đồng bộ quyền từ `module.manifest.json`, kiểm soát phạm vi dữ liệu (`ALL`, `ORG_UNIT`, `SUBORDINATES`, `SELF`), tra cứu Audit Log bất biến. |
| **`users`** | `users`, `user_roles`, `user_organization_units`, `user_status_histories` | `UsersService`, `USERS_PUBLIC_SERVICE` | Quản lý hồ sơ người dùng, đa vai trò, đa đơn vị (1 đơn vị chính), vòng đời trạng thái, Import/Export CSV & XLSX. |
| **`auth`** | `auth_sessions`, `auth_mfa_configs`, `auth_password_resets`, `auth_login_histories`, `auth_security_settings`, `auth_service_accounts` | `AuthService`, `SecuritySettingsService` | Đăng nhập JWT + Refresh Token rotation, MFA (TOTP, Email OTP, Recovery Code), chính sách mật khẩu, khóa tạm thời, Service Account / API Key. |
| **`codes`** | `code_types`, `code_values` | `CodeRegistryService` (`@packages/kernel`), `CodesService`, `CODES_PUBLIC_SERVICE` | **Từ điển Danh mục Động & Hybrid Enum**: Quản lý các tập giá trị lựa chọn/trạng thái/phân loại (`numericCode`, `code`, `behaviorCode`, `labels` đa ngôn ngữ, `aliases`). Khai báo qua mục `"codeTypes"` trong `module.manifest.json`. |
| **`settings`** | `setting_groups`, `system_settings`, `system_setting_scopes`, `system_setting_histories`, `feature_flags`, `feature_flag_histories`, `i18n_locales`, `i18n_timezones`, `i18n_translations`, `sequence_rules`, `sequence_counters`, `sequence_rule_histories`, `menus` | `SettingRegistryService`, `FeatureFlagRegistryService`, `SequenceRegistryService`, `MenuRegistryService` (`@packages/kernel`), `SettingsService`, `FeatureFlagsService`, `I18nManagementService`, `SequencesService`, `MenusService`, `SETTINGS_PUBLIC_SERVICE`, `FEATURE_FLAGS_PUBLIC_SERVICE`, `I18N_MANAGEMENT_PUBLIC_SERVICE`, `SEQUENCES_PUBLIC_SERVICE`, `MENUS_PUBLIC_SERVICE` | **Cấu hình Hệ thống Động (5.1), Feature Flags (5.2), Đa ngôn ngữ & Múi giờ (5.4), Sinh mã Nghiệp vụ Động (5.5), Quản lý Menu & Điều hướng Động (5.6)**: Quản lý tham số runtime 5 tầng, mã hóa `AES-256-GCM`; quản lý Feature Flag theo User/Role/OrgUnit/Rollout %/Time window; quản lý ngôn ngữ/múi giờ; sinh mã nghiệp vụ tự động (`ORD-2026-000001`) an toàn đồng thời, reset theo kỳ (`NEVER`/`YEARLY`/`MONTHLY`/`DAILY`), tách riêng theo đơn vị (`scopeByUnit`), xem trước mẫu mã (`preview`) & lưu lịch sử thay đổi; quản lý cây menu đa cấp (`parent`, `level`, `numOrder`), phân quyền ẩn/hiện tự động theo `key` (permission/role), vị trí hiển thị (`SIDEBAR`, `TOPBAR`, `FOOTER`, `SYSTEM_CONSOLE`), loại mục (`GROUP`, `ITEM`, `EXTERNAL`, `ACTION`) và cache điều hướng L1/L2 tự động xóa khi thay đổi. Khai báo qua `"settingGroups"`, `"settings"`, `"featureFlags"`, `"locales"`, `"timezones"`, `"sequences"`, `"menus"` trong `module.manifest.json`. |
| **`health` & `*-ops`** | *(Không tạo bảng nghiệp vụ)* | `HealthModule`, `SystemOpsModule`, `DatabaseOpsModule`, `CacheOpsModule`, `Queue/Worker/Scheduler/LogsOps` | Healthcheck (`/health`) và toàn bộ API vận hành cho System Console (`/ops/*`). |

> **⚠️ Phân biệt rõ 4 cơ chế tránh viết chồng chéo (`config` vs `codes` vs `settings` vs `featureFlags`)**:
> 1. **`@packages/config` (`CoreConfigService`)**: Chỉ đọc biến môi trường tĩnh từ `.env` lúc khởi động hạ tầng (DB host, Redis port, JWT secret).
> 2. **`modules/codes` (`CodeRegistryService`)**: Dùng cho **Danh mục lựa chọn / Trạng thái / Phân loại** (Dropdown, Status, Type có mã số nguyên `numericCode` và nhãn `vi`/`en`).
> 3. **`modules/settings` — Settings (`SettingRegistryService`)**: Dùng cho **Tham số cấu hình vận hành thay đổi được lúc chạy (Runtime Settings)** theo Môi trường / Đơn vị hoặc cần mã hóa Secret & ghi lịch sử thay đổi.
> 4. **`modules/settings` — Feature Flags (`FeatureFlagRegistryService` & `FeatureFlagsService`)**: Dùng cho **Bật/Tắt tính năng của module đã cài (`enabledModules`)** theo Người dùng (`targetUserIds`), Vai trò (`targetRoles`), Đơn vị (`targetOrganizationUnitIds`), Tỷ lệ người dùng (`rolloutPercentage` $0..100\%$) và Khung thời gian thử nghiệm (`startsAt`..`endsAt`).
> 5. **Quét `module.manifest.json` tập trung**: Mọi logic đọc danh sách `module.manifest.json` trên đĩa bắt buộc gọi hàm dùng chung `scanModuleManifests()` và `discoverInstalledModules()` từ `@packages/kernel`, không tự viết lại vòng lặp `readdirSync`/`readFileSync`.

---

## 2. NGUYÊN TẮC THIẾT KẾ BẤT BIẾN KHI KIỂM TRA & VIẾT CODE (INVIOLABLE RULES)

1. **Core hoàn toàn độc lập với nghiệp vụ (Domain-Agnostic)**:
   - Tầng hạ tầng kỹ thuật nằm trong `packages/` (`kernel`, `config`, `http`, `database`, `logging`, `metrics`, `runtime`, `security`, `queue`, `messaging`, `cache`, `storage`, `http-client`, `i18n`).
   - **CẤM TUYỆT ĐỐI** viết business logic hoặc đặt Entity nghiệp vụ cụ thể (User, Order, Course...) vào `packages/`.
   - Mọi nghiệp vụ phải nằm trong `modules/<tên-module>/` hoặc `project-modules/<tên-module>/`.

2. **Modular Monolith & Bounded Context tự chủ (Microservices-Ready)**:
   - Mỗi module tự quản lý Entity, DTO, Repository, Service, Controller, Events riêng.
   - **CẤM TUYỆT ĐỐI**: Tạo Foreign Key vật lý xuyên module trong DB; KHÔNG inject Repository của module khác.
   - Giao tiếp đồng bộ chỉ thông qua Service/Facade export tại `index.ts`; ưu tiên giao tiếp bất đồng bộ qua Domain Events.

3. **Vị trí tệp kiểm thử (Test Separation)**:
   - **CẤM TUYỆT ĐỐI** đặt file test (`*.spec.ts`, `*.test.ts`) trong thư mục `src/`.
   - 100% kiểm thử phải đặt tại `test/` theo cấu trúc Coaching (`fixtures/`, `concerns/`, `unit/`, `feature/`).

4. **Quy chuẩn ESM & Config Fail-Fast**:
   - TypeScript ESM (`NodeNext`): relative import nội bộ bắt buộc có đuôi `.js` (vd: `import { x } from './helper.js'`).
   - KHÔNG đọc trực tiếp `process.env`, mọi cấu hình phải qua Zod schema validation tại `packages/config`.
   - Build production bắt buộc chạy `tsc-alias` để xử lý path alias (`@apps/*`, `@packages/*`, `@modules/*`, `@project-modules/*`).

5. **Chuẩn hóa Envelope Response & Exception**:
   - Thành công: `{ success: true, statusCode, data, meta?, timestamp }` (qua `TransformResponseInterceptor`).
   - Thất bại: `{ success: false, statusCode, error: { code, message, details? }, timestamp }` (qua `GlobalExceptionFilter`).

6. **Multi-Runtime Ready**:
   - Hệ thống có 4 entrypoint độc lập: `apps/api` (HTTP Fastify), `apps/worker` (BullMQ Processor), `apps/scheduler` (BullMQ Scheduler), `apps/cli` (CLI tool).

---

## 3. BẢN ĐỒ TRA CỨU TÀI LIỆU & SKILLS (ON-DEMAND REFERENCES)

AI Assistant **chỉ đọc thêm tài liệu/skill chi tiết khi task thực sự yêu cầu**, không tự ý nạp trước:

- **Cấu trúc thư mục chuẩn & Đặc tả chi tiết 15 Packages / 4 Runtimes / Console Ops**:
  👉 Đọc file: [architecture-spec.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/references/architecture-spec.md) hoặc kích hoạt skill `system-architecture-overview`.
- **Quy chuẩn Manifest, CLI & Ranh giới Module**:
  👉 Đọc file: [core-architecture-standards.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/rules/core-architecture-standards.md) hoặc kích hoạt skill `architecture-codebase`.
- **Sổ tay bài học kinh nghiệm & Bẫy lỗi cấm kỵ (Pitfalls)**:
  👉 Đọc file: [lessons-learned-and-pitfalls.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/rules/lessons-learned-and-pitfalls.md).
- **Quy tắc thực thi, phân cấp task & ngân sách kiểm thử**:
  👉 Đọc file: [core-development-rule.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/rules/core-development-rule.md).
- **Sổ tay tổng hợp các câu lệnh thường dùng (Dev, Test, CLI, Docker, CodeGraph)**:
  👉 Đọc file: [common-commands.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/common-commands.md).
- **Đồ thị tri thức mã nguồn (CodeGraph — `.codegraph/codegraph.db`)**:
  👉 Ưu tiên dùng lệnh `codegraph explore`, `codegraph node`, `codegraph query`, `codegraph impact`, `codegraph affected` để tra cứu symbol, luồng gọi (callers/callees) và phân tích tác động thay vì đọc/grep thủ công nhiều tệp; chạy `codegraph sync` sau khi sửa code.

