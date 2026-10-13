import { createContext, useContext } from 'react';
import type { RefreshMs, TimeRange } from '../constants/ui.constants';

export interface LiveContextValue {
  /** Chu kỳ tự làm mới người dùng chọn (0 = tắt). */
  refreshMs: RefreshMs;
  setRefreshMs: (ms: RefreshMs) => void;
  /** Khoảng thời gian xem dữ liệu, dùng chung toàn app. */
  range: TimeRange;
  setRange: (range: TimeRange) => void;
  /** Làm mới ngay mọi query đang hiển thị. */
  refreshNow: () => void;
}

export const LiveContext = createContext<LiveContextValue | null>(null);

export const useLive = (): LiveContextValue => {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive must be used within a DataProvider');
  return ctx;
};
