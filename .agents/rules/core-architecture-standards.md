# QUY CHUẨN KIẾN TRÚC & PHÁT TRIỂN CORE (ON-DEMAND)

## 1. KIẾN TRÚC MODULAR MONOLITH & MANIFEST
1. **Zero Domain Leakage**: `backend/src/packages/` (`kernel`, `config`, `logging`, `security`...) chỉ chứa Abstractions, Interfaces (`IStorageProvider`, `IMailerProvider`, `IEventDispatcher`), Base classes, Utilities. CẤM đặt Entity/logic nghiệp vụ vào `packages/`.
2. **Bounded Context tự chủ (`modules/` & `project-modules/`)**:
   - **Cô lập DB**: CẤM tạo Foreign Key vật lý xuyên module (chỉ lưu ID tham chiếu như `order.userId`).
   - **Giao tiếp**: CẤM inject Repository chéo. Đồng bộ qua `<Module>Facade`/Service tại `index.ts`; bất đồng bộ qua Domain Events (`events/`). Controller chỉ làm transport adapter.
3. **Module Manifest (`module.manifest.json`) & Project Manifest (`backend/project.manifest.json`)**:
   - Mọi module bắt buộc có `module.manifest.json` (`name`, `displayName`, `version`, `type: "core" | "project"`, `dependencies`, `permissions`, `events`, `database`, `codeTypes`, `settingGroups`, `settings`, `featureFlags`, `locales`, `timezones`, `sequences`, `menus`), validate bằng `ModuleManifest` & Zod (`packages/kernel/schemas/manifest.schema.js`).
   - Quét manifest bắt buộc dùng `scanModuleManifests()` & `discoverInstalledModules()` (`@packages/kernel`).
   - CLI quản trị (`npm run cli -- <cmd>`): `module:create <name>`, `module:add <name>`, `module:list`, `doctor`, `migration:check [--run]`, `arch:check`.
4. **Chi tiết 4 cơ chế Cấu hình & Danh mục**:
   - **`@packages/config`**: Biến `.env` tĩnh lúc boot.
   - **`modules/codes`**: `code_types`, `code_values` (`numericCode`, `code`, `behaviorCode`, `labels`, `aliases`) -> tra cứu qua `CodeRegistryService`.
   - **`modules/settings` (Settings)**: 4 kiểu (`TEXT`, `NUMBER`, `BOOLEAN`, `JSON`), phân giải 5 tầng (`UNIT_ENV -> UNIT_ALL -> GLOBAL_ENV -> GLOBAL -> DEFAULT`), mã hóa `AES-256-GCM` & mask `'••••••••'` cho `isSensitive: true`, cache L1+L2 -> đọc qua `SettingRegistryService` hoặc `SettingsService.getDecryptedValue()`.
   - **`modules/settings` (Feature Flags)**: Target theo `targetUserIds`, `targetRoles`, `targetOrganizationUnitIds`, `rolloutPercentage` (0..100% FNV-1a hash), `startsAt`/`endsAt` -> kiểm tra qua `FeatureFlagRegistryService.isEnabled()` / `FeatureFlagsService.evaluate()`.

## 2. TYPESCRIPT ESM, FASTIFY & CONFIG
1. **ESM `NodeNext`**: Relative import nội bộ bắt buộc có đuôi `.js` (`import { x } from './x.js'`). Path aliases (`@apps/*`, `@packages/*`, `@modules/*`, `@project-modules/*`) được giải quyết qua `tsc-alias` khi build.
2. **Strict Type Safety**: CẤM dùng `any` (dùng `unknown` + narrowing/Zod). Kiểm tra tồn tại với mảng/record do `noUncheckedIndexedAccess`.
3. **Fastify Adapter (`@nestjs/platform-fastify`)**: CẤM dùng API Express (`res.send`, `res.json`, `res.status`). Dùng return chuẩn của NestJS hoặc `FastifyReply` / `FastifyRequest`.
4. **Flat Config (Phong cách Laravel)**:
   - Đặt phẳng tại `@packages/config` (`app.config.ts`, `database.config.ts`, `auth.config.ts`, `cache.config.ts`, `storage.config.ts`).
   - Dùng `env('KEY')`, `env.number('KEY')`, `env.boolean('KEY')` Fail-Fast (`[ConfigError]`).
   - **Chống Overthinking**: CẤM thêm điều kiện kiểm tra rườm rà (`port < 1024`...) hoặc ép ghép URL (`DATABASE_URL`); luôn dùng biến đơn tách biệt (`DB_HOST`, `DB_PORT`...).

## 3. KIỂM THỬ & BÀN GIAO
- **Cấu trúc `backend/test/`**: `fixtures/`, `concerns/`, `unit/`, `feature/` (tuyệt đối không để test trong `src/`).
- **Lệnh kiểm tra toàn diện (WSL2 bash)**: `npm --prefix backend run check` (`lint` + `typecheck` + `test` + `build`). Tuân thủ Conventional Commits.
