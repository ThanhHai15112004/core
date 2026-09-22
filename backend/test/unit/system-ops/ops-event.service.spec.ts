import { describe, it, expect, beforeEach } from '@jest/globals';
import { OpsEventService } from '@modules/system-ops/services/ops-event.service.js';
import { CoreI18nService, LocaleContext } from '@packages/i18n/index.js';
import { PackageStatus } from '@packages/kernel/index.js';

describe('OpsEventService', () => {
  let events: OpsEventService;

  beforeEach(() => {
    events = new OpsEventService(new CoreI18nService());
  });

  it('records the API start event on creation', () => {
    const recent = LocaleContext.run('en', () => events.getRecent());
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      level: 'info',
      source: 'API Gateway',
      message: 'API process started',
    });
  });

  it('does not emit an event for an initially healthy package', () => {
    events.trackStatus('cache', 'Cache', PackageStatus.HEALTHY);
    events.trackStatus('cache', 'Cache', PackageStatus.HEALTHY);
    expect(events.getRecent()).toHaveLength(1);
  });

  it('emits events on status changes and tracks since when', () => {
    events.trackStatus('db', 'Database', PackageStatus.HEALTHY);
    events.trackStatus('db', 'Database', PackageStatus.ERROR);
    const since = events.getStatusSince('db');
    events.trackStatus('db', 'Database', PackageStatus.ERROR);
    events.trackStatus('db', 'Database', PackageStatus.HEALTHY);

    const [recovered, failed] = LocaleContext.run('en', () => events.getRecent());
    expect(failed).toMatchObject({
      level: 'error',
      source: 'Database',
      message: 'Status changed from Healthy to Error',
    });
    expect(recovered).toMatchObject({ level: 'success', message: 'Recovered (Error → Healthy)' });
    expect(since).toBeInstanceOf(Date);
  });

  it('flags packages that start in a warning state', () => {
    events.trackStatus('security', 'Security', PackageStatus.WARNING);
    const [first] = LocaleContext.run('en', () => events.getRecent());
    expect(first).toMatchObject({ level: 'warn', message: 'Detected Warning state' });
  });
});
