# Đặc tả thông tin và giao diện System Operations Console

> **Mục đích:** Tài liệu đầu vào để thiết kế lại menu, trang, trang chi tiết và luồng thao tác của System Ops/Monitoring.
> **Trạng thái:** Đặc tả phân tích; chưa triển khai UI hoặc backend.
> **Đối tượng sử dụng:** On-call/SRE, backend developer, platform admin và người xem trạng thái hệ thống.
> **Liên quan:** [Kế hoạch Phase 10–15](./PHASE-10-15-PLAN.md), đặc biệt audit và thiết kế lại Monitoring ở Phase 12.

## 1. Kết luận ngắn

Console nên được thiết kế quanh câu hỏi vận hành:

1. **Có vấn đề gì ngay bây giờ?**
2. **Ảnh hưởng tới service, endpoint, job hoặc provider nào?**
3. **Dữ liệu nào chứng minh vấn đề?**
4. **Tôi có thể làm gì an toàn để khắc phục?**
5. **Sau thao tác, làm sao xác nhận hệ thống đã hồi phục?**

Không nên tổ chức UI theo cấu trúc source code/package. Người vận hành cần đi từ **tổng quan → cảnh báo → tài nguyên bị ảnh hưởng → log/trace/job liên quan → thao tác → xác nhận kết quả**.

**Nguyên tắc quan trọng:** UI không được tự biến thiếu dữ liệu thành `0`, `Healthy`, “vừa cập nhật” hoặc trạng thái thành công. Mỗi số liệu cần cho biết nguồn, thời điểm quan sát và trạng thái khả dụng.

## 2. Hiện trạng UI đã kiểm tra

Registry hiện tại trong [sections.ts](../../frontend/src/modules/system-console/shell/sections.ts) có **16 section**:

`Overview`, `Runtimes`, `HTTP Traffic`, `Performance`, `Database`, `Cache`, `Storage`, `Messaging`, `Worker`, `Scheduler`, `Jobs`, `Logs`, `Security`, `Secrets`, `Configuration`, `Packages`.

Console đã có một số nền UX có thể tái sử dụng:

- Shell responsive, sidebar thu gọn, breadcrumb, command palette, chọn thời gian và refresh trong [ConsoleShell.tsx](../../frontend/src/modules/system-console/shell/ConsoleShell.tsx).
- Component chung như `PageHeader`, `PageTabs`, `PanelState`, `StatusBanner`, `DataTable`, `DetailSheet`, `AlertList`, `HealthGrid`.
- Trang con/chi tiết đã có ở runtime, endpoint, task và job; một số tài nguyên dùng sheet/drawer.
- Logs hiện có Overview, Explorer, Errors, Audit; log detail mở sheet; trace có route trang con.
- Một số màn hình đã có query theo URL, giữ bộ lọc và trạng thái loading/error/empty/no-source.

Đây là tài sản để tái sử dụng, không phải kết luận rằng cấu trúc hiện tại hoặc dữ liệu monitoring đã đúng. Xem thêm [Kế hoạch Phase 10–15](./PHASE-10-15-PLAN.md) để audit lại nguồn dữ liệu, collector, alert và semantics.

## 3. Cấu trúc menu đề xuất

Các nhãn dưới đây là cấu trúc thông tin đề xuất, không bắt buộc giữ nguyên tên kỹ thuật hoặc module backend.

```text
System Ops
├── Tổng quan
├── Tình trạng
│   ├── Sức khỏe & Sự cố
│   ├── Runtime
│   ├── HTTP Traffic
│   └── Hiệu năng
├── Hạ tầng
│   ├── Database
│   ├── Cache
│   └── Storage
├── Tác vụ nền
│   ├── Queue & Worker
│   ├── Scheduler
│   └── Jobs
├── Tích hợp
│   ├── Messaging
│   └── Webhooks & Providers (chỉ hiện khi backend đã có nguồn dữ liệu thật)
├── Điều tra
│   └── Logs & Traces
└── Quản trị
    ├── Security & Audit
    ├── Secrets
    ├── Configuration
    └── Modules & Packages
```

### Quyết định gom/tách menu

| Menu hiện tại | Đề xuất | Lý do |
|---|---|---|
| `Worker` | Đổi thành `Queue & Worker` | Người vận hành cần hiểu quan hệ queue, worker và consumer trên cùng một trang. |
| `Messaging` | Giữ riêng trong `Tích hợp` | Theo dõi publish/consume/channel khác với điều khiển worker/job; hiển thị liên kết tới queue tương ứng thay vì lặp lại số liệu. |
| `Jobs` | Giữ riêng trong `Tác vụ nền` | Job explorer, retry và điều tra một job là tác vụ vận hành có luồng riêng. |
| `Logs` | Đổi thành `Logs & Traces`, đưa dưới `Điều tra` | Log/trace là điểm đến điều tra dùng xuyên hệ thống, không chỉ là một trang governance. |
| `Security` và `Audit` | Gộp nhãn thành `Security & Audit`; giữ audit là tab/trang có phân biệt loại dữ liệu | Security status, sự kiện bảo mật và audit trail liên quan nhưng không được trộn nội dung hoặc chính sách lưu trữ. |
| `Packages` | Đổi thành `Modules & Packages` | Người dùng cần hiểu cả module nghiệp vụ đang bật và package hạ tầng, phiên bản/tình trạng. |
| `Health & Incidents` | Thêm khi đã có health/readiness và alert lifecycle đáng tin | Là điểm bắt đầu xử lý sự cố. Không dựng trang từ cảnh báo hardcode hoặc số liệu placeholder. |
| `Webhooks & Providers` | Thêm sau Phase 10 | Chỉ hiển thị chức năng thực sự đã triển khai: delivery, provider status, retry/replay có quyền. Không tạo menu rỗng chỉ vì có trong kế hoạch. |

### Cách giữ menu dễ dùng

- Mỗi nhóm chỉ chứa các mục liên quan; nhóm có thể thu gọn và ghi nhớ trạng thái.
- Menu hiện cảnh báo/count chỉ khi có dữ liệu thật, có timestamp và có link đến danh sách nguyên nhân.
- Không dùng badge đỏ làm trang trí hoặc hiển thị `0` khi datasource lỗi.
- Tìm trang bằng command palette; hỗ trợ alias từ khóa như `db`, `queue`, `trace`, `failed job`.
- Menu theo permission; người không có quyền thao tác vẫn có thể được cấp read-only nếu chính sách cho phép.
- Trên mobile, sidebar thành drawer; tên mục và trạng thái vẫn dễ nhận biết, không chỉ dựa vào icon.

## 4. Đặc tả trang theo menu

### 4.1 Tổng quan

**Mục tiêu:** Trả lời trong vài giây “hệ thống đang ổn không và vấn đề lớn nhất là gì?” Không phải nơi chứa mọi biểu đồ.

**Trang/chế độ:**
- Một dashboard mặc định; không cần trang detail tổng quan.
- Các card trạng thái dẫn thẳng tới trang tài nguyên tương ứng.

**Hiển thị:**
- Môi trường và build/version đang chạy.
- Tình trạng tổng thể kèm số thành phần `healthy / degraded / down / unknown`.
- Sự cố/cảnh báo đang mở, sắp xếp theo severity rồi thời gian.
- Tình trạng API, runtime, database, Redis/cache, storage, queue và provider đã cấu hình.
- Một số chỉ số điều hành ngắn: request rate/error/latency, queue backlog/oldest age, failed jobs, provider availability — chỉ khi có nguồn hợp lệ.
- Hoạt động gần đây có nguồn và thời gian.

**Hành động/điều hướng:** Mở sự cố, mở trang thành phần, mở logs/traces đã lọc theo service/request/correlation ID.

**Trọng tâm bố cục:** Sự cố đang ảnh hưởng và bước tiếp theo ở trên; KPI và biểu đồ tổng hợp ở dưới. Không đặt 6–10 chart ngang hàng.

### 4.2 Sức khỏe & Sự cố

**Mục tiêu:** Phân biệt process còn chạy, ứng dụng sẵn sàng nhận traffic, dependency suy giảm và incident cần người xử lý.

**Trang con:**
- **Health overview:** liveness/readiness và dependency map.
- **Alerts/Incidents:** danh sách vấn đề đang mở/đã phục hồi.
- **Incident detail:** một sự cố, timeline, ảnh hưởng, bằng chứng và hành động.

**Hiển thị:** Component/dependency, trạng thái, lý do, latency/check time, thời gian bắt đầu, lần cập nhật gần nhất, alert rule/source và ảnh hưởng liên quan.

**Hành động:** Retry health check; acknowledge/assign/suppress/resolve chỉ khi đã có workflow, permission và audit. Link tới Logs & Traces, DB/queue/runtime/provider.

**Trọng tâm:** “Điều gì hỏng, ảnh hưởng gì, xem bằng chứng ở đâu?” Health check không phải nơi hiển thị secret hay stack trace.

### 4.3 Runtime

**Trang:** Danh sách instance; trang chi tiết cho `api`, `worker`, `scheduler` và từng instance nếu định danh ổn định.

**Tab chi tiết:** `Overview`, `Metrics`, `Logs` (giữ route tương thích nếu hiện tại đã được dùng).

**Hiển thị:** runtime kind/id, instance/host, phiên bản, heartbeat và tuổi dữ liệu, trạng thái, uptime, CPU/RAM, event-loop nếu có, số worker/queue liên quan, khả năng điều khiển.

**Hành động:** Pause/resume chỉ khi runtime thật sự hỗ trợ; không đưa start/stop/restart giả lập nếu Docker/platform là nơi sở hữu lifecycle. Mọi lệnh cần quyền, xác nhận và kết quả rõ.

**Liên kết điều tra:** Metric bất thường → Performance; log → Logs & Traces với runtime/instance đã lọc; worker → Queue & Worker.

### 4.4 HTTP Traffic

**Trang/chế độ:** `Overview`, `Endpoints`, `Errors`; endpoint detail là trang riêng.

**Hiển thị:**
- Request rate, tỷ lệ lỗi, latency p50/p95/p99 nếu histogram đủ mẫu và có timestamp.
- Bảng endpoint theo method + route template; volume, lỗi, latency và thay đổi theo khoảng thời gian.
- Nhóm lỗi theo status/route/error type, không nhầm request count với error count.
- Endpoint detail: metric theo thời gian, status breakdown, version/runtime nếu có.

**Không hiển thị:** Request body hoặc trang chi tiết raw request nếu không có yêu cầu và kiểm soát dữ liệu rõ ràng.

**Hành động/điều hướng:** Mở Logs & Traces với route/status/window đã chọn; mở trace/request theo ID nếu dữ liệu có sẵn.

**Trọng tâm:** Endpoint nào gây ảnh hưởng và xu hướng lỗi/latency; dùng route template để tránh cardinality cao.

### 4.5 Hiệu năng

**Tab:** `Overview`, `Bottlenecks`, `Events`.

**Hiển thị:** CPU, memory, event loop, HTTP latency, DB latency, queue depth/age theo nguồn thực tế; bottleneck có rule, threshold, window, runtime, value, timestamp và trạng thái recovery.

**Detail:** Bottleneck/event có drawer hoặc trang chi tiết khi cần timeline và evidence dài; luôn có link tới metric query và runtime liên quan.

**Hành động:** Mở component sở hữu tài nguyên; không đưa nút “fix” chung nếu không có action cụ thể.

**Trọng tâm:** Chỉ báo có thể hành động được, không lặp toàn bộ KPI của từng trang runtime/DB/queue.

### 4.6 Database

**Tab:** `Overview`, `Queries`, `Tables`, `Activity`.

**Trang/chế độ chi tiết:** Query detail, table detail, session/connection detail là sheet/drawer; migrations có thể là view con trong `Tables` nếu có nguồn thật.

**Hiển thị:** Connection pool, trạng thái kết nối, latency/query volume theo khả năng driver, top slow query có redaction, active sessions, lock/blocking, table size/IO và migration status khi được cung cấp.

**Hành động:** Query explain hoặc cancel session chỉ khi hỗ trợ, có guardrail quyền và xác nhận. Không cho sửa SQL hoặc chạy repair tùy ý từ trang monitoring.

**Trọng tâm:** Tìm nghẽn và ảnh hưởng đến ứng dụng; capability không được hỗ trợ phải ghi rõ, không thay bằng `0`.

### 4.7 Cache

**Tab:** `Overview`, `Namespaces`, `Keys`, `Activity`.

**Chi tiết:** Namespace/key/Redis client mở sheet; key value phải mask hoặc không đọc nếu có nguy cơ chứa dữ liệu nhạy cảm.

**Hiển thị:** Redis connection/latency/memory/clients/evictions/keyspace; namespace/key counts chỉ khi nguồn đáng tin; thao tác gần đây.

**Hành động:** Flush namespace chỉ với permission, xác nhận scope, tác động dự kiến và audit. Không hiển thị secret trong key value.

**Trọng tâm:** Phân biệt trạng thái Redis (nguồn) với hành vi cache của ứng dụng (metric do app ghi).

### 4.8 Storage

**Tab:** `Overview`, `Objects`, `Uploads`, `Activity`.

**Chi tiết:** Object/failure/container hoặc bucket detail bằng sheet; tải nội dung file không phải mặc định của Console.

**Hiển thị:** Provider/bucket/connection status, dung lượng/object count nếu provider hỗ trợ, multipart/active upload, lỗi theo operation và thời gian.

**Hành động:** Kiểm tra object hoặc thao tác quản trị được phép; xóa phải xác nhận và audit. Không dựng upload/download throughput nếu không có nguồn ghi.

**Trọng tâm:** Khả dụng và lỗi storage, không lẫn với metadata/quyền nghiệp vụ ở module Files.

### 4.9 Queue & Worker

**Tab:** `Overview`, `Queues`, `Workers`, `Activity`.

**Chi tiết:** Queue detail là trang con gồm `Overview`, `Jobs`, `Failures`; worker detail là sheet hoặc trang nếu cần xem dài hạn.

**Hiển thị:** Queue counts theo trạng thái, oldest waiting age, throughput/failure nếu dữ liệu có, concurrency, worker liveness, pause state, retry/backlog.

**Hành động:** Pause/resume queue, retry/clean job chỉ theo quyền và policy; dialog phải nêu queue, số lượng record và hệ quả.

**Trọng tâm:** Phân biệt queue backlog, worker capacity và job failure; không lặp cùng bộ đếm trong Messaging.

### 4.10 Scheduler

**Tab:** `Overview`, `Tasks`, `History`, `Timeline`.

**Chi tiết:** Task detail là trang con với `Overview`, `History`.

**Hiển thị:** Task enabled/disabled, cron/timezone, next/last run, trạng thái và duration thực tế, runtime sở hữu, lịch sử thất bại.

**Hành động:** Run now, enable/disable chỉ nếu chức năng có thật; yêu cầu quyền, lý do/audit và trạng thái kết quả. Không hiển thị misfire/overlap nếu implementation không theo dõi các khái niệm đó.

**Trọng tâm:** Xác định task nào sắp chạy, đã chạy chưa và lần chạy gần nhất có thành công không.

### 4.11 Jobs

**Tab:** `Overview`, `Explorer`, `Failures`, `Activity`.

**Chi tiết:** Job detail là **trang riêng**, có `Overview`, `Attempts`, `Payload/Logs`; payload mặc định mask và có permission riêng.

**Hiển thị:** Job type/id, queue, state, created/started/finished, attempts, duration/wait, source, worker, error và correlation/request ID.

**Hành động:** Retry/cancel/remove với eligibility/reason, confirmation và audit. Không cho retry job đã hoàn tất hoặc action không hợp lệ.

**Trọng tâm:** Điều tra một job từ khi được enqueue đến từng attempt và logs; giữ query/filter trong URL để chia sẻ.

### 4.12 Messaging

**Tab:** `Overview`, `Channels`, `Messages`, `Activity`.

**Chi tiết:** Channel/consumer/message là sheet; message detail có id, channel, published/consumed time, result và IDs liên kết nhưng payload nhạy cảm bị mask.

**Hiển thị:** Publish/consume counters theo thời gian, channel, queue mapping, failed/dead-letter thật và broker state.

**Hành động:** Gửi message thử chỉ trong môi trường cho phép và dùng payload mẫu an toàn; link sang queue/job tương ứng.

**Trọng tâm:** Theo dõi đường đi của message, không hiển thị số worker giả hoặc đếm message/job hai lần.

### 4.13 Webhooks & Providers (menu tương lai)

**Chỉ bật khi đã có backend Phase 10.**

**Tab:** `Overview`, `Endpoints/Providers`, `Deliveries`, `Failures`.

**Chi tiết:** Endpoint/provider detail là trang riêng nếu có cấu hình và health; delivery attempt là drawer hoặc trang detail tùy lượng dữ liệu.

**Hiển thị:** Provider/endpoint status, last success/failure, latency, delivery attempts, next retry, disabled/circuit state, recent errors. URL/secret phải redact.

**Hành động:** Replay/test/pause chỉ có quyền phù hợp, hiển thị endpoint và event trước khi gửi, có idempotency/audit. Không có nút replay hàng loạt mơ hồ.

### 4.14 Logs & Traces

**Tab:** `Overview`, `Explorer`, `Errors`, `Traces`. Audit chuyển sang `Security & Audit`.

**Chi tiết:** Log detail là drawer; error group detail và trace là trang riêng khi cần timeline/spans.

**Bộ lọc cần dùng:** time range, level, service/runtime, module, route, request/correlation/trace ID, job/message/provider, error type. Filter nằm trong URL và có thể copy link.

**Hiển thị:** timestamp, level, service/module, message đã redact, duration, IDs liên quan và nguồn log. Trace hiển thị span tree, duration, lỗi và liên kết log/job.

**Hành động:** Copy IDs, mở related trace/log/job/provider; live-tail có pause/resume, giới hạn buffer và chỉ báo độ trễ ingest.

**Trọng tâm:** Tìm bằng ID/filter nhanh; log, trace, job và request có thể nối thành một hành trình điều tra.

### 4.15 Security & Audit

**Tab:** `Security Events`, `Audit Trail`; các tab không được trộn thành một loại log duy nhất.

**Hiển thị:** Security events như login failure, đổi quyền, MFA reset; audit record có actor, action, module/resource, before/after đã redact, reason, IP, request/correlation ID, timestamp.

**Chi tiết:** Audit/security event detail là trang hoặc drawer read-only. Bản ghi bất biến; không có edit/delete action thường.

**Hành động:** Filter/export có permission và audit; không show raw secret, token, password hoặc dữ liệu nhạy cảm.

**Trọng tâm:** Ai làm gì, với tài nguyên nào, khi nào và bằng chứng liên kết ở đâu.

### 4.16 Secrets

**Tab:** Một danh sách kiểm kê và phần hướng dẫn cấu hình.

**Hiển thị:** Secret key name, source/provider, configured/missing, last-read metadata nếu được ghi thật, consumer/module; **không bao giờ trả giá trị secret**.

**Hành động:** Không reveal/copy secret. Có thể link tới tài liệu/secret manager ngoài hệ thống; đổi secret ngoài UI nếu chưa có workflow an toàn.

**Trọng tâm:** Tìm cấu hình thiếu và nơi sử dụng mà không làm lộ credential.

### 4.17 Configuration

**Trang:** Catalog theo domain/namespace; detail theo nhóm cấu hình hoặc side sheet.

**Hiển thị:** key, mô tả, type, effective value (mask nếu nhạy cảm), nguồn (env/default/secret provider), validation state và restart requirement nếu biết thật.

**Hành động:** Nếu chỉ read-only thì ghi rõ. Không cho chỉnh env/runtime config không hỗ trợ hot reload; mọi thay đổi phải có validation, audit và rollback nếu có.

**Trọng tâm:** Trả lời “giá trị đang hiệu lực lấy từ đâu?” thay vì chỉ dump danh sách key.

### 4.18 Modules & Packages

**Tab:** `Modules`, `Packages` hoặc một danh sách chung có filter theo loại; chọn phương án chung chỉ khi metadata đủ tương đồng.

**Chi tiết:** Module/package detail sheet gồm version, status, dependency, capability/adapter, provider status, configuration readiness và link docs.

**Hiển thị:** enabled/disabled, version, compatibility, readiness, dependencies, health summary và action capabilities.

**Hành động:** Không cho install/uninstall/upgrade nếu CLI/deployment là nơi sở hữu lifecycle. Package operations chỉ hiện khi action có thật, được authorize và có audit.

**Trọng tâm:** Giúp biết hệ thống đang chạy thành phần nào và thành phần nào lỗi, không phải một danh sách class NestJS.

## 5. Hợp đồng hiển thị dữ liệu

Mỗi panel, KPI hoặc row có dữ liệu vận hành cần biểu đạt tối thiểu:

| Trường | Ý nghĩa |
|---|---|
| `value` | Giá trị thực hoặc `null`; không dùng giá trị giả để giữ UI không trống. |
| `status` | `healthy`, `degraded`, `down`, `unknown`, `unavailable` hoặc trạng thái domain rõ nghĩa. |
| `source` | API/driver/Prometheus/log store/provider nào tạo ra thông tin. |
| `observedAt` | Thời điểm đo/đọc nguồn; không phải thời gian render. |
| `freshness` | Fresh/stale/expired theo ngưỡng được định nghĩa cho nguồn đó. |
| `capability` | Supported/unsupported/not-configured, phân biệt với lỗi datasource. |
| `error` | Mô tả an toàn và mã lỗi/action retry; không trả stack, SQL hoặc secret. |

Các trạng thái UI phải khác nhau:

- **Đang tải:** skeleton không nhảy bố cục.
- **Không có bản ghi:** nguồn hoạt động nhưng query rỗng.
- **Chưa cấu hình/không hỗ trợ:** lý do rõ và link cấu hình/tài liệu nếu phù hợp.
- **Nguồn không khả dụng:** datasource lỗi, hiển thị lần thành công cuối, retry và link trạng thái dependency.
- **Dữ liệu cũ:** vẫn hiển thị giá trị cuối với nhãn stale và thời điểm quan sát.
- **Không đủ mẫu:** không tính percentile/rate; ghi rõ cần thêm dữ liệu.
- **Bị cấm:** giải thích quyền cần có, không giả làm empty.

## 6. Mẫu bố cục chung cho trang

1. **Page header:** tên rõ nghĩa, mô tả ngắn khi cần, status tổng thể, môi trường, action chính.
2. **Source/freshness strip:** lần cập nhật, auto-refresh state, datasource và stale/unavailable warning.
3. **KPI row:** chỉ số thiết yếu của trang; mỗi KPI có unit, range và tooltip nguồn/ý nghĩa.
4. **Main work area:** bảng/list hoặc chart phục vụ mục tiêu chính; ưu tiên bảng cho tìm/so sánh và chart cho xu hướng.
5. **Detail:** trang riêng cho đối tượng có nhiều tab/lịch sử/action; drawer/sheet chỉ cho tra cứu ngắn trong ngữ cảnh.
6. **Related activity:** logs/traces/events ở dưới hoặc tab riêng; không nhồi log dài vào overview.
7. **Action confirmation:** nêu đối tượng, scope, ảnh hưởng, khả năng hoàn tác và audit trước khi xác nhận thao tác phá hủy.

Giữ pattern hiện có trong [`frontend/src/core/ui`](../../frontend/src/core/ui): `AppShell`, `Sidebar`, `PageHeader`, `PageTabs`, `DataTable`, `Panel`, `PanelState`, `StatusBanner`, `DetailSheet`, `AlertList`, `HealthGrid`, `TimeRangePicker`, `RefreshControl`.

## 7. Luồng điều tra và vận hành

### Luồng A — API chậm/lỗi

`Overview/Health alert` → `HTTP Traffic endpoint detail` → `Logs & Traces` đã lọc theo route/status/window → mở trace/request nếu có → đối chiếu runtime/DB/queue liên quan → xác nhận recovery trên cùng khoảng thời gian.

### Luồng B — Queue/job bị kẹt

`Health/Overview` → `Queue & Worker` tìm queue backlog/oldest age → mở `Jobs` đã lọc queue/state → Job detail/attempts/error → Logs & Traces theo job/correlation ID → retry/cancel nếu đủ quyền → theo dõi trạng thái mới.

### Luồng C — Provider/Webhook lỗi

`Health/Incidents` → `Webhooks & Providers` provider/endpoint detail → delivery failure detail → log/trace theo event ID → replay một lần có xác nhận/idempotency → xem delivery result.

### Luồng D — Thao tác quản trị

Vào trang tài nguyên → đọc trạng thái và tác động → action có quyền → confirmation nêu scope → kết quả/audit event → link tới log tương ứng.

## 8. Logs và khả năng điều tra

- Dùng chung request ID/correlation ID/trace ID xuyên API → event → queue/job → provider/webhook.
- Trên lỗi, job, runtime, delivery và incident có liên kết rõ **“Xem log liên quan”**; không bắt người dùng tự copy nhiều ID.
- Cho phép copy ID và URL điều tra đã giữ filter/time range.
- Hiển thị log source, ingest time và event time để nhận biết trễ/khác múi giờ.
- Mặc định redact token, password, cookie, secret, personal data và payload không cần thiết.
- Live tail có pause, giới hạn buffer, trạng thái kết nối và filter; không tự cuộn làm mất nội dung đang đọc.
- Tách **application log**, **security event**, **audit record** và **trace span** về mặt nhãn/retention/quyền dù có thể điều hướng chéo.

## 9. Dễ đọc và dễ vận hành

- Mỗi trang có một mục tiêu và một hành động chính; tránh nhiều card giống nhau hoặc chart không dẫn tới quyết định.
- Thuật ngữ nhất quán: `Queue`, `Worker`, `Job`, `Message`, `Alert`, `Incident`, `Audit` phải có nghĩa khác nhau và có glossary/tooltip.
- Dùng status text + icon + màu; màu không phải tín hiệu duy nhất.
- Mặc định ưu tiên vấn đề mới/nghiêm trọng; cho phép xem resolved và lịch sử riêng.
- Bảng hỗ trợ search, filter, sort, pagination, copy ID; bộ lọc và tab được giữ trong URL.
- Detail page dùng cho luồng dài hoặc nhiều tab (Job, Runtime, Endpoint, Task, Incident); drawer cho chi tiết ngắn (Log, DB session/query/table, Cache key, Message).
- Các thao tác nguy hiểm yêu cầu permission, scope preview, confirm và audit; trạng thái disabled giải thích lý do.
- Responsive cho sidebar mobile và bảng rộng; ưu tiên cột quan trọng, phần còn lại cuộn có kiểm soát hoặc mở detail.
- Dùng theme/token và mật độ component hiện có; không thiết kế một style riêng cho từng module.

## 10. Điều khiển toàn cục

Thanh điều khiển toàn Console nên có:

- Môi trường (`development`, `staging`, `production`) luôn dễ nhận diện; môi trường production cần phân biệt rõ.
- Tìm trang/command bằng command palette.
- Chọn time range dùng chung khi trang có dữ liệu chuỗi thời gian.
- Auto-refresh có trạng thái rõ; pause khi người dùng đang thao tác hoặc tab nền nếu phù hợp.
- Nút refresh thủ công và “last updated” chính xác.
- Breadcrumb và deep link; quay lại giữ filter/tab/page.
- Locale/theme và user/permission context.

Không dùng một time range toàn cục cho bảng sự kiện nếu semantics của bảng là “gần đây”; mỗi control phải cho biết nó ảnh hưởng phần nào.

## 11. Những nội dung không nên đưa vào UI

- Metric không có writer hoặc không có nguồn đáng tin.
- Giá trị mặc định `0`, `100%`, `healthy`, “now”, host/instance giả.
- Stack trace, SQL parameter, raw token, raw payload hoặc signing secret.
- Nút restart runtime nếu Docker/platform quản lý process; nút retry/replay nếu chưa có policy/idempotency.
- Cấu hình chỉnh sửa được nhưng backend không hỗ trợ validation, persistence, audit hoặc hot reload.
- Dữ liệu lịch sử tự lưu trùng với Prometheus hoặc nguồn telemetry chính thức.
- Tab/detail trống chỉ để khớp một danh sách phase tương lai.

## 12. Câu hỏi để chốt trước khi vẽ UI

1. Người dùng ưu tiên là on-call/SRE, developer hay admin? Có cần chế độ read-only cho developer không?
2. Incident/alert có cần acknowledge/assign/maintenance suppression ngay đợt đầu, hay chỉ cần xem và điều hướng?
3. Logs/Traces dùng backend nào và có trace thật từ API → worker → provider chưa?
4. Có cần hỗ trợ nhiều environment/tenant cùng lúc hay mỗi lần chỉ xem một environment?
5. Những thao tác nào được phép từ Console: pause queue, retry job, flush cache, replay webhook? Ai được phép?
6. Mobile chỉ cần xem trạng thái hay cần thao tác vận hành?
7. Có SLA cho freshness/retention từng nguồn không? Không nên thiết kế badge “live” nếu chưa có ngưỡng.

## 13. Tiêu chí duyệt wireframe

- Người mới nhìn Overview xác định được tình trạng và biết nơi cần bấm tiếp.
- Từ một lỗi có thể tới log/trace liên quan trong tối đa vài bước, không nhập lại ID thủ công.
- Phân biệt rõ healthy, degraded, down, unknown, stale, empty và unavailable.
- Mọi KPI có unit/range/source/time; không có số vô nghĩa chỉ để lấp chỗ trống.
- Có page/detail/action map đầy đủ; không có menu mồ côi hoặc route chỉ hiện trong một chỗ.
- Chỉ ra rõ page nào dùng bảng, chart, drawer hay detail page và lý do.
- Action nguy hiểm có preview scope, xác nhận, permission và audit result.
- UI responsive, keyboard accessible, focus/empty/error/loading/forbidden states được thiết kế.
- Có test scenario cho API offline, no-sample, datasource timeout và quyền thiếu.

## 14. Tài liệu liên quan

- [Kế hoạch tách module Phase 3–9](./MODULE-SPLIT-PLAN.md)
- [Kế hoạch Phase 10–15 và làm lại Monitoring](./PHASE-10-15-PLAN.md)
- [System Console section registry](../../frontend/src/modules/system-console/shell/sections.ts)
- [System Console shell](../../frontend/src/modules/system-console/shell/ConsoleShell.tsx)
- [System Console overview](../../frontend/src/modules/system-console/sections/overview/OverviewSection.tsx)
- [Shared UI components](../../frontend/src/core/ui)
- [Architecture specification](../../.agents/references/architecture-spec.md)
