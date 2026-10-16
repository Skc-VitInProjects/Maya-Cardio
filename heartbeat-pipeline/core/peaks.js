/** Monotonic deque for sliding window maximum. */
function slidingWindowMax(values, start, end) {
  // return array of max in window ending at i of size k? simple implementation
  // but we need max of previous 800 samples up to i-1
  const result = new Array(values.length).fill(-Infinity);
  const deque = [];
  for (let i = start; i <= end; i++) {
    while (deque.length > 0 && values[deque[deque.length - 1]] <= values[i]) deque.pop();
    deque.push(i);
    if (deque[0] <= i - 800) deque.shift();
    if (i >= start + 800 - 1) {
      result[i] = values[deque[0]];
    }
  }
  return result;
}

/** Find peaks in sensor1 channel 2 values array (by index in array). */
export function findPeaks(s1Ch2, startIdx, endIdx) {
  // s1Ch2 is array aligned to sample indices
  const peaks = [];
  let lastPeak = -1000000;
  // compute sliding max of previous 800
  const maxPrev800 = new Array(s1Ch2.length).fill(-Infinity);
  const deque = [];
  for (let i = 0; i < s1Ch2.length; i++) {
    while (deque.length > 0 && s1Ch2[deque[deque.length - 1]] <= s1Ch2[i]) deque.pop();
    deque.push(i);
    if (deque[0] <= i - 800) deque.shift();
    if (i >= 800) {
      maxPrev800[i] = s1Ch2[deque[0]];
    } else {
      maxPrev800[i] = -Infinity;
    }
  }
  for (let i = startIdx; i <= endIdx; i++) {
    if (i < 800) continue; // need 800 before
    if (i + 1 >= s1Ch2.length) continue; // need sample after
    if (s1Ch2[i] === null || s1Ch2[i] === undefined) continue;
    if (s1Ch2[i - 1] === null || s1Ch2[i - 1] === undefined) continue;
    if (s1Ch2[i + 1] === null || s1Ch2[i + 1] === undefined) continue;
    // check 800 before all available - we assume caller marks unavailable; but we just check values exist
    // neighbors
    if (s1Ch2[i] <= s1Ch2[i - 1]) continue;
    if (s1Ch2[i] <= s1Ch2[i + 1]) continue;
    // greater than half of max of previous 800
    const halfMax = maxPrev800[i] * 0.5;
    if (s1Ch2[i] <= halfMax + 1e-12) continue;
    // at least 100 samples after last peak
    if (i - lastPeak < 100) continue;
    peaks.push(i);
    lastPeak = i;
  }
  return peaks;
}
