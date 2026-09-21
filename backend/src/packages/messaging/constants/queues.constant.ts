export const QUEUES = {
  SYSTEM_EVENTS: 'system.events',
  NOTIFICATIONS: 'system.notifications',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
