const TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** Extract the exact JSON array text for `data` without parsing or reserializing it. */
export function extractDataText(line) {
  let objectDepth = 0;
  let arrayDepth = 0;
  let inString = false;
  let escaped = false;
  let keyStart = -1;
  let start = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') {
        inString = false;
        if (
          objectDepth === 1 &&
          arrayDepth === 0 &&
          keyStart >= 0 &&
          line.slice(keyStart, i + 1) === '"data"'
        ) {
          const rest = line.slice(i + 1).match(/^\s*:\s*/);
          if (rest) {
            start = i + 1 + rest[0].length;
            break;
          }
        }
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      keyStart = i;
      continue;
    }
    if (c === '{') objectDepth++;
    else if (c === '}') objectDepth--;
    else if (c === '[') arrayDepth++;
    else if (c === ']') arrayDepth--;
  }
  if (start < 0) throw new Error('Reply has no data field');
  if (line[start] !== '[') throw new Error('Reply data field is not an array');
  let depth = 0;
  let quoted = false;
  let bracketEscaped = false;
  for (let i = start; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (bracketEscaped) bracketEscaped = false;
      else if (c === '\\') bracketEscaped = true;
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
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

/** Validate a mock line against its CRC of the original data array text. */
export function verifyReplyCrc(line, reply = JSON.parse(line)) {
  return crc32(extractDataText(line)) === String(reply.crc32).toLowerCase();
}

/** Compatibility helper returning the numeric CRC of the raw data array. */
export function crc32OfRawDataText(line) {
  return Number.parseInt(crc32(extractDataText(line)), 16);
}
