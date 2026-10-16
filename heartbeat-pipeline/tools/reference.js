import { computeWindowStats, computeHeartRate } from '@heartbeat/core';

/** Deliberately straightforward window reference for arrays with null gaps. */
export function referenceWindow(s1, s2, window) {
  const start = window * 400;
  const stats = computeWindowStats(s1.slice(start, start + 400), s2.slice(start, start + 400));
  stats.window = window;
  stats.heart_rate = computeHeartRate(s1.map(sample => sample?.[1] ?? null), window);
  return stats;
}
