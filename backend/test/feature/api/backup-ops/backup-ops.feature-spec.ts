import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';

describe('Feature: Backup & Restore Ops API (/ops/backups)', () => {
  let context: TestAppContext;

  beforeAll(async () => {
    process.env['BACKUP_ENCRYPTION_KEY'] = 'feature-test-backup-encryption-key-2026';
    process.env['BACKUP_DRILL_PASSWORD'] = 'secret-drill-password';
    context = await createTestApp();
  });

  afterAll(async () => {
    delete process.env['BACKUP_ENCRYPTION_KEY'];
    delete process.env['BACKUP_DRILL_PASSWORD'];
    if (context) {
      await context.close();
    }
  });

  it('GET /ops/backups/overview, /policies, /records, /restores, /storage/versioning and /runbook return valid responses', async () => {
    const [overviewRes, policiesRes, recordsRes, restoresRes, versioningRes, runbookRes] =
      await Promise.all([
        context.injectJson<{
          enabled: boolean;
          encryptionConfigured: boolean;
          encryptionEnabled: boolean;
          storageVersioning: { driver: string; supported: boolean; status: string };
        }>({ method: 'GET', url: '/ops/backups/overview' }),
        context.injectJson<unknown[]>({ method: 'GET', url: '/ops/backups/policies' }),
        context.injectJson<unknown[]>({ method: 'GET', url: '/ops/backups/records' }),
        context.injectJson<unknown[]>({ method: 'GET', url: '/ops/backups/restores' }),
        context.injectJson<{ driver: string; status: string }>({
          method: 'GET',
          url: '/ops/backups/storage/versioning',
        }),
        context.injectJson<{
          sections: Array<{ id: string }>;
          postRestoreChecklist: string[];
        }>({ method: 'GET', url: '/ops/backups/runbook' }),
      ]);

    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.success).toBe(true);
    expect(overviewRes.body.data.enabled).toBe(true);
    expect(overviewRes.body.data.encryptionConfigured).toBe(true);
    expect(overviewRes.body.data.encryptionEnabled).toBe(true);

    expect(policiesRes.status).toBe(200);
    expect(Array.isArray(policiesRes.body.data)).toBe(true);

    expect(recordsRes.status).toBe(200);
    expect(Array.isArray(recordsRes.body.data)).toBe(true);

    expect(restoresRes.status).toBe(200);
    expect(Array.isArray(restoresRes.body.data)).toBe(true);

    expect(versioningRes.status).toBe(200);
    expect(versioningRes.body.data.driver).toBeDefined();

    expect(runbookRes.status).toBe(200);
    expect(runbookRes.body.data.sections.map((s) => s.id)).toEqual([
      'database',
      'storage',
      'secrets',
      'config',
    ]);
    expect(runbookRes.body.data.postRestoreChecklist.length).toBeGreaterThan(0);
  });

  it('POST /ops/backups/restores rejects missing/short reason and unconfirmed live restore', async () => {
    const missingReason = await context.injectJson({
      method: 'POST',
      url: '/ops/backups/restores',
      payload: {
        mode: 'RECORD_MANUAL',
        scope: 'DATABASE',
        targetEnvironment: 'staging',
        actorName: 'ops-tester',
        reason: 'ok',
      },
    });
    expect(missingReason.status).toBeGreaterThanOrEqual(400);
    expect(missingReason.status).toBeLessThan(500);

    const invalidVersioningConfirm = await context.injectJson({
      method: 'POST',
      url: '/ops/backups/storage/versioning/enable',
      payload: { confirm: 'WRONG' },
    });
    expect(invalidVersioningConfirm.status).toBeGreaterThanOrEqual(400);
    expect(invalidVersioningConfirm.status).toBeLessThan(500);
  });

  it('GET /ops/configuration masks backup.encryptionKey and backup.drillPassword', async () => {
    const res = await context.injectJson<
      Array<{ domain: string; key: string; value: unknown; sensitive: boolean }>
    >({
      method: 'GET',
      url: '/ops/configuration',
    });

    expect(res.status).toBe(200);
    const encItem = res.body.data.find((i) => i.domain === 'backup' && i.key === 'encryptionKey');
    const drillPwdItem = res.body.data.find(
      (i) => i.domain === 'backup' && i.key === 'drillPassword',
    );
    expect(encItem).toBeDefined();
    expect(encItem?.sensitive).toBe(true);
    expect(encItem?.value).toBe('••••••••');
    expect(drillPwdItem?.sensitive).toBe(true);
    expect(drillPwdItem?.value).toBe('••••••••');
  });
});
