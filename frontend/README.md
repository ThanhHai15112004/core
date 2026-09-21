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
│   ├── hooks/                     # Hook thuần kỹ thuật
│   │   └── useFetch.ts            #   Generic fetch hook với loading/error state
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
│   └── system-ops/                # Dashboard quản trị hạ tầng
│       └── pages/
│           └── SystemOpsPage.tsx  #   Gọi /api/v1/ops/packages và hiển thị
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
npm run lint      # oxlint
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
