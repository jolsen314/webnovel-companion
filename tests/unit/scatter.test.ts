import { describe, expect, test } from 'vitest';
import { scatter } from '../../src/lib/scatter';

describe('scatter', () => {
  test('deterministic: same (count, seed) → identical output', () => {
    expect(scatter(20, 1)).toEqual(scatter(20, 1));
  });
  test('different seed → different layout', () => {
    expect(scatter(20, 1)).not.toEqual(scatter(20, 2));
  });
  test('count controls length; values stay in range', () => {
    const items = scatter(30, 7);
    expect(items).toHaveLength(30);
    for (const it of items) {
      expect(it.leftPct).toBeGreaterThanOrEqual(0); expect(it.leftPct).toBeLessThan(100);
      expect(it.topPct).toBeGreaterThanOrEqual(0); expect(it.topPct).toBeLessThan(100);
      expect(it.scale).toBeGreaterThanOrEqual(0.6); expect(it.scale).toBeLessThan(1.5);
      expect(it.durSec).toBeGreaterThanOrEqual(7); expect(it.durSec).toBeLessThan(15);
      expect(it.delaySec).toBeLessThanOrEqual(0); expect(it.delaySec).toBeGreaterThanOrEqual(-14);
    }
  });
});
