import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHeartRate } from '../heartrate.js';
import { referenceHeartRate } from '../../tools/reference.js';

test('stateless heart-rate scan matches full-history reference over six minutes with deterministic gaps', () => {
  const length = 6 * 60 * 400 + 1;
  const values = Array(length).fill(1);
  let peak = 1000;
  while (peak < length - 1) {
    values[peak] = 1000;
    const period = peak < 2 * 60 * 400 ? 400 : peak < 4 * 60 * 400 ? 267 : 333;
    peak += period;
  }

  let random = 0x12345678;
  for (let n = 0; n < 24; n++) {
    random = (1664525 * random + 1013904223) >>> 0;
    const start = 1200 + (random % (length - 2400));
    values[start] = null;
  }

  const windows = new Set([4, 5, 6, 59, 60, 61, 119, 120, 121, 179, 239, 359]);
  for (const window of windows) {
    const baseIndex = Math.max(0, 400 * (window - 4) - 1600);
    const local = values.slice(baseIndex, 400 * (window + 1) + 1);
    assert.equal(
      computeHeartRate(local, window, baseIndex),
      referenceHeartRate(values, window),
      `window ${window}`,
    );
  }
});
