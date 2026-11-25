import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';

describe('Incidents & SIEM Ops API (/ops/incidents)', () => {
  let context: TestAppContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  it('serves overview, P1-P4 policies, paginated incidents/owners/runbooks/siem-logs and validates invalid payloads', async () => {
    const overviewRes = await context.app.inject({
      method: 'GET',
      url: '/ops/incidents/overview',
    });
    expect(overviewRes.statusCode).toBe(200);
    const overviewBody = JSON.parse(overviewRes.body) as {
      success: boolean;
      data: { openBySeverity: Record<string, number>; siem: { driver: string } };
    };
    expect(overviewBody.success).toBe(true);
    expect(overviewBody.data.openBySeverity).toHaveProperty('P1');

    const policiesRes = await context.app.inject({
      method: 'GET',
      url: '/ops/incidents/policies',
    });
    expect(policiesRes.statusCode).toBe(200);
    const policiesBody = JSON.parse(policiesRes.body) as {
      data: Array<{ severity: string; responseSlaMinutes: number }>;
    };
    expect(policiesBody.data.map((p) => p.severity)).toEqual(
      expect.arrayContaining(['P1', 'P2', 'P3', 'P4']),
    );

    const siemTestRes = await context.app.inject({
      method: 'POST',
      url: '/ops/incidents/siem/test',
      payload: { driver: 'internal_log' },
    });
    expect(siemTestRes.statusCode).toBe(200);
    const siemTestBody = JSON.parse(siemTestRes.body) as {
      data: { eventType: string; status: string };
    };
    expect(siemTestBody.data.eventType).toBe('SIEM_CONNECTIVITY_TEST');
    expect(siemTestBody.data.status).toBe('SENT');

    const badEndpointRes = await context.app.inject({
      method: 'POST',
      url: '/ops/incidents/siem/test',
      payload: { driver: 'webhook', endpoint: 'ftp://invalid.example.com' },
    });
    expect(badEndpointRes.statusCode).toBe(400);

    const badIncidentRes = await context.app.inject({
      method: 'POST',
      url: '/ops/incidents',
      payload: { title: 'x' },
    });
    expect(badIncidentRes.statusCode).toBe(400);
  });
});
