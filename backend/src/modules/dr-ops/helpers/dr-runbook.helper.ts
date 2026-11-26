import type { DrRunbookView } from '../types/dr-ops.types.js';

/** Sinh Runbook chuẩn vận hành Disaster Recovery (Mục 13.7). */
export function buildDrRunbook(): DrRunbookView {
  return {
    version: '1.0.0',
    updatedAt: '2026-11-26',
    topologyModes: [
      {
        mode: 'BACKUP_RESTORE',
        summary: 'Lưu backup mã hóa (13.6) sang vùng DR; dựng lại khi có thảm họa. Chi phí thấp nhất.',
        typicalRpo: '1 – 24 giờ',
        typicalRto: '2 – 8 giờ',
      },
      {
        mode: 'PILOT_LIGHT',
        summary: 'DB standby chạy tối thiểu tại DR, các runtime API/Worker bật khi Failover.',
        typicalRpo: '5 – 15 phút',
        typicalRto: '30 – 60 phút',
      },
      {
        mode: 'WARM_STANDBY',
        summary: 'DC chính phục vụ traffic; site DR luôn đồng bộ DB/Storage và chạy sẵn bản thu gọn.',
        typicalRpo: '1 – 15 phút',
        typicalRto: '10 – 30 phút',
      },
      {
        mode: 'HOT_STANDBY',
        summary: 'Hai site chạy song song gần như thời gian thực (Active-Active / Multi-region).',
        typicalRpo: '< 1 phút',
        typicalRto: '< 5 phút',
      },
    ],
    sections: [
      {
        id: 'rpo-rto',
        title: '1. Xác định RPO / RTO & Mô hình DC–DR',
        summary:
          'Chốt rõ mức mất dữ liệu tối đa chấp nhận được (RPO) và thời gian khôi phục tối đa (RTO) trước khi kích hoạt DR.',
        steps: [
          'Cấu hình RPO/RTO mặc định qua biến môi trường DR_RPO_TARGET_SECONDS / DR_RTO_TARGET_SECONDS hoặc trong Console → Disaster Recovery.',
          'Chỉ bật DR_ENABLED=true cho các dự án thực sự yêu cầu mô hình DC chính và DR dự phòng.',
          'Kiểm tra cảnh báo tự động khi lần đồng bộ gần nhất vượt ngưỡng RPO hoặc quá hạn diễn tập DR.',
        ],
        commands: ['npm --prefix backend run cli -- dr:status'],
      },
      {
        id: 'replication',
        title: '2. Đồng bộ Database & Storage sang DR',
        summary:
          'Đảm bảo dữ liệu Database và Object Storage tại DR luôn bám sát RPO đã chốt.',
        steps: [
          'Database: theo dõi Replication Lag tới Replica/Standby DR hoặc tuổi bản sao lưu đã verify gần nhất.',
          'Object Storage: đồng bộ delta các object từ Storage chính sang kho dự phòng DR và kiểm tra kích thước/checksum.',
          'Lịch đồng bộ định kỳ chạy qua BullMQ Scheduler (dr.sync.tick) hoặc chạy tay trước khi chuyển site.',
        ],
        commands: ['npm --prefix backend run cli -- dr:sync --scope=FULL'],
      },
      {
        id: 'failover',
        title: '3. Kịch bản Failover (Chuyển sang DR)',
        summary:
          'Thực hiện có kiểm soát theo checklist bắt buộc khi DC chính gặp sự cố không thể phục hồi trong ngưỡng RTO.',
        steps: [
          'Khởi tạo phiên Failover (SIMULATED để diễn tập hoặc LIVE khi bật DR_LIVE_SWITCH_ENABLED=true và xác nhận "FAILOVER").',
          'Chặn ghi vào DC chính trước khi promote DB tại DR để tránh split-brain.',
          'Tick hoàn tất toàn bộ các bước bắt buộc trong checklist, chuyển DNS/LB sang DR và kiểm tra /health/ready.',
          'Chạy đối soát dữ liệu ngay sau khi hoàn tất Failover.',
        ],
        commands: [
          'npm --prefix backend run cli -- dr:failover --mode=SIMULATED --reason="Dien tap su co DC chinh"',
        ],
      },
      {
        id: 'failback',
        title: '4. Kịch bản Failback (Chuyển về hệ thống chính an toàn)',
        summary:
          'Chỉ chuyển về DC chính sau khi đã đồng bộ ngược dữ liệu phát sinh ở DR và xác nhận lag = 0.',
        steps: [
          'Xác nhận DC chính đã ổn định và thiết lập đồng bộ ngược DR → DC chính.',
          'Đóng quyền ghi tạm thời trên DR (maintenance window) để chốt lag = 0.',
          'Promote lại DC chính, đồng bộ ngược Storage, chuyển DNS/LB về DC chính và chạy đối soát.',
        ],
        commands: [
          'npm --prefix backend run cli -- dr:failback --mode=SIMULATED --reason="Quay ve DC chinh sau khi khac phuc"',
        ],
      },
      {
        id: 'reconciliation-drill',
        title: '5. Đối soát dữ liệu & Diễn tập DR định kỳ',
        summary:
          'Phát hiện thiếu/trùng bản ghi DB & object Storage sau khi chuyển site, đồng thời đo RTO/RPO thực tế định kỳ.',
        steps: [
          'Chạy dr:reconcile sau mỗi lần Failover hoặc Failback để phát hiện MISSING/DUPLICATE/MISMATCH.',
          'Tổ chức diễn tập DR định kỳ (mặc định 30 ngày/lần) để đo RPO & RTO thực tế so với mục tiêu.',
          'Ghi nhận lessons learned vào từng phiên diễn tập để cải thiện checklist.',
        ],
        commands: [
          'npm --prefix backend run cli -- dr:reconcile --scope=FULL',
          'npm --prefix backend run cli -- dr:drill --scenario="Monthly DR simulation"',
        ],
      },
    ],
    antiSplitBrainRules: [
      'Tuyệt đối không để cả DC chính và DR cùng nhận lệnh ghi (Read-Write) đồng thời trong cùng một lúc.',
      'Mọi thao tác Failback LIVE bị chặn nếu hệ thống đang chạy ở PRIMARY hoặc chưa hoàn tất bước chặn ghi trên DR.',
      'Chốt DR_LIVE_SWITCH_ENABLED luôn mặc định false ở môi trường thường và chỉ mở khi bảo trì/sự cố có xác nhận.',
    ],
  };
}
