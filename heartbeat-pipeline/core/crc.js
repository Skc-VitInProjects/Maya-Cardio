const TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** Extract the exact JSON array text for `data` without parsing or reserializing it. */
export function extractDataText(line) {
  const key = /\"?data\"?\s*:\s*/g;
  const match = key.exec(line);
  if (!match) throw new Error('Reply has no data field');
  const start = line.indexOf('[', match.index + match[0].length);
  if (start < 0) throw new Error('Reply data field is not an array');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return line.slice(start, i + 1);
  }
  throw new Error('Reply data array is not closed');
}

/** Return the eight digit lowercase CRC-32 for a string or Buffer. */
export function crc32(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0)
    .toString(16)
    .padStart(8, '0');
}

/** Validate a mock line against its CRC of the original data array text. */
export function verifyReplyCrc(line, reply = JSON.parse(line)) {
  return crc32(extractDataText(line)) === String(reply.crc32).toLowerCase();
}

/** Compatibility helper returning the numeric CRC of the raw data array. */
export function crc32OfRawDataText(line) {
  return Number.parseInt(crc32(extractDataText(line)), 16);
}
