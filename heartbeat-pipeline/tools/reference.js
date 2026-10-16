import { computeWindowStats } from '../core/window.js';
import { round1 } from '../core/round.js';

/** Slow full-history peak scan used as an independent heart-rate reference. */
export function referenceHeartRate(values, window) {
  if (window < 4) return null;
  const first = 400 * (window - 4);
  const last = 400 * (window + 1) - 1;
  for (let i = first; i <= last; i++) if (values[i] == null) return null;
  const peaks = [];
  let lastPeak = -Infinity;
  for (let i = 800; i <= last; i++) {
    if (
      i + 1 >= values.length ||
      values[i - 1] == null ||
      values[i] == null ||
      values[i + 1] == null
    )
      continue;
    let available = true;
    let maximum = -Infinity;
    for (let j = i - 800; j < i; j++) {
      if (values[j] == null) {
        available = false;
        break;
      }
      maximum = Math.max(maximum, values[j]);
    }
    if (
      !available ||
      values[i] <= values[i - 1] ||
      values[i] <= values[i + 1] ||
      values[i] <= maximum / 2 ||
      i - lastPeak < 100
    )
      continue;
    if (i >= first) peaks.push(i);
    lastPeak = i;
  }
  if (peaks.length < 2) return null;
  return round1((24000 * (peaks.length - 1)) / (peaks.at(-1) - peaks[0]));
}

/** Build a full reference window result for aligned sample arrays. */
export function referenceWindow(s1, s2, window) {
  const start = window * 400;
  const stats = computeWindowStats(
    s1.slice(start, start + 400),
    s2.slice(start, start + 400),
  );
  return {
    ...stats,
    window,
    heart_rate: referenceHeartRate(
      s1.map((sample) => sample?.[1] ?? null),
      window,
    ),
  };
}
