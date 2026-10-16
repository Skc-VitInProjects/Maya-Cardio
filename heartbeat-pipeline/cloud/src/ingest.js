import { accounted } from './accounted.js';

/** Idempotently persist an ingest payload and return updated sample counts. */
export async function ingest(db, body) {
  const now = new Date(); const chunks = body.chunks ?? []; const losses = body.losses ?? [];
  if (chunks.length) await db.collection('chunks').bulkWrite(chunks.map(c => ({ updateOne: { filter: { session: body.session, sensor: c.sensor, first_index: c.first_index }, update: { $setOnInsert: { session: body.session, sensor: c.sensor, first_index: c.first_index, count: c.count, payload: Buffer.from(c.payload, 'base64'), crc32: c.crc32, received_at: now } }, upsert: true } })), { ordered: false });
  if (losses.length) await db.collection('losses').bulkWrite(losses.map(l => ({ updateOne: { filter: { session: body.session, sensor: l.sensor, from_index: l.from_index, reason: l.reason }, update: { $setOnInsert: { ...l, session: body.session, received_at: now } }, upsert: true } })), { ordered: false });
  await db.collection('sessions').updateOne({ id: body.session }, { $set: { id: body.session, updated_at: now, mode: body.mode ?? 'online', ended: body.ended ?? {} }, $setOnInsert: { created_at: now } }, { upsert: true });
  if (body.results?.length) await db.collection('results').bulkWrite(body.results.map(r => ({ updateOne: { filter: { session: body.session, window: r.window, mode: r.mode }, update: { $setOnInsert: { ...r, session: body.session, received_at: now, processed_at: new Date() } }, upsert: true } })), { ordered: false });
  const ranges = await accounted(db, body.session);
  const counts = {};
  for (const sensor of [1, 2]) counts[sensor] = (await db.collection('chunks').aggregate([{ $match: { session: body.session, sensor } }, { $group: { _id: null, n: { $sum: '$count' } } }]).next())?.n ?? 0;
  return { accounted: ranges, counts };
}
