import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHeartRate, findPeaksInRange } from '../heartrate.js';

function signal(length, peaks) {
  const values = Array(length).fill(0);
  for (const index of peaks) values[index] = 100;
  return values;
}

test('heart rate uses peaks in the five-second window', () => {
  const values = signal(2001, [1000, 1400, 1800]);
  assert.equal(computeHeartRate(values, 3), null);
  assert.equal(computeHeartRate(values, 4), 60);
});

test('missing samples in the five-second interval make heart rate unavailable', () => {
  const values = signal(2001, [1000, 1400, 1800]);
  values[1500] = null;
  assert.equal(computeHeartRate(values, 4), null);
});

test('peak candidate requires 800 available prior samples and a following sample', () => {
  const values = signal(1001, [800]);
  assert.deepEqual(findPeaksInRange(values, 800, 800, 0), [800]);
  values[400] = null;
  assert.deepEqual(findPeaksInRange(values, 800, 800, 0), []);
});
