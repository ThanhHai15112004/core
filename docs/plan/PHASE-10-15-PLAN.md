# Kế hoạch kiến trúc và triển khai Phase 10–15

> **Trạng thái:** Kế hoạch phân tích; chưa triển khai
> **Phạm vi:** Tích hợp hệ thống, độ tin cậy, monitoring/vận hành, HA/DR, enterprise security và phát hành Core
> **Ưu tiên đặc biệt:** Phase 12 phải được kiểm toán và thiết kế lại; không coi monitoring hiện tại là đạt chỉ vì đã có dashboard hoặc metric.
>
> Kế hoạch này tiếp nối [MODULE-SPLIT-PLAN.md](./MODULE-SPLIT-PLAN.md) (Phase 3–9). Các ranh giới OAuth/identity, notification/provider và audit cần dùng chung quyết định ownership của kế hoạch trước, tránh tạo module trùng.

## 1. Mục tiêu

- Xác định mỗi trách nhiệm thuộc **package hạ tầng**, **module sở hữu nghiệp vụ**, **runtime**, **operations console** hay **pipeline triển khai**.
- Không tạo một module hoặc abstraction tổng quát chứa mọi provider, event, retry hay monitoring.
- Phân biệt dữ liệu hiện tại từ nguồn gốc, metric lịch sử, log, trace, health và cảnh báo.
- Rà soát monitoring từ nguồn dữ liệu đến UI; số liệu không có nguồn phải thể hiện không khả dụng, không giả làm 0/healthy.
- Tách việc cần có cho Core khỏi tính năng tùy chọn chỉ phù hợp một số dự án hoặc nhà cung cấp.

## 2. Bằng chứng ban đầu từ repository

Đây là inventory có mục tiêu để lập kế hoạch, không thay thế bước audit đầy đủ trước triển khai.

| Khu vực | Đã thấy | Chưa được coi là hoàn tất |
|---|---|---|
| HTTP client | Có `packages/http-client`, contract có `timeoutMs` và `params`. | Provider hiện chưa áp timeout, không nối query params, chưa thấy retry/circuit breaker/trace hoặc metric outbound. Logging ghi URL; cần rà khả năng URL chứa query secret. |
| Webhook / Payment / OAuth | Có các vùng provider như storage, notification và calendar. | Chưa tìm thấy module tổng quát về outbound/inbound webhook, payment hay OAuth external identity trong code hiện tại. Phase 14 còn bổ sung SSO doanh nghiệp, cần dùng chung nền identity thay vì làm hai lần. |
| Event reliability | Có `packages/messaging`, BullMQ worker/scheduler và `packages/database/repair`. | Chưa tìm thấy outbox, inbox/idempotency dùng chung hoặc reconciliation framework. BullMQ retry không thay thế retry chính sách HTTP hay transaction outbox. |
| Monitoring | Đã có `packages/metrics`, Prometheus, Pino/Redis Stream, runtime sampler, health module, nhiều package monitoring và các module `*-ops`/performance/traffic. | Cách thu thập, lưu event và dựng dashboard có nhiều tầng; cần map ownership và nguồn dữ liệu trước khi giữ hoặc thay. |
| Health | Có một health service kiểm tra DB, Redis, storage và heap. | Chưa thấy phân tách liveness/readiness; chưa bao phủ đủ queue, migration và provider theo mục tiêu phase. |
| HA/DR | Có nhiều runtime và Docker health checks. | Chưa tìm thấy trong phần đã rà adapter đầy đủ cho DB replica/Redis Sentinel/Cluster, backup/restore hoặc DR orchestration. Phải xác minh trước khi chọn phạm vi triển khai. |
| CI | Workflow hiện có format/lint, typecheck, build, architecture/OpenAPI checks, tests, migration/seed gate và Docker smoke test. | Chưa thấy workflow CD, SAST/DAST, SBOM, quét image/license hoặc quy trình nâng cấp Core/module trong các file đã rà. |

### Các dấu hiệu monitoring cần được xác minh trong audit

1. `PrometheusQueryClient.safeQuery()`/`safeRange()` hiện chuyển lỗi thành mảng rỗng; dữ liệu rỗng và Prometheus lỗi có thể bị hiểu giống nhau. API/UI cần phân biệt `available + empty` với `unavailable/error`.
2. `DatabaseMonitorService` bọc lỗi/capability không hỗ trợ thành `null`; cần kiểm tra response có giữ được lý do, nguồn và timestamp hay không.
3. `PerformanceMonitorService` tạo event recovery với `value: 0`, `threshold: 0`, `unit: ''`; đây là placeholder không phải số đo recovery thực. Cần bỏ placeholder hoặc đổi hợp đồng event để recovery không đòi trường số đo.
4. `packages/*/monitoring` và `modules/*-ops` cùng tham gia thu thập/tổng hợp/hiển thị. Ranh giới có thể hợp lệ, nhưng phải chỉ rõ ai là nguồn gốc, ai là collector, ai chỉ đọc và ai sở hữu alert/event.
5. `.agents/cleanup_plan.md` ghi giai đoạn monitoring đã hoàn tất vào 2026-10-13; trạng thái tài liệu đó không thay cho audit lại code và kết quả runtime hiện tại.

## 3. Mô hình ownership đích

| Tầng | Nơi đặt | Được phép sở hữu |
|---|---|---|
| Outbound transport | `packages/http-client` | Gọi HTTP, timeout, telemetry kỹ thuật, policy retry được cấu hình rõ, circuit breaker transport-level. Không chứa logic payment/OAuth/webhook nghiệp vụ. |
| Provider/domain integration | Module nghiệp vụ như `payments`, `federated-identity`, `notifications` | Contract và adapter provider theo domain; kiểm tra chữ ký, mapping, workflow, secret reference và kết quả nghiệp vụ. |
| Webhook | `webhooks` (outbound endpoint/subscription/delivery) và module nhận theo domain; cân nhắc `webhook-inbox` dùng chung chỉ khi có nhiều consumer thật | Outbound delivery lifecycle ở webhook module; inbound business validation ở module sở hữu provider/domain; receipt/idempotency dùng chung chỉ khi có hợp đồng ổn định. |
| Event transport | `packages/messaging` | Event envelope, publish/subscribe contract, serialization và delivery transport. |
| Transactional outbox | Hạ tầng messaging/database, cùng worker dispatch | Ghi event cùng transaction và dispatch đáng tin cậy. Phải chốt migration/table owner và cách từng module tham gia transaction trước khi code. |
| Reliability | `packages/queue`, `packages/http-client`, và một idempotency contract dùng chung nếu cần nhiều luồng | Retry job khác retry HTTP; idempotency key khác business validation. Không áp một retry policy chung cho mọi lỗi. |
| Telemetry | `packages/metrics`, `packages/logging`, package tracing/observability được chốt ở Phase 12, `packages/runtime` | Instrumentation và export kỹ thuật theo process/runtime. |
| Monitoring APIs | Các module `*-ops` hoặc hệ ops đã được thống nhất sau audit | Read model cho console, gọi nguồn thật; không tự trở thành nguồn ghi metric thứ hai. |
| Alert và incident | `alerting` cho rule/lifecycle/routing; `incidents` nếu cần quản lý P1–P4, owner, runbook và hậu kiểm | Cảnh báo đo lường khác incident cần người xử lý. Chỉ tạo module riêng sau khi chốt các state và workflow cần lưu. |
| Hạ tầng production | Docker/deploy/CI scripts và tài liệu vận hành | Scaling, backup, restore, DR và rollout; không nhét orchestration hạ tầng vào module nghiệp vụ. |

## 4. Bảng module và phạm vi theo phase

### Phase 10 — Tích hợp hệ thống và nhà cung cấp

| Mục | Owner đích | Ranh giới và lưu ý |
|---|---|---|
| **10.1 HTTP Client** | `packages/http-client` | Bổ sung đầy đủ timeout, query params, lỗi typed, redaction, correlation/trace propagation, metric outbound và policy retry/breaker có giới hạn. Không retry lỗi nghiệp vụ; không log secret/query nhạy cảm. |
| **10.2 Webhook gửi ra** | `webhooks` | Endpoint/subscription, signing secret reference, event selection, delivery attempt/history, retry/backoff, manual replay có permission/audit, circuit-disable và SSRF-safe URL validation. |
| **10.3 Webhook nhận vào** | Module sở hữu provider/domain; `webhook-inbox` chỉ khi thật sự dùng chung | Mỗi adapter xác minh chữ ký/timestamp/event ID trước khi xử lý. Dedupe và lưu receipt có retention/redaction; xử lý nặng qua queue. Payment webhook thuộc `payments`; identity callback thuộc identity module. |
| **10.4 OAuth provider login** | `federated-identity`, phối hợp `auth` | Google/Microsoft là adapter tùy chọn; quản lý external subject/link, state/nonce/PKCE. `auth` giữ luồng đăng nhập/session. Phase 14 OIDC doanh nghiệp mở rộng cùng nền, không tạo luồng login thứ hai. |
| **10.5 Payment Port** | `payments` | Provider-neutral payment/transaction/refund contract; adapter theo nhà cung cấp; xác minh callback, amount/currency/reference và idempotency. Đối soát lưu lịch sử trong payments; không đặt thanh toán vào http-client hoặc settings. |
| **10.6 Provider Registry** | `provider-management` hoặc cấu hình ở domain module | Chỉ tách module quản trị nếu cần CRUD provider, routing theo tenant/unit, health, pause và audit thống nhất. Không ép Email/SMS/Payment/Storage/Identity vào một interface cấu hình chung quá rộng. Secret chỉ lưu dưới secret provider; registry lưu reference. |

**Phụ thuộc:** `webhooks` và `payments` cần event/queue reliability ở Phase 11; OAuth cần Phase 3 `auth`/`users` và mở rộng Phase 14; telemetry outbound chia sẻ nền Phase 12.

### Phase 11 — Event, độ tin cậy và an toàn dữ liệu

| Mục | Owner đích | Ranh giới và lưu ý |
|---|---|---|
| **11.1 Domain Event** | Contract/envelope tại `packages/messaging`; event nghiệp vụ do module phát | Envelope có ID, type, version, occurredAt, request/correlation/trace IDs và dữ liệu tối thiểu. Không serialize nguyên entity/secret. |
| **11.2 Outbox** | Hạ tầng `packages/messaging` phối hợp `packages/database` và worker | Outbox ghi cùng transaction nghiệp vụ; dispatcher có lease, retry giới hạn, dead-letter và replay có audit. Chốt migration ownership, transaction boundary và retention trước khi tạo bảng. |
| **11.3 Idempotency** | Contract/utility dùng chung cho HTTP, webhook và consumer; storage adapter phù hợp từng luồng | Scope key theo tenant/actor/operation; so payload fingerprint để phát hiện cùng key khác nội dung; retention rõ. Job queue cần business key riêng, không mặc định idempotency HTTP tương đương. |
| **11.4 Retry/timeout/breaker** | `packages/http-client` cho outbound HTTP; `packages/queue` cho job; adapter DB riêng | Retry theo phân loại lỗi, max attempts, backoff+jitter, deadline và concurrency limit. Không retry vô hạn, không retry lỗi nghiệp vụ, không tạo retry lồng không giới hạn. |
| **11.5 Reconciliation/repair** | Logic đối soát thuộc domain (`payments`, `webhooks`, v.v.); runner an toàn có thể tái dùng `packages/database/repair` | Mỗi quy trình có dry-run, diff, permission, audit before/after, phê duyệt khi nhạy cảm và compensation. Không tạo một service biết schema của mọi module. |

### Phase 12 — Logging, monitoring và quản trị vận hành (**redesign bắt buộc**)

| Mục | Owner đích | Phạm vi thiết kế lại |
|---|---|---|
| **12.1 Logging** | `packages/logging`; exporter theo cấu hình dự án | Structured JSON, context thống nhất, allowlist/redaction, giới hạn body, correlation/request/trace IDs. Tách lưu log local/Redis stream với export sang Loki/OpenSearch/SIEM qua adapter. |
| **12.2 Tracing** | Package kỹ thuật `packages/observability` hoặc `packages/tracing` (chọn một tên) | OpenTelemetry context propagation qua Fastify, DB, HTTP client, queue/worker. Sampling và redaction; không phát trace cho data nhạy cảm. |
| **12.3 Metrics và alerting** | `packages/metrics` + `alerting`; `modules/*-ops` chỉ query/render | Chuẩn hóa metric registry, labels/cardinality, unit, source, temporality, runtime, retention và rule. Prometheus lưu time-series; alert lifecycle/routing có một owner. |
| **12.4 Health** | `health` | Tách liveness (process) và readiness (khả năng nhận traffic); timeout và mức critical cho DB/Redis/Queue/Storage/provider; migration/version check có scope bảo mật. Không để dependency suy giảm làm liveness báo process chết không cần thiết. |
| **12.5 Operations Console** | `system-ops` + các trang/khu vực ops hiện có, sau khi chốt aggregation | Chỉ là giao diện/read model, nguồn thật cho mỗi ô và trạng thái `unavailable` tường minh. Tất cả thao tác thay đổi phải có permission/audit; không giữ snapshot thứ hai nếu nguồn gốc đã có API. |
| **12.6 Incidents/SIEM** | `incidents` nếu cần vòng đời sự cố; adapter SIEM tại integration layer | Security event đi từ `audit`/`security`; alert noise/dedup và owner/runbook thuộc incident workflow. SIEM là outbound adapter, không để monitoring module phụ thuộc vendor trực tiếp. |

#### Kế hoạch audit và làm lại Monitoring

1. **Inventory:** xuất danh mục route/response/metric/log/event/Redis key/rule/dashboard/test; ghi source-of-truth, owner, timestamp, đơn vị, retention và consumer cho từng trường.
2. **Đối chiếu production semantics:** kiểm tra dữ liệu ở API thực với Redis, BullMQ, DB/driver, Prometheus và Console; kiểm tra offline, no-sample, timeout, unsupported capability, restart/reset counter và nhiều instance.
3. **Chốt mô hình dữ liệu:** trạng thái hiện tại lấy từ API gốc; lịch sử metric từ Prometheus; log từ log store; event/alert lifecycle từ store duy nhất; trace từ backend tracing. Không dùng Redis để dựng lại time-series nếu Prometheus là nguồn.
4. **Thiết kế API/UI contract:** mỗi giá trị có `available`, `value` (nullable), `source`, `observedAt` và lỗi an toàn khi cần. Phân biệt rỗng hợp lệ với lỗi nguồn; không tạo fallback 0/healthy/now.
5. **Chốt ranh giới collector:** mỗi loại dữ liệu chỉ có một collector/owner; process metrics do từng runtime tự expose; datasource collectors không chạy trùng trên mọi API replica. Quy định lease, owner token, TTL và xử lý collector chết.
6. **Thiết kế lại rule/alert:** mỗi rule có input thật, cửa sổ thời gian, điều kiện clear, severity, dedupe, suppression và nguồn ngưỡng. Xóa rule không có dữ liệu có thể kích hoạt.
7. **Thực hiện theo slice:** Health/Overview → Runtime/HTTP → DB/Redis/Storage → Queue/Messaging/Scheduler → Logs/Alerts/Console. Mỗi slice phải đi từ instrumentation đến API, UI và test, không sửa riêng dashboard.
8. **Dọn phần cũ:** xóa metric/store/event/key/DTO/view chỉ sau khi tìm callers và xác minh migration/retention. Cập nhật các tài liệu cũ đang ghi monitoring đã hoàn tất để phản ánh trạng thái thật.

**Nguyên tắc bắt buộc:** lỗi Prometheus không được biến thành danh sách rỗng giống như “không có mẫu”; capability không hỗ trợ phải phân biệt với lỗi collector; event hồi phục không giả lập value/threshold bằng 0; metric không có writer phải bị loại khỏi API/UI.

### Phase 13 — HA, backup và DR

| Mục | Owner đích | Phạm vi và điều kiện |
|---|---|---|
| **13.1 Stateless** | `apps/*`, `packages/runtime`, deploy config | Session/file/business state không phụ thuộc process-local; graceful shutdown, drain, worker shutdown và scheduler lease. Đây là nền bắt buộc trước khi scale ngang. |
| **13.2 Autoscaling** | Deploy/platform profile | Export resource/request/backlog metrics đúng nghĩa; HPA/Kubernetes chỉ là profile tùy chọn. Load test và giới hạn DB/Redis đi cùng, không scale theo CPU đơn lẻ. |
| **13.3 DB Primary/Replica** | `packages/database` | Read/write routing, transaction luôn Primary, read-after-write consistency, replica lag và fallback policy. Chỉ triển khai cho driver/hạ tầng được hỗ trợ và có test riêng. |
| **13.4 Redis HA** | `packages/redis` | Sentinel/Cluster, reconnect, timeout, cache-degraded behavior và failover tests. Phân loại Redis key: cache có thể mất; queue/session/lock cần semantics riêng. |
| **13.5 LB/API Gateway** | Nginx/deploy + `packages/http` | Trusted proxy/IP, timeout/request limits, health check, rate limit phân tầng và API routing. Không duplicate rate-limit policy mà không có ownership rõ. |
| **13.6 Backup/Restore** | Scripts/CLI/deploy runbook | Backup DB/object storage, encryption, retention, kiểm tra restore vào môi trường cô lập và audit thao tác restore. Backup chỉ được coi là đạt sau restore drill. |
| **13.7 DR** | Hạ tầng dự án + runbook | Chốt RPO/RTO với người dùng trước khi làm; replication, failover/failback, đối soát và diễn tập định kỳ. Không mặc định cấu hình multi-region cho mọi dự án. |

### Phase 14 — SSO doanh nghiệp, quyền đặc biệt và compliance (**tùy chọn theo dự án**)

| Mục | Module/package đích | Ranh giới |
|---|---|---|
| **14.1 OIDC SSO** | Mở rộng `federated-identity` | Nhiều IdP, issuer/audience/state/nonce/PKCE, mapping claims/groups qua facade `users`/`roles`. |
| **14.2 SAML SSO** | Adapter của `federated-identity` | Metadata, chữ ký, audience, thời gian, replay và certificate rollover. Không đặt SAML core vào `auth` transport logic. |
| **14.3 SCIM** | `identity-provisioning` | API Users/Groups, external ID, idempotency, audit, reconcile và deprovision qua module contracts. Không ghi trực tiếp bảng users/roles. |
| **14.4 Privileged Access** | `privileged-access` | Quyền tạm thời, step-up MFA, approval, expiry, break-glass và review; tích hợp với `roles`, `mfa`, `approvals`, `audit`. |
| **14.5 Privacy/Data Governance** | `privacy-governance` | Classification, retention, subject access/delete/export, consent và legal hold. Tổng hợp qua module contracts; không truy vấn thẳng database của tất cả module. |
| **14.6 Compliance/Vendor Risk** | `compliance` và/hoặc `vendor-risk` chỉ khi có owner/quy trình riêng | Compliance controls/evidence khác Provider Registry kỹ thuật ở 10.6. Quản lý vendor, đánh giá dữ liệu, hợp đồng và bằng chứng không nên gộp vào health registry. |

### Phase 15 — CI/CD, nâng cấp, tài liệu và phát hành

| Mục | Owner đích | Kế hoạch |
|---|---|---|
| **15.1 CI quality** | `.github/workflows/ci.yml` | Giữ các gate đang có; kiểm tra cache/lockfile, coverage policy, module boundary và contract-diff theo nhóm thay đổi. |
| **15.2 Security scanning** | CI/security tooling | Bổ sung theo mức rủi ro: secret scan, dependency audit, SAST, image/license scan, SBOM; DAST trên staging có credential/scope an toàn. Không coi scan là thay thế review/test. |
| **15.3 Build/deploy** | CI/CD workflows + Docker | Build artifact/image một lần, gắn version/SHA, publish registry, staged deploy, approval production, smoke/health gate và rollback đã thử. |
| **15.4 Database deploy** | Migration CLI + CI/deploy | Lock migration, expand/contract, backfill riêng, kiểm tra lock duration/backup risk, post-migration check và lịch sử rollout. |
| **15.5 Core/module versioning** | Manifests + CLI + release metadata | SemVer, compatibility matrix, preview/diff/upgrade, deprecation window và rollback strategy. Không tự động downgrade schema như rollback package. |
| **15.6 Docs/ownership** | Tài liệu Core và repository governance | Cập nhật architecture, module creation, API, database, security, monitoring/incident, backup/DR; chỉ định owner/reviewer và quy trình đề xuất module vào Core. |
| **15.7 Pilot/Core V1** | Project template, CLI và release process | Dựng project mẫu qua CLI, kiểm thử end-to-end các module nền, operational drills, đo tài nguyên và pilot trước khi gắn nhãn Stable. |

## 5. Trình tự phụ thuộc đề xuất

| Đợt | Phạm vi | Vì sao làm theo thứ tự này |
|---|---|---|
| **0 — Architecture and observability audit** | Inventory modules, current monitoring, provider calls, Redis keys, metrics, API contracts, CI/deploy state. Chốt source-of-truth và decision log. | Tránh tiếp tục sửa dashboard trên dữ liệu sai hoặc xây abstraction trùng. |
| **1 — Phase 11 reliability contracts** | Event envelope, correlation, idempotency model, retry taxonomy và outbox design/ownership. | Là nền cho webhook, payment, notification delivery và cross-module workflows. |
| **2 — Phase 10 transport/integrations** | Sửa `http-client`, sau đó webhook outbound/inbound contracts, provider adapter, OAuth/payment theo domain. | Tích hợp ngoài cần timeout, idempotency, event/retry và monitoring có hợp đồng rõ. |
| **3 — Phase 12 monitoring redesign (core)** | Metric/log/trace contract, health endpoints, collector ownership, query/error semantics, console response contract. | Cần source data và integration propagation đã chốt; không làm lại UI trước contract. |
| **4 — Monitoring slices and alerting** | Runtime/HTTP → infra → queue/messaging → logs/alerts/console, mỗi slice từ instrument đến UI/test. | Tách nhỏ để đo được đúng nguồn và có thể rollback từng nhóm. |
| **5 — Phase 13 HA/DR capabilities** | Stateless/draining, DB/Redis HA profile, backup/restore drill, RPO/RTO và DR drill. | HA chỉ đáng tin khi telemetry và health phản ánh trạng thái đúng. |
| **6 — Phase 14 enterprise options** | OIDC/SAML, SCIM, privileged access, privacy/compliance theo yêu cầu pilot. | Dùng lại auth/audit/approval/reliability đã ổn định; không đưa mọi tùy chọn vào Core mặc định. |
| **7 — Phase 15 release engineering** | Security CI gates, deploy/migration workflow, version compatibility, docs, sample project và pilot. | Phát hành sau khi runtime, migration, monitoring và recovery đã được kiểm chứng. |

## 6. Gate bắt buộc trước mỗi lần triển khai

### Architecture gate

- Ghi module/package owner và dữ liệu được sở hữu.
- Vẽ phụ thuộc một chiều, không inject repository/entity chéo module.
- Chốt API/event schema, versioning, failure behavior và secrets handling.
- Với provider, ghi rõ adapter nào tùy chọn, retry/idempotency policy và điều kiện health.

### Data/monitoring gate

- Với mọi field hiển thị: nguồn, thời điểm quan sát, đơn vị, khi nào null, khi nào rỗng, lỗi nào trả unavailable.
- Xác định writer và reader của mọi metric/key/event/rule.
- Không đếm cùng sự kiện ở interceptor + provider + worker nếu không có reason/labels tránh double-count.
- Không lưu một bản time-series thứ hai chỉ để tiện render dashboard.
- Kiểm tra counter reset, missing samples, scrape gap, datasource timeout và multiple instances.

### Safety gate

- Không chạy migration lên môi trường thật trong bước phân tích hoặc không có xác nhận.
- Không replay webhook/event/payment hay chạy repair trên production nếu chưa có dry-run, permission, audit và approval cần thiết.
- Không log token, signing secret, payment payload nhạy cảm hoặc raw identity assertion.
- DAST/penetration-like test chỉ chạy với staging/test được phép, không nhắm mục tiêu bên ngoài.

## 7. Definition of Done

### Tích hợp và reliability

- Timeout, retry, breaker, idempotency và outbox có semantics được test cho cả success, transient failure, permanent failure, duplicate và timeout.
- Webhook ký/xác minh, replay, dedupe, retry, SSRF policy, audit và retention được test.
- Provider adapter thay được mà không sửa use case nghiệp vụ.

### Monitoring (tiêu chí chặn phát hành)

- Mỗi số liệu đều có nguồn, owner, timestamp và trạng thái khả dụng chính xác.
- Không có fallback `0`, `healthy`, `now`, mảng rỗng thành công hoặc event placeholder che mất lỗi nguồn.
- Health liveness/readiness phân biệt; alert có input, clear condition, dedupe và owner.
- Metrics/logs/traces có correlation thống nhất, redaction và label/cardinality được kiểm soát.
- API, Console và test phản ánh cùng contract; kiểm thử offline/no-sample/timeout/unsupported/multi-instance.
- Không còn collector, Redis key, rule, metric, API hoặc UI cũ không có writer/owner/caller.

### HA, enterprise và release

- DB/Redis HA có failover và consistency tests; backup có restore drill; DR có RPO/RTO và diễn tập.
- Tính năng enterprise có ownership, retention, access control, audit và module contract rõ.
- CI xác minh quality, schema, boundaries, migrations, security scan và artifact provenance tương ứng phạm vi phát hành.
- Tài liệu kiến trúc, compatibility matrix, runbook và project sample phản ánh code được phát hành.

## 8. Các quyết định cần chốt trước khi code

1. Provider Registry cần một module quản trị chung hay chỉ domain-specific config/adapters?
2. Outbox table là một bảng hạ tầng tập trung hay module-owned outbox theo bounded context? Cơ chế transaction nào hỗ trợ các DB driver hiện dùng?
3. Dùng Prometheus hiện tại hay cần chuẩn hóa OTel Collector/Prometheus exporter và trace backend nào? Logging Redis Stream giữ ngắn hạn hay bổ sung exporter bền vững?
4. Monitoring collector chạy ở runtime nào, có cần dedicated collector hay chỉ dùng scheduler/worker với lease?
5. RPO/RTO, vùng DR, loại database và Redis HA nào thực sự cần hỗ trợ mặc định?
6. Mức bảo mật/release target nào bắt buộc cho Core V1 (SAST, image scan, SBOM, DAST, signing/provenance)?
7. OAuth social login Phase 10 và enterprise OIDC/SAML Phase 14 dùng chung `federated-identity` theo compatibility/version nào?

## 9. Ngoài phạm vi tài liệu

- Chưa thay đổi code, schema, manifests, CI workflow hoặc Docker deployment.
- Chưa khẳng định toàn bộ monitoring hiện tại sai; xác định rõ phần cần kiểm chứng và các dấu hiệu cụ thể ở Mục 2.
- Chưa chọn vendor cụ thể cho tracing, SIEM, payment, OAuth, email/SMS, database replica hoặc Redis HA.
- Chưa lập migration chi tiết hoặc kế hoạch tuần; chỉ lập thứ tự phụ thuộc và gate để không tách module sai.
