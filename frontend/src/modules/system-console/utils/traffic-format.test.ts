import { describe, expect, it } from 'vitest';
import { formatLatency, routeIdOf, statDelta } from './traffic-format';

describe('routeIdOf', () => {
  it('reads an encoded id as one segment and ignores a legacy sub tab', () => {
    expect(routeIdOf(['GET /api/v1/x'])).toBe('GET /api/v1/x');
    expect(routeIdOf(['GET /api/v1/x', 'errors'])).toBe('GET /api/v1/x');
  });
  it('rejoins an unencoded id split by the router', () => {
    expect(routeIdOf(['GET ', 'api', 'v1', 'x'])).toBe('GET /api/v1/x');
  });
  it('returns null without segments', () => {
    expect(routeIdOf([])).toBeNull();
  });
});

describe('statDelta', () => {
  it('hides when there is no previous period', () => {
    expect(statDelta(null, true)).toBeNull();
  });
  it('marks increases as bad when higher is worse', () => {
    expect(statDelta(12.34, true)).toEqual({ text: '+12.3%', direction: 'up', good: false });
    expect(statDelta(-5, true)).toEqual({ text: '-5%', direction: 'down', good: true });
  });
  it('stays neutral for traffic', () => {
    expect(statDelta(8, null)?.good).toBeNull();
  });
});

describe('formatLatency', () => {
  it('shows the histogram ceiling as ≥', () => {
    expect(formatLatency(10_000)).toBe('≥ 10 s');
    expect(formatLatency(840)).toBe('840 ms');
    expect(formatLatency(null)).toBe('—');
  });
});
