import { useState, useCallback } from 'react';
import type { OpsEventLog, EventLogLevel } from '../types/console.types';

const INITIAL_EVENTS: OpsEventLog[] = [
  {
    id: 'evt-boot-1',
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    level: 'info',
    source: 'kernel',
    message: 'System Kernel initialized with Fastify adapter and TypeORM auto-load',
  },
  {
    id: 'evt-boot-2',
    timestamp: new Date(Date.now() - 1000 * 60 * 4),
    level: 'success',
    source: 'database',
    message: 'TypeORM connection established to MySQL database',
  },
  {
    id: 'evt-boot-3',
    timestamp: new Date(Date.now() - 1000 * 60 * 3),
    level: 'success',
    source: 'cache',
    message: 'Redis client connected to redis://redis:6379',
  },
  {
    id: 'evt-boot-4',
    timestamp: new Date(Date.now() - 1000 * 60 * 2),
    level: 'info',
    source: 'logging',
    message: 'Pino structured logging transport active at level [info]',
  },
  {
    id: 'evt-boot-5',
    timestamp: new Date(Date.now() - 1000 * 30),
    level: 'info',
    source: 'ops',
    message: 'System Console session started. Connected to API Gateway.',
  },
];

export function useEventLog() {
  const [events, setEvents] = useState<OpsEventLog[]>(INITIAL_EVENTS);

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
