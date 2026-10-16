import { computeWindowStats, computeHeartRate } from '@heartbeat/core';
import { accounted } from './accounted.js';

function covered(ranges, start, end) {
  let cursor = start;
  for (const [from, to] of ranges) {
    if (to <= cursor) continue;
    if (from > cursor) return false;
    cursor = Math.max(cursor, to);
    if (cursor >= end) return true;
  }
  return cursor >= end;
}

async function samples(db, session, sensor, start, end) {
  const width = sensor === 1 ? 3 : 2;
  const result = Array(end - start).fill(null);
  const cursor = db.collection('chunks').find({ session, sensor, first_index: { $lt: end }, $expr: { $gt: [{ $add: ['$first_index', '$count'] }, start] } }).sort({ first_index: 1 });
  for await (const chunk of cursor) {
    const bytes = Buffer.from(chunk.payload);
    for (let i = 0; i < chunk.count; i++) {
      const index = chunk.first_index + i;
      if (index < start || index >= end) continue;
      const values = [];
      for (let c = 0; c < width; c++) {
        const offset = (i * width + c) * 3;
        let value = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
        if (value & 0x800000) value -= 0x1000000;
        values.push(value);
      }
      result[index - start] = values;
    }
  }
  return result;
}

/** Compute and persist all complete online windows newly made ready by ingest. */
export async function processReadyWindows(db, session, fromWindow = 0) {
  const sessionDoc = await db.collection('sessions').findOne({ id: session });
  const startWindow = Math.max(0, fromWindow, sessionDoc?.online_cursor ?? 0);
  const ranges = await accounted(db, session);
  const maxEnd = Math.min(...[1, 2].map(sensor => Math.max(0, ...(ranges[sensor] ?? []).map(range => range[1]))));
  const lastWindow = Math.floor(maxEnd / 400) - 1;
  for (let window = startWindow; window <= lastWindow; window++) {
    const start = window * 400;
    const s1Start = Math.max(0, 400 * (window - 4) - 1600);
    const s1End = 400 * (window + 1) + 1;
    if (!covered(ranges[1], s1Start, s1End) || !covered(ranges[2], start, start + 400)) break;
    const s1Window = await samples(db, session, 1, start, start + 400);
    const s2Window = await samples(db, session, 2, start, start + 400);
    const stats = computeWindowStats(s1Window, s2Window);
    const heartSamples = await samples(db, session, 1, s1Start, s1End);
    const global = Array(s1End).fill(null);
    for (let i = 0; i < heartSamples.length; i++) global[s1Start + i] = heartSamples[i]?.[1] ?? null;
    const stamped = new Date().toISOString();
    const result = { session, window, mode: 'online', ...stats, heart_rate: computeHeartRate(global, window), received_at: stamped, processed_at: stamped };
    await db.collection('results').updateOne({ session, window, mode: 'online' }, { $setOnInsert: result }, { upsert: true });
    await db.collection('sessions').updateOne({ id: session }, { $max: { online_cursor: window + 1 } });
  }
}
