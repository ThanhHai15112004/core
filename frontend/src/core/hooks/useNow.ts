import { useEffect, useState } from 'react';

/** Timestamp hiện tại, cập nhật mỗi `intervalMs` để text dạng "x giây trước" tự chạy. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
