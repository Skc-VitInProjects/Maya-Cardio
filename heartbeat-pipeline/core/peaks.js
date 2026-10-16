import { findPeaksInRange } from './heartrate.js';

/** Find valid ECG peaks in an inclusive absolute sample-index range. */
export function findPeaks(values, startIndex, endIndex, scanStart = 0) {
  return findPeaksInRange(values, startIndex, endIndex, scanStart);
}
