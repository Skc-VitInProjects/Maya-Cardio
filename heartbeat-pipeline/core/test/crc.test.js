import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32OfRawDataText } from '../crc.js';
import { crc32 } from 'zlib';

test('crc32 of raw data text matches zlib on extracted data slice', () => {
  const line =
    '{"session_id":"s","sensor":1,"first_index":0,"count":1,"lost":[],"session_end":false,"crc32":"00000000","data": [ [1, 2, 3] ]}\n';
  const crc = crc32OfRawDataText(line);
  const extracted = '[ [1, 2, 3] ]';
  assert.equal(crc, crc32(Buffer.from(extracted, 'utf8')));
});
