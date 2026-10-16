import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWindowStats } from '../window.js';
import { round1 } from '../round.js';

test('window statistics count missing samples and use available channels only', () => {
  const result = computeWindowStats(
    [[1, 2, 3], null, [3, 4, 5]],
    [[3, 4], null, [0, 0]],
  );
  assert.equal(result.missing_1, 1);
  assert.equal(result.missing_2, 1);
  assert.equal(result.complete, false);
  assert.deepEqual(result.mean.s1, [2, 3, 4]);
  assert.deepEqual(result.min.s2, [0, 0]);
  assert.equal(result.magnitude, 2.5);
});

test('empty channels return null and rounding is centralized', () => {
  const result = computeWindowStats([null], [null]);
  assert.deepEqual(result.mean.s1, [null, null, null]);
  assert.equal(result.magnitude, null);
  assert.equal(round1(1.26), 1.3);
  assert.equal(round1(Number.NaN), null);
});
