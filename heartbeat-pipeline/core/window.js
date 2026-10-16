import { round1 } from './round.js';

/** Compute window statistics for given sample arrays. */
export function computeWindowStats(sensor1Samples, sensor2Samples) {
  // sensor1 has 3 channels, sensor2 has 2 channels
  const res = {
    missing_1: 0,
    missing_2: 0,
    complete: false,
    mean: { s1: [null, null, null], s2: [null, null] },
    min: { s1: [null, null, null], s2: [null, null] },
    max: { s1: [null, null, null], s2: [null, null] },
    magnitude: null,
  };

  // count available
  for (let i = 0; i < sensor1Samples.length; i++) {
    if (sensor1Samples[i] === null || sensor1Samples[i] === undefined)
      res.missing_1++;
  }
  for (let i = 0; i < sensor2Samples.length; i++) {
    if (sensor2Samples[i] === null || sensor2Samples[i] === undefined)
      res.missing_2++;
  }
  res.complete = res.missing_1 === 0 && res.missing_2 === 0;

  // compute per channel means/min/max for sensor1 (3 channels per sample)
  const ch1 = [[], [], []];
  for (let i = 0; i < sensor1Samples.length; i++) {
    const s = sensor1Samples[i];
    if (s === null || s === undefined) continue;
    ch1[0].push(s[0]);
    ch1[1].push(s[1]);
    ch1[2].push(s[2]);
  }
  for (let c = 0; c < 3; c++) {
    if (ch1[c].length === 0) continue;
    const mean = ch1[c].reduce((a, b) => a + b, 0) / ch1[c].length;
    const min = Math.min(...ch1[c]);
    const max = Math.max(...ch1[c]);
    res.mean.s1[c] = round1(mean);
    res.min.s1[c] = round1(min);
    res.max.s1[c] = round1(max);
  }

  const ch2 = [[], []];
  for (let i = 0; i < sensor2Samples.length; i++) {
    const s = sensor2Samples[i];
    if (s === null || s === undefined) continue;
    ch2[0].push(s[0]);
    ch2[1].push(s[1]);
  }
  for (let c = 0; c < 2; c++) {
    if (ch2[c].length === 0) continue;
    const mean = ch2[c].reduce((a, b) => a + b, 0) / ch2[c].length;
    const min = Math.min(...ch2[c]);
    const max = Math.max(...ch2[c]);
    res.mean.s2[c] = round1(mean);
    res.min.s2[c] = round1(min);
    res.max.s2[c] = round1(max);
  }

  // magnitude: mean of sqrt(ch1^2+ch2^2) over available sensor 2 samples
  const mags = [];
  for (let i = 0; i < sensor2Samples.length; i++) {
    const s = sensor2Samples[i];
    if (s === null || s === undefined) continue;
    mags.push(Math.sqrt(s[0] * s[0] + s[1] * s[1]));
  }
  if (mags.length > 0) {
    const mmean = mags.reduce((a, b) => a + b, 0) / mags.length;
    res.magnitude = round1(mmean);
  }
  return res;
}
