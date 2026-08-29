export interface ScatterItem { leftPct: number; topPct: number; scale: number; delaySec: number; durSec: number; }

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export function scatter(count: number, seed: number): ScatterItem[] {
  const next = rng(seed);
  const items: ScatterItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      leftPct: r2(next() * 100), topPct: r2(next() * 100),
      scale: r2(0.6 + next() * 0.9), delaySec: r2(-next() * 14), durSec: r2(7 + next() * 8),
    });
  }
  return items;
}
