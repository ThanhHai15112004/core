import {
  DR_CHECKLIST_STEP_STATUS,
  DR_DISCREPANCY_KIND,
  type DrTopologyMode,
} from '../enum/dr-ops.enum.js';
import type {
  DrChecklistItem,
  DrComplianceStatus,
  DrDiscrepancyItem,
} from '../types/dr-ops.types.js';

export interface SnapshotRecord {
  readonly key: string;
  readonly checksumOrSize: string | number;
}

/** Đánh giá mức tuân thủ RPO dựa trên độ trễ dữ liệu thực tế và ngưỡng mục tiêu. */
export function evaluateRpoCompliance(
  actualRpoSeconds: number | null | undefined,
  rpoTargetSeconds: number,
): { met: boolean; status: DrComplianceStatus } {
  if (actualRpoSeconds === null || actualRpoSeconds === undefined || actualRpoSeconds < 0) {
    return { met: false, status: 'UNKNOWN' };
  }
  const met = actualRpoSeconds <= rpoTargetSeconds;
  return { met, status: met ? 'MET' : 'BREACHED' };
}

/** Đánh giá mức tuân thủ RTO dựa trên thời gian khôi phục thực tế và ngưỡng mục tiêu. */
export function evaluateRtoCompliance(
  actualRtoSeconds: number | null | undefined,
  rtoTargetSeconds: number,
): { met: boolean; status: DrComplianceStatus } {
  if (actualRtoSeconds === null || actualRtoSeconds === undefined || actualRtoSeconds < 0) {
    return { met: false, status: 'UNKNOWN' };
  }
  const met = actualRtoSeconds <= rtoTargetSeconds;
  return { met, status: met ? 'MET' : 'BREACHED' };
}

function makeStep(
  order: number,
  stepKey: string,
  title: string,
  description: string,
  category: DrChecklistItem['category'],
  required: boolean,
): DrChecklistItem {
  return {
    stepKey,
    order,
    title,
    description,
    category,
    required,
    status: DR_CHECKLIST_STEP_STATUS.PENDING,
    completedBy: null,
    completedAt: null,
    note: null,
  };
}

/** Sinh checklist chuyển hệ thống sang site DR (Failover) theo mô hình DC–DR. */
export function buildFailoverChecklist(topologyMode: DrTopologyMode): DrChecklistItem[] {
  const needsBackupRestore = topologyMode === 'BACKUP_RESTORE' || topologyMode === 'PILOT_LIGHT';

  return [
    makeStep(
      1,
      'confirm_primary_outage',
      'Xác nhận sự cố DC chính & mở biên bản Failover',
      'Xác nhận DC chính không thể tự phục hồi trong ngưỡng RTO và đã thông báo người phụ trách.',
      'PREPARATION',
      true,
    ),
    makeStep(
      2,
      'freeze_primary_writes',
      'Chặn ghi vào DC chính (Anti Split-Brain)',
      'Đóng ingress / thu hồi quyền ghi hoặc cô lập Primary cũ để không phát sinh ghi kép (split-brain).',
      'PREPARATION',
      true,
    ),
    makeStep(
      3,
      'verify_dr_db_checkpoint',
      needsBackupRestore
        ? 'Nạp & xác minh bản sao lưu DB mới nhất lên DR'
        : 'Kiểm tra checkpoint & độ trễ Replica DB tại DR',
      needsBackupRestore
        ? 'Restore bản backup đã verify mới nhất sang DB tại site DR và kiểm tra migration.'
        : 'Kiểm tra vị trí binlog/WAL mới nhất và mức độ đồng bộ dữ liệu trên DB standby DR.',
      'DATABASE',
      true,
    ),
    makeStep(
      4,
      'promote_dr_database',
      'Promote Database tại DR thành Primary (Read-Write)',
      'Tắt chế độ read-only trên DB DR, mở kết nối cho API/Worker tại DR.',
      'DATABASE',
      true,
    ),
    makeStep(
      5,
      'verify_dr_storage_sync',
      'Kiểm tra đồng bộ Object Storage tại DR',
      'Xác nhận bucket/thư mục Storage tại DR đã nhận đủ file và sẵn sàng phục vụ.',
      'STORAGE',
      true,
    ),
    makeStep(
      6,
      'switch_traffic_to_dr',
      'Chuyển định tuyến DNS / Load Balancer sang site DR',
      'Cập nhật DNS/LB trỏ lưu lượng người dùng vào endpoint API/Frontend của site DR.',
      'TRAFFIC',
      true,
    ),
    makeStep(
      7,
      'verify_dr_health_smoke',
      'Kiểm tra Healthcheck (/health/ready) & luồng nghiệp vụ trọng yếu',
      'Xác nhận API, Worker, Scheduler, DB, Redis và Storage tại DR đều healthy.',
      'VERIFICATION',
      true,
    ),
    makeStep(
      8,
      'run_post_failover_reconciliation',
      'Đối soát dữ liệu sau Failover',
      'Chạy đối soát DB & Storage để ghi nhận mốc dữ liệu hoặc phát hiện thiếu/trùng nếu có.',
      'VERIFICATION',
      false,
    ),
  ];
}

/** Sinh checklist chuyển về hệ thống chính (Failback an toàn, chống split-brain). */
export function buildFailbackChecklist(topologyMode: DrTopologyMode): DrChecklistItem[] {
  const isCold = topologyMode === 'BACKUP_RESTORE';

  return [
    makeStep(
      1,
      'verify_primary_dc_recovered',
      'Xác nhận hạ tầng DC chính đã ổn định hoàn toàn',
      'Kiểm tra điện, mạng, compute, DB và Storage tại DC chính sẵn sàng nhận đồng bộ ngược.',
      'PREPARATION',
      true,
    ),
    makeStep(
      2,
      'setup_reverse_replication',
      isCold
        ? 'Tạo snapshot đầy đủ từ DR để chuẩn bị nạp về DC chính'
        : 'Thiết lập đồng bộ ngược (Reverse Replication) DR → DC chính',
      'Đồng bộ toàn bộ dữ liệu phát sinh trong thời gian chạy trên DR về lại DC chính.',
      'DATABASE',
      true,
    ),
    makeStep(
      3,
      'freeze_dr_writes_maintenance',
      'Bật cửa sổ bảo trì & chặn ghi trên site DR',
      'Dừng Worker/Scheduler và chuyển API DR sang read-only để chốt điểm đồng bộ 0-lag.',
      'PREPARATION',
      true,
    ),
    makeStep(
      4,
      'verify_reverse_sync_zero_lag',
      'Xác nhận đồng bộ ngược đạt lag = 0',
      'Đảm bảo mọi giao dịch cuối cùng trên DR đã có mặt đầy đủ tại DC chính trước khi tráo role.',
      'DATABASE',
      true,
    ),
    makeStep(
      5,
      'promote_primary_database',
      'Mở Read-Write trở lại trên Database DC chính',
      'Promote lại DB DC chính và hạ DB DR về chế độ standby.',
      'DATABASE',
      true,
    ),
    makeStep(
      6,
      'sync_storage_dr_to_primary',
      'Đồng bộ ngược Object Storage từ DR về DC chính',
      'Chép toàn bộ file mới/cập nhật phát sinh tại DR về Storage của DC chính.',
      'STORAGE',
      true,
    ),
    makeStep(
      7,
      'switch_traffic_to_primary',
      'Chuyển định tuyến DNS / Load Balancer về DC chính',
      'Đổi DNS/LB trỏ lưu lượng người dùng trở lại DC chính và gỡ chế độ bảo trì.',
      'TRAFFIC',
      true,
    ),
    makeStep(
      8,
      'verify_primary_health_smoke',
      'Kiểm tra Healthcheck (/health/ready) tại DC chính',
      'Xác nhận toàn bộ runtime API/Worker/Scheduler hoạt động bình thường trên DC chính.',
      'VERIFICATION',
      true,
    ),
    makeStep(
      9,
      'run_post_failback_reconciliation',
      'Đối soát dữ liệu sau Failback',
      'Kiểm tra không mất và không trùng bản ghi/file sau khi quay về DC chính.',
      'VERIFICATION',
      true,
    ),
    makeStep(
      10,
      'resume_primary_to_dr_replication',
      'Khôi phục chiều đồng bộ DC chính → DR dự phòng',
      'Đảm bảo site DR tiếp tục được đồng bộ bình thường cho chu kỳ dự phòng tiếp theo.',
      'VERIFICATION',
      false,
    ),
  ];
}

/** Kiểm tra xem toàn bộ bước bắt buộc trong checklist đã COMPLETED chưa. */
export function validateChecklistReadyForCompletion(steps: readonly DrChecklistItem[]): {
  ready: boolean;
  pendingRequiredKeys: string[];
} {
  const pendingRequiredKeys = steps
    .filter((s) => s.required && s.status !== DR_CHECKLIST_STEP_STATUS.COMPLETED)
    .map((s) => s.stepKey);

  return {
    ready: pendingRequiredKeys.length === 0,
    pendingRequiredKeys,
  };
}

/**
 * Thuật toán đối soát thuần túy giữa danh sách khóa/dữ liệu ở Primary và DR:
 * phát hiện khóa bị trùng (DUPLICATE_KEY), thiếu trên DR (MISSING_ON_TARGET),
 * dư trên DR (EXTRA_ON_TARGET) và sai lệch kích thước/checksum (SIZE_MISMATCH).
 */
export function diffDataSnapshots(params: {
  area: 'DATABASE' | 'STORAGE';
  target: string;
  primaryRecords: readonly SnapshotRecord[];
  drRecords: readonly SnapshotRecord[];
}): {
  findings: DrDiscrepancyItem[];
  missingCount: number;
  duplicateCount: number;
  mismatchCount: number;
} {
  const findings: DrDiscrepancyItem[] = [];
  const primaryMap = new Map<string, string | number>();
  const primaryCounts = new Map<string, number>();

  for (const rec of params.primaryRecords) {
    primaryCounts.set(rec.key, (primaryCounts.get(rec.key) ?? 0) + 1);
    if (!primaryMap.has(rec.key)) {
      primaryMap.set(rec.key, rec.checksumOrSize);
    }
  }

  const drMap = new Map<string, string | number>();
  const drCounts = new Map<string, number>();

  for (const rec of params.drRecords) {
    drCounts.set(rec.key, (drCounts.get(rec.key) ?? 0) + 1);
    if (!drMap.has(rec.key)) {
      drMap.set(rec.key, rec.checksumOrSize);
    }
  }

  let missingCount = 0;
  let duplicateCount = 0;
  let mismatchCount = 0;

  for (const [key, count] of primaryCounts.entries()) {
    if (count > 1) {
      duplicateCount++;
      findings.push({
        area: params.area,
        target: params.target,
        key,
        kind: DR_DISCREPANCY_KIND.DUPLICATE_KEY,
        primaryValue: count,
        drValue: drCounts.get(key) ?? 0,
        detail: `Duplicate key detected on primary (${count} occurrences)`,
      });
    }
  }

  for (const [key, count] of drCounts.entries()) {
    if (count > 1) {
      duplicateCount++;
      findings.push({
        area: params.area,
        target: params.target,
        key,
        kind: DR_DISCREPANCY_KIND.DUPLICATE_KEY,
        primaryValue: primaryCounts.get(key) ?? 0,
        drValue: count,
        detail: `Duplicate key detected on DR target (${count} occurrences)`,
      });
    }
  }

  for (const [key, pVal] of primaryMap.entries()) {
    if (!drMap.has(key)) {
      missingCount++;
      findings.push({
        area: params.area,
        target: params.target,
        key,
        kind: DR_DISCREPANCY_KIND.MISSING_ON_TARGET,
        primaryValue: pVal,
        drValue: null,
        detail: `Key "${key}" exists on primary but is missing on DR target`,
      });
      continue;
    }

    const dVal = drMap.get(key)!;
    if (String(pVal) !== String(dVal)) {
      mismatchCount++;
      findings.push({
        area: params.area,
        target: params.target,
        key,
        kind:
          params.area === 'STORAGE'
            ? DR_DISCREPANCY_KIND.SIZE_MISMATCH
            : DR_DISCREPANCY_KIND.ROW_COUNT_MISMATCH,
        primaryValue: pVal,
        drValue: dVal,
        detail: `Value mismatch for "${key}": primary=${String(pVal)}, dr=${String(dVal)}`,
      });
    }
  }

  for (const [key, dVal] of drMap.entries()) {
    if (!primaryMap.has(key)) {
      missingCount++;
      findings.push({
        area: params.area,
        target: params.target,
        key,
        kind: DR_DISCREPANCY_KIND.EXTRA_ON_TARGET,
        primaryValue: null,
        drValue: dVal,
        detail: `Key "${key}" exists on DR target but is missing on primary`,
      });
    }
  }

  return { findings, missingCount, duplicateCount, mismatchCount };
}
