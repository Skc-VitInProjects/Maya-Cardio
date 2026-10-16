import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRanges } from '../src/accounted.js';
import { payloadBuffer } from '../src/binary.js';

test('accounted ranges preserve an unknown end and merge ranges into it', () => {
  assert.deepEqual(
    mergeRanges([
      [10, 20],
      [20, 30],
      [40, null],
      [35, 45],
    ]),
    [
      [10, 30],
      [35, null],
    ],
  );
});

test('binary payload reads only bytes occupied by BSON Binary', () => {
  assert.deepEqual(
    payloadBuffer({ buffer: Buffer.from([1, 2, 3, 0, 0]), position: 3 }),
    Buffer.from([1, 2, 3]),
  );
});
