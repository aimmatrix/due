import { describe, expect, it } from 'vitest';
import { responseWindowLabel } from './format';

describe('response window countdown', () => {
  const closes = '2026-10-16T10:00:00.000Z';
  it('counts from simulated application time rather than the machine clock', () => {
    expect(responseWindowLabel(closes, '2026-10-15T10:00:00.000Z')).toBe('24h 0m remaining');
    expect(responseWindowLabel(closes, '2026-10-16T09:00:00.000Z', 60000)).toBe('0h 59m remaining');
  });
  it('closes at the deadline and never displays negative time', () => {
    expect(responseWindowLabel(closes, closes)).toBe('Response window closed');
    expect(responseWindowLabel(closes, '2026-10-17T10:00:00.000Z')).toBe('Response window closed');
  });
});
