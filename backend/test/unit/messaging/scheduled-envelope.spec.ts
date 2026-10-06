import { describe, it, expect } from '@jest/globals';
import { parseEnvelope, scheduledEnvelope } from '@packages/messaging/index.js';

describe('scheduledEnvelope — job do Job Scheduler / Run Now tạo', () => {
  const at = Date.parse('2026-10-06T01:00:00.000Z');

  it('job lặp của Job Scheduler (có repeatJobKey) → envelope theo id job, topic = tên job', () => {
    const job = {
      id: 'repeat:system.maintenance:1791248400000',
      name: 'system.maintenance.tick',
      data: {},
      timestamp: at,
      repeatJobKey: 'system.maintenance',
    };
    // Trước đây data không phải envelope → worker ném "Malformed envelope" ở mọi lần chạy.
    expect(parseEnvelope(job.data)).toBeNull();
    expect(scheduledEnvelope(job)).toMatchObject({
      id: job.id,
      topic: 'system.maintenance.tick',
      producer: 'scheduler',
      correlationId: job.id,
      timestamp: '2026-10-06T01:00:00.000Z',
    });
  });

  it('Run Now (jobId manual:<task>:<ts>) cũng được nhận', () => {
    const env = scheduledEnvelope({
      id: 'manual:system.maintenance:1791248400000',
      name: 'system.maintenance.tick',
      data: { a: 1 },
      timestamp: at,
    });
    expect(env).toMatchObject({ topic: 'system.maintenance.tick', payload: { a: 1 } });
  });

  it('job thường không có envelope vẫn bị từ chối', () => {
    expect(scheduledEnvelope({ id: '42', name: 'x', data: { foo: 1 }, timestamp: at })).toBeNull();
  });
});
