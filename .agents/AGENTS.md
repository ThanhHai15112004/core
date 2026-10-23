# AGENTS.md — Quy Chuẩn & Bản Đồ Điều Hướng Kỹ Thuật (Core Chassis)

Đặc tả đầy đủ (cây thư mục, 15 packages, 4 runtimes, CLI, System Console) lưu tại [architecture-spec.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/references/architecture-spec.md) (chỉ đọc On-Demand).

## 1. HÀM DÙNG CHUNG & MODULE NỀN TẢNG (BẮT BUỘC TÁI SỬ DỤNG)

### 1.1. Tiện ích tại `backend/src/packages/`
- **`@packages/kernel`**:
  - `utils/json.util.ts`: `safeJsonParse`, `safeJsonParseList`, `safeJsonParseObject`, `safeJsonParseStringArray`.
  - `utils/format.util.ts`: `formatBytes`, `maskEmail`, `maskPhone`.
  - `utils/spreadsheet.util.ts`: `parseSpreadsheetBuffer`, `buildCsvBuffer`, `buildXlsxBuffer`, `normalizeHeaderKey`.
  - `utils/slug.util.ts`, `utils/string.util.ts`, `utils/manifest-scanner.util.ts`: `scanModuleManifests`, `discoverInstalledModules`.
  - `contracts/`: `CodeRegistryService`, `SettingRegistryService`, `FeatureFlagRegistryService`, `SequenceRegistryService`, `MenuRegistryService`, `AppException` (`BadRequestAppException`, `NotFoundAppException`, `ConflictAppException`, `ForbiddenAppException`...).
- **`@packages/http`**:
  - `utils/query-list.util.ts`: `isPrintableString`, `optionalQueryParam`, `booleanQueryParam`, `csvQueryParam`, `parseListQuery`, `parseOrThrow`, `formatZodIssues`.
  - `utils/capture.ts`: `maskIp`, `maskEmails`, `redactPayload`, `extractRequestContext`.
  - `utils/validation.util.ts`: `stripDisallowedFields`, `findDisallowedFields`, `applyUnknownFieldPolicy`.
- **`@packages/security`**: `PasswordHasherService` (`hashPassword`, `verifyPassword`, `hashSha256Hex`, `safeEqualHex`), `FieldEncryptionService`, `TokenService`, `DataScopeService`, `PlatformSecurityService`.
- **`@packages/database` & `@packages/cache`**: `BaseRepository`, `TransactionManager` (`runInTransaction`), `BaseCacheProvider`.

### 1.2. Module Nền Tảng tại `backend/src/modules/` (Cấm tạo bảng/module trùng)

| Module | Bảng DB sở hữu | Service / Registry xuất khẩu | Trách nhiệm cốt lõi |
| :--- | :--- | :--- | :--- |
| **`organizations`** | `organization_units` | `OrganizationsService`, `ORGANIZATIONS_PUBLIC_SERVICE` | Cây đơn vị (`parentId`, `path`), chống vòng lặp, chặn xóa khi còn con/nhân sự. |
| **`roles`** | `roles`, `permissions`, `role_permissions` | `RolesService`, `ROLES_PUBLIC_SERVICE`, `DataScopeService`, `AuditLogService` | RBAC, đồng bộ quyền từ `module.manifest.json`, Data Scope (`ALL`, `ORG_UNIT`, `SUBORDINATES`, `SELF`), Audit Log bất biến. |
| **`users`** | `users`, `user_roles`, `user_organization_units`, `user_status_histories` | `UsersService`, `USERS_PUBLIC_SERVICE` | Hồ sơ user, đa vai trò, đa đơn vị (1 đơn vị chính), lịch sử trạng thái, Import/Export CSV & XLSX. |
| **`auth`** | `auth_sessions`, `auth_mfa_configs`, `auth_password_resets`, `auth_login_histories`, `auth_security_settings`, `auth_service_accounts` | `AuthService`, `SecuritySettingsService` | JWT + Refresh Token rotation, MFA (TOTP, Email OTP, Recovery Code), password policy, lockout, Service Account / API Key. |
| **`codes`** | `code_types`, `code_values` | `CodeRegistryService`, `CodesService`, `CODES_PUBLIC_SERVICE` | Danh mục động & Hybrid Enum (`numericCode`, `code`, `behaviorCode`, `labels` đa ngôn ngữ, `aliases`). Khai báo `"codeTypes"` trong `module.manifest.json`. |
| **`settings`** | `setting_groups`, `system_settings`, `system_setting_scopes`, `system_setting_histories`, `feature_flags`, `feature_flag_histories`, `i18n_locales`, `i18n_timezones`, `i18n_translations`, `sequence_rules`, `sequence_counters`, `sequence_rule_histories`, `menus` | `Setting/FeatureFlag/Sequence/MenuRegistryService`, `Settings/FeatureFlags/I18nManagement/Sequences/MenusService`, `*_PUBLIC_SERVICE` | Cấu hình động 5 tầng (`AES-256-GCM`), Feature Flags (User/Role/OrgUnit/Rollout %/Time window), Đa ngôn ngữ & Múi giờ, Sinh mã tự động (`NEVER`/`YEARLY`/`MONTHLY`/`DAILY`, `scopeByUnit`, `preview`), Cây Menu động (`SIDEBAR`/`TOPBAR`/`FOOTER`/`SYSTEM_CONSOLE`, `GROUP`/`ITEM`/`EXTERNAL`/`ACTION`, cache L1/L2). Khai báo qua `module.manifest.json`. |
| **`health` & `*-ops`** | *(Không tạo bảng nghiệp vụ)* | `HealthModule`, `System/Database/Cache/Queue/Worker/Scheduler/LogsOpsModule` | Healthcheck (`/health`) & API vận hành System Console (`/ops/*`). |

> **⚠️ Phân biệt 4 cơ chế cấu hình & Quét Manifest**:
> 1. **`@packages/config` (`CoreConfigService`)**: Biến `.env` tĩnh lúc khởi động hạ tầng (DB, Redis, JWT).
> 2. **`modules/codes` (`CodeRegistryService`)**: Danh mục lựa chọn/Trạng thái/Phân loại (`numericCode`, nhãn `vi`/`en`).
> 3. **`modules/settings` (`SettingRegistryService`)**: Tham số vận hành runtime theo Env/Đơn vị, mã hóa Secret & lưu lịch sử.
> 4. **`FeatureFlags` (`FeatureFlagRegistryService`)**: Bật/tắt tính năng của module đã cài (`enabledModules`) theo User/Role/OrgUnit/Rollout %/Time window.
> 5. **Quét `module.manifest.json`**: Bắt buộc dùng `scanModuleManifests()` / `discoverInstalledModules()` (`@packages/kernel`), cấm tự viết `readdirSync`/`readFileSync`.

## 2. NGUYÊN TẮC KIẾN TRÚC BẤT BIẾN (INVIOLABLE RULES)

1. **Domain-Agnostic Core**: `packages/` chỉ chứa hạ tầng kỹ thuật. **CẤM** đặt Entity/logic nghiệp vụ vào `packages/`. Nghiệp vụ đặt tại `modules/<tên>/` hoặc `project-modules/<tên>/`.
2. **Modular Monolith (Microservices-Ready)**: CẤM tạo Foreign Key vật lý xuyên module; CẤM inject Repository module khác. Giao tiếp đồng bộ qua Service/Facade tại `index.ts`; bất đồng bộ qua Domain Events.
3. **Test Separation**: **CẤM** đặt `*.spec.ts`, `*.test.ts` trong `src/`. 100% đặt tại `backend/test/` (`fixtures/`, `concerns/`, `unit/`, `feature/`).
4. **ESM & Config Fail-Fast**: Relative import bắt buộc có đuôi `.js`. CẤM đọc `process.env` trực tiếp (dùng `@packages/config` Zod). Build bắt buộc chạy `tsc-alias`. CẤM dùng kiểu `any`.
5. **Envelope & Fastify**: Dùng Fastify (`FastifyReply`/`FastifyRequest`), không dùng Express API. Response chuẩn `{ success, statusCode, data, meta?, timestamp }` (`TransformResponseInterceptor` & `GlobalExceptionFilter`).
6. **Multi-Runtime**: 4 entrypoint độc lập: `apps/api`, `apps/worker`, `apps/scheduler`, `apps/cli`.

## 3. BẢN ĐỒ TRA CỨU TÀI LIỆU (ON-DEMAND — KHÔNG TỰ Ý NẠP TRƯỚC)
- Đặc tả 15 Packages / 4 Runtimes / Console Ops: [architecture-spec.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/references/architecture-spec.md) (skill `system-architecture-overview`).
- Quy chuẩn Manifest, CLI & Ranh giới Module: [core-architecture-standards.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/rules/core-architecture-standards.md) (skill `architecture-codebase`).
- Bẫy lỗi cấm kỵ (Pitfalls): [lessons-learned-and-pitfalls.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/rules/lessons-learned-and-pitfalls.md).
- Các câu lệnh thường dùng (Dev, Test, CLI, Docker, CodeGraph): [common-commands.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/common-commands.md).
