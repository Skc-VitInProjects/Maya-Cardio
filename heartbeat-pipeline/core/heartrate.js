import { round1 } from './round.js';

/** Compute bpm for a window from channel two, indexed by absolute sample index. */
export function computeHeartRate(values, window) {
  if (window < 4) return null;
  const start = 400 * (window - 4);
  const end = 400 * (window + 1) - 1;
  for (let i = start; i <= end; i++) if (values[i] === null || values[i] === undefined) return null;
  const scanStart = Math.max(0, start - 1600);
  const peaks = findPeaksInRange(values, start, end, scanStart);
  if (peaks.length < 2) return null;
  return round1(24000 * (peaks.length - 1) / (peaks.at(-1) - peaks[0]));
}

/** Find local peaks using the prior 800 samples and an O(n) monotonic deque. */
export function findPeaksInRange(values, peakStart, peakEnd, scanStart = 0) {
  const peaks = [];
  const deque = [];
  const missingPrefix = new Uint32Array(Math.min(values.length, peakEnd + 2) + 1);
  for (let i = 0; i < missingPrefix.length - 1; i++) missingPrefix[i + 1] = missingPrefix[i] + (values[i] === null || values[i] === undefined ? 1 : 0);
  let lastPeak = -Infinity;
  for (let i = scanStart; i <= Math.min(peakEnd + 1, values.length - 1); i++) {
    while (deque.length && deque[0] < i - 800) deque.shift();
    if (i >= scanStart + 800 && i >= peakStart && i <= peakEnd && i + 1 < values.length) {
      const priorAvailable = missingPrefix[i] - missingPrefix[i - 800] === 0;
      const current = values[i]; const before = values[i - 1]; const after = values[i + 1];
      if (priorAvailable && deque.length && current != null && before != null && after != null && current > before && current > after && current > values[deque[0]] / 2 && i - lastPeak >= 100) {
        peaks.push(i); lastPeak = i;
      }
    }
    if (values[i] !== null && values[i] !== undefined) {
      while (deque.length && values[deque.at(-1)] <= values[i]) deque.pop();
      deque.push(i);
    }
  }
  return peaks;
}
