import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packInt24, unpackInt24 } from '../int24.js';

test('int24 roundtrip basic', () => {
  const vals = [0, 1, -1, 8388607, -8388608, 100, -200];
  const packed = packInt24(vals);
  const unpacked = unpackInt24(packed);
  assert.deepEqual(unpacked, vals);
});
