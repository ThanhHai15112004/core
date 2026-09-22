import { useState, useCallback } from 'react';
import type { OpsEventLog, EventLogLevel } from '../types/console.types';

/** Nhật ký các thao tác thật trong phiên Console hiện tại (không có sự kiện mẫu). */
export function useEventLog() {
  const [events, setEvents] = useState<OpsEventLog[]>([]);

  const addEvent = useCallback(
    (level: EventLogLevel, source: string, message: string, data?: unknown) => {
      const newEvt: OpsEventLog = {
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date(),
        level,
        source,
        message,
        data,
      };
      setEvents((prev) => [newEvt, ...prev.slice(0, 150)]);
    },
    [],
  );

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    events,
    addEvent,
    clearEvents,
  };
}
