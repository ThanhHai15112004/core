# Frontend — Core Framework

Giao diện mẫu xây dựng trên **React 19 + Vite 8 + TypeScript**, theo triết lý tách biệt tầng **kỹ thuật dùng chung** (`core/`) khỏi **nghiệp vụ của app** (`modules/`).

---

## Cấu Trúc Thư Mục `src/`

```text
src/
├── core/                          # Tầng kỹ thuật + UI dùng chung — COPY được sang dự án khác
│   ├── components/                # UI Primitive (không hardcode nghiệp vụ)
│   │   └── card/                  #   Card component
│   ├── layouts/                   # Layout khung trang dùng chung
│   │   ├── Header.tsx             #   Header với navigation tabs
│   │   ├── Footer.tsx             #   Footer
│   │   └── MainLayout.tsx         #   Layout wrapper
│   ├── hooks/                     # Hook thuần kỹ thuật (useFetch, useFormat, useTicker)
│   ├── theme/                     # Hệ theme: tokens.css (dark/light), ThemeProvider, tone.ts — NGUỒN MÀU DUY NHẤT
│   ├── ui/                        # Bộ UI dùng chung (Tailwind v4 + Radix)
│   │   ├── primitives/            #   Button, Badge, Tabs, Dialog, Sheet, Select, Tooltip…
│   │   ├── blocks/                #   PageHeader, StatTile, Panel, DataTable, AlertList, DetailSheet, ConfirmDialog…
│   │   ├── charts/                #   ECharts theo theme: TimeSeriesChart, MetricChart, BarList, Heatmap, Gantt…
│   │   ├── layout/                #   AppShell, Sidebar, TopBar, TimeRangePicker, RefreshControl, CommandPalette
│   │   └── kit/                   #   Trang demo bộ UI (chỉ dev: /system-console/_kit)
│   ├── data/                      # TanStack Query: DataProvider, useLiveQuery (theo nút làm mới), useAppMutation
│   ├── router/                    # Router path nhỏ (pushState): navigateTo, useLocation, useQueryState
│   ├── lib/                       # format.ts (số, đơn vị, NO_VALUE), csv.ts, cn.ts
│   ├── i18n/                      # useLocale + locales/{vi,en}.ts, ui.*.ts (chữ của core/ui), console/<ns>.*.ts
│   ├── services/                  # HTTP client dùng chung
│   │   └── api.ts                 #   Fetch wrapper — đọc VITE_API_BASE_URL
│   ├── types/                     # Types dùng chung toàn app
│   │   └── index.ts               #   ApiResponse<T>, PaginationMeta, ...
│   └── constants/                 # Hằng số dùng chung
│       ├── index.ts               #   APP_NAME, API_BASE_URL
│       └── navigation.ts          #   NavigationTabId, navigation config
│
├── modules/                       # Modules nghiệp vụ (Bounded Context — giống backend)
│   ├── home/                      # Trang chủ demo
│   │   └── pages/
│   │       └── Home.tsx
│   └── system-console/            # System Console — /system-console/<section>/<tab>?query
│       ├── shell/                 #   sections.ts (registry: sidebar, route, breadcrumb, Ctrl K), ConsoleShell
│       ├── sections/<x>/          #   Trang của từng section (tab, trang chi tiết, *-keys.ts, use<X>Page.ts)
│       ├── components/<x>/        #   Phần riêng của section (bảng, sheet chi tiết…)
│       ├── services/ · types/     #   API client + kiểu dữ liệu khớp backend
│       └── constants/ · utils/    #   Hằng số có tên (range, ngưỡng, page size), helper riêng
│
├── providers/                     # Provider gốc toàn app
│   └── index.tsx                  #   AppProviders wrapper (ErrorBoundary, future: QueryClient)
├── routes/                        # Định nghĩa routing
│   └── index.ts
├── config/                        # Cấu hình build-time/env
│   └── index.ts                   #   frontendConfig (appName, version, isProduction)
├── assets/                        # Ảnh, font, svg tĩnh
├── App.tsx                        # Root component — điều hướng module theo tab
├── main.tsx                       # Entrypoint React
├── index.css                      # Global styles + CSS variables
└── App.css                        # App-level styles
```

---

## Scripts

```bash
npm run dev       # Vite dev server (http://localhost:5175)
npm run build     # tsc + Vite build → dist/
npm run lint      # oxlint + scripts/check-hardcode.mjs (chặn mã màu, inline color, chữ thô trong JSX)
npm test          # vitest
npm run preview   # Preview bản build production
```

---

## Biến Môi Trường

| Biến | Mô tả | Mặc định |
| :--- | :---- | :------- |
| `VITE_API_BASE_URL` | Base URL của Backend API | `http://localhost:3005/api/v1` |

Đặt trong file `.env` (local) hoặc qua Docker Compose `environment:`.

---

## Quy Tắc Kiến Trúc

### `core/` — điều kiện để mang đi dùng lại
- **Một chiều tuyệt đối**: `core/` KHÔNG import bất kỳ thứ gì từ `modules/`.
- **Không hardcode nghiệp vụ**: Component nhận dữ liệu qua props, không tự fetch API nghiệp vụ.
- **API theo hình dạng dữ liệu**: Table nhận `columns` + `data` generic, không hardcode field nghiệp vụ.

### Giao diện (System Console và mọi chỗ dùng `core/ui`)
- **Dùng chung thì ở `core/`**: component được từ 2 section trở lên dùng phải nằm trong `core/ui`, generic, nhận chữ qua props / `t('ui.*')`.
- **Không hardcode màu**: chỉ dùng utility map từ token (`bg-panel`, `text-fg`, `text-crit-fg`, `TONE_CLASS[tone]`); palette mặc định của Tailwind đã bị xoá. Biểu đồ lấy màu từ theme lúc chạy.
- **Không hardcode chữ / số**: chữ qua `t()`, số cấu hình là hằng có tên trong `constants/`.
- **Ít chữ, dữ liệu rõ**: header không subtext; giải thích để trong tooltip ⓘ (`hint`); null hiện `—`, không tự thành 0.
- File cũ chưa sạch nằm trong `scripts/hardcode-baseline.json` (chạy `node scripts/check-hardcode.mjs --write-baseline` để thu gọn).

### `modules/` — nghiệp vụ của app này
- Được phép phụ thuộc `core/`, không có chiều ngược lại.
- Đặt tên module khớp với module backend tương ứng (ví dụ: `user/` ↔ `modules/user/`).
- Không tạo sẵn thư mục con — chỉ tạo khi có file thật.

### Thứ tự tái sử dụng component
```
Dùng lại → Kết hợp → Mở rộng → Tách vào core/ → Tạo mới cục bộ
```

---

## Thêm Module Nghiệp Vụ Mới

1. Tạo `src/modules/<ten>/pages/MyPage.tsx` (và `components/`, `hooks/`, `services/` khi cần)
2. Thêm navigation vào `src/core/constants/navigation.ts`
3. Cập nhật `src/App.tsx` để render module mới theo tab/route

---

## Kết Nối Backend

`core/services/api.ts` là fetch wrapper dùng chung:
```typescript
import { api } from '../core/services/api';

// GET request
const packages = await api.get<Package[]>('/ops/packages');

// POST request
const result = await api.post('/ops/packages/cache/actions/flush', {});
```

Base URL được đọc từ `VITE_API_BASE_URL` (môi trường) hoặc fallback về `http://localhost:3005/api/v1`.
