import { crc32, packInt24, verifyReplyCrc } from '@heartbeat/core';
import { requestMock } from './mockClient.js';

async function withMockLock(state, fn) {
  const previous = state.mockLock ?? Promise.resolve();
  let release;
  state.mockLock = new Promise(resolve => { release = resolve; });
  await previous;
  try { return await fn(); } finally { release(); }
}

/** Collect one sensor reply with CRC retry, overlap dedupe and gap accounting. */
export async function collectSensor({ config, store, sensor, sessionState, logger = console }) {
  const current = sessionState.current;
  const cursor = current ? Number(store.get('SELECT next_index FROM cursors WHERE session=? AND sensor=?', current, sensor)?.next_index ?? 0) : 0;
  let raw;
  let reply;
  await withMockLock(sessionState, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      raw = await requestMock({ host: config.mockHost, port: config.mockPort, sensor, fromIndex: cursor });
      reply = JSON.parse(raw);
      if (verifyReplyCrc(raw, reply)) break;
      if (attempt === 2) throw new Error(`CRC mismatch after 3 attempts for sensor ${sensor}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });
  if (current && current !== reply.session_id) {
    for (const row of store.all('SELECT sensor,next_index FROM cursors WHERE session=? AND ended=0', current)) {
      store.run('INSERT OR IGNORE INTO losses(session,sensor,from_index,to_index,reason,source) VALUES(?,?,?,NULL,?,?)', current, row.sensor, row.next_index, 'mock_restart_or_power_loss', 'pipeline');
      store.run('UPDATE cursors SET ended=1 WHERE session=? AND sensor=?', current, row.sensor);
    }
    store.run('UPDATE sessions SET ended=1 WHERE id=?', current);
  }
  sessionState.current = reply.session_id;
  const existing = store.get('SELECT next_index FROM cursors WHERE session=? AND sensor=?', reply.session_id, sensor);
  const next = Number(existing?.next_index ?? 0);
  const fresh = (reply.data ?? []).map((values, offset) => ({ index: reply.first_index + offset, values }))
    .filter(sample => sample.index >= next);
  if (Number(reply.first_index) > next && !(reply.lost ?? []).some(g => g.from_index <= next && g.to_index >= reply.first_index - 1)) {
    reply.lost = [...(reply.lost ?? []), { from_index: next, to_index: reply.first_index - 1, reason: 'unreported_gap' }];
  }
  if (fresh.length) {
    const flat = fresh.flatMap(item => item.values);
    const bytes = packInt24(flat);
    store.saveReply(reply, fresh, bytes);
  } else {
    store.saveReply({ ...reply, crc32: crc32('[]') }, [], Buffer.alloc(0));
  }
  logger.info?.(JSON.stringify({ event: 'collected', session: reply.session_id, sensor, first_index: fresh[0]?.index ?? null, count: fresh.length }));
  return reply;
}
