/** Pack array of signed 24-bit values (big endian) into Buffer. */
export function packInt24(values) {
  const buf = Buffer.alloc(values.length * 3);
  for (let i = 0; i < values.length; i++) {
    let v = values[i];
    if (!Number.isInteger(v) || v < -8388608 || v > 8388607) {
      throw new RangeError(`Value ${v} is outside signed 24-bit range`);
    }
    if (v < 0) v += 16777216;
    buf[i * 3] = (v >> 16) & 0xff;
    buf[i * 3 + 1] = (v >> 8) & 0xff;
    buf[i * 3 + 2] = v & 0xff;
  }
  return buf;
}

/** Unpack Buffer of signed 24-bit big endian values. */
export function unpackInt24(buf) {
  if (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array))
    throw new TypeError('Expected bytes for signed 24-bit data');
  if (buf.length % 3 !== 0)
    throw new RangeError('Signed 24-bit payload length must be divisible by 3');
  const count = Math.floor(buf.length / 3);
  const values = new Array(count);
  for (let i = 0; i < count; i++) {
    const b0 = buf[i * 3];
    const b1 = buf[i * 3 + 1];
    const b2 = buf[i * 3 + 2];
    let v = ((b0 << 16) | (b1 << 8) | b2) >>> 0;
    if (v & 0x800000) v = v - 16777216;
    values[i] = v;
  }
  return values;
}
