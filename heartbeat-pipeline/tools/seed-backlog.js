#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { connectDatabase } from '../cloud/src/db.js';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required');
const { client, db } = await connectDatabase(
  uri,
  process.env.MONGODB_DB ?? 'heartbeat',
);
const session = `seed-${randomUUID()}`;
const started = performance.now();
const samples = [];
for (const sensor of [1, 2]) {
  for (let second = 0; second < 7200; second++) {
    const count = 400;
    const channels = sensor === 1 ? 3 : 2;
    const bytes = Buffer.alloc(count * channels * 3);
    for (let i = 0; i < count * channels; i++) {
      const x =
        ((sensor === 1 ? 3 : 2) * (second * 400 + Math.floor(i / channels)) +
          (i % channels)) %
        8388608;
      bytes[i * 3] = x >> 16;
      bytes[i * 3 + 1] = x >> 8;
      bytes[i * 3 + 2] = x;
    }
    samples.push({
      session,
      sensor,
      first_index: second * 400,
      count,
      payload: bytes,
      crc32: 'seed',
    });
    if (samples.length >= 300) {
      await db
        .collection('chunks')
        .insertMany(samples.splice(0), { ordered: false });
    }
  }
}
if (samples.length)
  await db.collection('chunks').insertMany(samples, { ordered: false });
await db
  .collection('sessions')
  .updateOne(
    { id: session },
    { $set: { id: session, mode: 'offline', created_at: new Date() } },
    { upsert: true },
  );
process.stdout.write(
  `${JSON.stringify({ session, chunks: 14400, elapsed_ms: Math.round(performance.now() - started), note: 'seed creation time; time cloud backlog drain separately' })}\n`,
);
await client.close();
