/** Return the exact bytes from a Node Buffer, typed array, or BSON Binary. */
export function payloadBuffer(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return Buffer.from(value);
  if (
    value &&
    value.buffer instanceof Uint8Array &&
    Number.isSafeInteger(value.position)
  )
    return Buffer.from(value.buffer.subarray(0, value.position));
  throw new TypeError('Stored chunk payload is not binary data');
}
