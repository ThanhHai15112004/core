/** Chuỗi của bộ UI dùng chung (core/ui, core/data) — namespace `ui.*`. */
export const uiVi = {
  toast: {
    done: 'Đã thực hiện',
    failed: 'Thao tác thất bại',
    copied: 'Đã sao chép',
  },
  state: {
    loading: 'Đang tải…',
    empty: 'Chưa có dữ liệu',
    error: 'Không tải được dữ liệu',
    noSource: 'Chưa có nguồn dữ liệu',
    retry: 'Thử lại',
    offline: 'Mất kết nối tới máy chủ — đang hiển thị dữ liệu gần nhất',
  },
  action: {
    refresh: 'Làm mới',
    copy: 'Sao chép',
    close: 'Đóng',
    cancel: 'Huỷ',
    confirm: 'Xác nhận',
    back: 'Quay lại',
    expand: 'Mở rộng',
    collapse: 'Thu gọn',
    showMore: 'Xem thêm',
    showLess: 'Ẩn bớt',
    loadMore: 'Tải thêm',
    fullscreen: 'Phóng to',
    exitFullscreen: 'Thu nhỏ',
    inspect: 'Xem chi tiết',
    settings: 'Cấu hình',
    search: 'Tìm kiếm',
    clear: 'Xoá lọc',
  },
  time: {
    range: 'Khoảng thời gian',
    last: '{{range}} gần nhất',
    ranges: {
      '5m': '5 phút',
      '15m': '15 phút',
      '1h': '1 giờ',
      '6h': '6 giờ',
      '24h': '24 giờ',
      '7d': '7 ngày',
    },
    updated: 'Cập nhật {{time}}',
    since: 'từ {{time}}',
  },
  refresh: {
    label: 'Tự làm mới',
    off: 'Tắt',
    every: 'Mỗi {{value}}',
    live: 'Live',
    paused: 'Tạm dừng',
  },
  theme: {
    toggle: 'Đổi giao diện',
    dark: 'Tối',
    light: 'Sáng',
  },
  locale: {
    toggle: 'Đổi ngôn ngữ',
  },
  table: {
    sortAsc: 'Sắp xếp tăng dần',
    sortDesc: 'Sắp xếp giảm dần',
    rows: '{{count}} dòng',
    showing: 'Hiển thị {{shown}} / {{total}}',
    filter: 'Lọc…',
    noMatch: 'Không có dòng nào khớp bộ lọc',
  },
  stat: {
    source: 'Nguồn: {{source}}',
    window: 'Cửa sổ: {{window}}',
    vsPrevious: 'so với kỳ trước',
  },
  confirm: {
    typeToConfirm: 'Gõ {{word}} để xác nhận',
    impact: 'Ảnh hưởng',
  },
  command: {
    pages: 'Trang',
    actions: 'Thao tác',
    open: 'Tìm nhanh',
    placeholder: 'Nhập tên trang, queue, task…',
    empty: 'Không tìm thấy',
    hint: 'Ctrl K',
  },
  sidebar: {
    collapse: 'Thu gọn thanh bên',
    expand: 'Mở rộng thanh bên',
    menu: 'Mở menu',
  },
  chart: {
    noData: 'Không có dữ liệu trong khoảng này',
    threshold: 'Ngưỡng',
  },
  feed: {
    all: 'Tất cả',
    empty: 'Chưa có hoạt động nào',
  },
  compare: {
    metric: 'Chỉ số',
    current: 'Hôm nay',
    previous: 'Hôm qua',
    change: 'Thay đổi',
  },
  alerts: {
    none: 'Không có vấn đề nào',
    okChecks: '{{count}} kiểm tra đạt',
  },
  json: {
    empty: 'Không có dữ liệu',
  },
  status: {
    ok: 'Ổn định',
    warn: 'Cảnh báo',
    crit: 'Nghiêm trọng',
    info: 'Thông tin',
    unknown: 'Chưa rõ',
  },
};

export type UiTranslation = typeof uiVi;
