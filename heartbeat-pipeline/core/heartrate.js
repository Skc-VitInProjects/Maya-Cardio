import { round1 } from './round.js';

/** Compute bpm for a window from channel two, indexed by absolute sample index. */
export function computeHeartRate(values, window, baseIndex = 0) {
  if (window < 4) return null;
  const start = 400 * (window - 4);
  const end = 400 * (window + 1) - 1;
  for (let i = start; i <= end; i++)
    if (values[i - baseIndex] === null || values[i - baseIndex] === undefined)
      return null;
  const scanStart = Math.max(0, start - 1600);
  const peaks = findPeaksInRange(values, start, end, scanStart, baseIndex);
  if (peaks.length < 2) return null;
  return round1((24000 * (peaks.length - 1)) / (peaks.at(-1) - peaks[0]));
}

/** Find local peaks using the prior 800 samples and an O(n) monotonic deque. */
export function findPeaksInRange(
  values,
  peakStart,
  peakEnd,
  scanStart = 0,
  baseIndex = 0,
) {
  const valueAt = (index) => values[index - baseIndex];
  const peaks = [];
  const deque = [];
  let missingPrior = 0;
  for (let i = scanStart; i < scanStart + 800; i++)
    if (valueAt(i) === null || valueAt(i) === undefined) missingPrior++;
  let lastPeak = -Infinity;
  for (
    let i = scanStart;
    i <= Math.min(peakEnd + 1, baseIndex + values.length - 1);
    i++
  ) {
    while (deque.length && deque[0] < i - 800) deque.shift();
    if (
      i >= scanStart + 800 &&
      i <= peakEnd &&
      i + 1 < baseIndex + values.length
    ) {
      const priorAvailable = missingPrior === 0;
      const current = valueAt(i);
      const before = valueAt(i - 1);
      const after = valueAt(i + 1);
      if (
        priorAvailable &&
        deque.length &&
        current != null &&
        before != null &&
        after != null &&
        current > before &&
        current > after &&
        current > valueAt(deque[0]) / 2 &&
        i - lastPeak >= 100
      ) {
        if (i >= peakStart) peaks.push(i);
        lastPeak = i;
      }
    }
    const value = valueAt(i);
    if (value !== null && value !== undefined) {
      while (deque.length && valueAt(deque.at(-1)) <= value) deque.pop();
      deque.push(i);
    }
    if (i >= scanStart + 800) {
      if (valueAt(i - 800) == null) missingPrior--;
      if (value == null) missingPrior++;
    }
  }
  return peaks;
}
