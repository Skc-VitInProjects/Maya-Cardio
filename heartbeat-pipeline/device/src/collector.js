import { crc32, packInt24, unpackInt24, verifyReplyCrc } from '@heartbeat/core';
import { requestMock } from './mockClient.js';

async function withMockLock(state, fn) {
  const previous = state.mockLock ?? Promise.resolve();
  let release;
  state.mockLock = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Collect one sensor reply with CRC retry, overlap dedupe and gap accounting. */
export async function collectSensor({
  config,
  store,
  sensor,
  sessionState,
  logger = console,
}) {
  return withMockLock(sessionState, async () => {
    const current = sessionState.current;
    const cursor = current
      ? Number(
          store.get(
            'SELECT next_index FROM cursors WHERE session=? AND sensor=?',
            current,
            sensor,
          )?.next_index ?? 0,
        )
      : 0;
    const requestValidated = async (fromIndex) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const rawLine = await requestMock({
          host: config.mockHost,
          port: config.mockPort,
          sensor,
          fromIndex,
        });
        const parsed = JSON.parse(rawLine);
        if (verifyReplyCrc(rawLine, parsed)) return parsed;
        if (attempt === 2)
          throw new Error(`CRC mismatch after 3 attempts for sensor ${sensor}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('CRC retry loop ended unexpectedly');
    };
    let reply = await requestValidated(cursor);
    if (current && current !== reply.session_id) {
      const newSession = reply.session_id;
      reply = await requestValidated(0);
      if (reply.session_id !== newSession)
        throw new Error('Mock session changed during restart recovery');
    }
    validateReply(reply, sensor);
    if (current && current !== reply.session_id) {
      const previousCursors = new Map(
        store
          .all(
            'SELECT sensor,next_index,ended FROM cursors WHERE session=?',
            current,
          )
          .map((row) => [row.sensor, row]),
      );
      for (const previousSensor of [1, 2]) {
        const row = previousCursors.get(previousSensor);
        if (row?.ended) continue;
        const nextIndex = Number(row?.next_index ?? 0);
        store.run(
          'INSERT OR IGNORE INTO cursors(session,sensor,next_index,ended) VALUES(?,?,?,1)',
          current,
          previousSensor,
          nextIndex,
        );
        store.run(
          'UPDATE cursors SET ended=1 WHERE session=? AND sensor=?',
          current,
          previousSensor,
        );
        store.run(
          'INSERT OR IGNORE INTO losses(session,sensor,from_index,to_index,reason,source) VALUES(?,?,?,NULL,?,?)',
          current,
          previousSensor,
          nextIndex,
          'mock_restart_or_power_loss',
          'pipeline',
        );
      }
      store.run('UPDATE sessions SET ended=1 WHERE id=?', current);
    }
    sessionState.current = reply.session_id;
    const existing = store.get(
      'SELECT next_index FROM cursors WHERE session=? AND sensor=?',
      reply.session_id,
      sensor,
    );
    const next = Number(existing?.next_index ?? 0);
    const width = sensor === 1 ? 3 : 2;
    for (let offset = 0; offset < reply.data.length; offset++) {
      const index = reply.first_index + offset;
      if (index < next) {
        const saved = readStoredSample(
          store,
          reply.session_id,
          sensor,
          index,
          width,
        );
        if (
          saved &&
          saved.some((value, channel) => value !== reply.data[offset][channel])
        ) {
          logger.error?.(
            JSON.stringify({
              event: 'overlap_conflict',
              session: reply.session_id,
              sensor,
              index,
            }),
          );
        }
      }
    }
    for (const loss of reply.lost ?? []) {
      if (
        loss.to_index != null &&
        reply.first_index <= loss.to_index &&
        reply.first_index + reply.count - 1 >= loss.from_index
      ) {
        throw new Error(
          `Reply data overlaps its own loss range for sensor ${sensor}`,
        );
      }
    }
    const fresh = (reply.data ?? [])
      .map((values, offset) => ({ index: reply.first_index + offset, values }))
      .filter((sample) => sample.index >= next);
    if (
      Number(reply.first_index) > next &&
      !rangeCovered(reply.lost ?? [], next, reply.first_index)
    ) {
      reply.lost = [
        ...(reply.lost ?? []),
        {
          from_index: next,
          to_index: reply.first_index - 1,
          reason: 'unreported_gap',
        },
      ];
    }
    if (fresh.length) {
      const flat = fresh.flatMap((item) => item.values);
      const bytes = packInt24(flat);
      store.saveReply(reply, fresh, bytes);
    } else {
      store.saveReply({ ...reply, crc32: crc32('[]') }, [], Buffer.alloc(0));
    }
    logger.info?.(
      JSON.stringify({
        event: 'collected',
        session: reply.session_id,
        sensor,
        first_index: fresh[0]?.index ?? null,
        count: fresh.length,
      }),
    );
    return reply;
  });
}

function validateReply(reply, sensor) {
  const width = sensor === 1 ? 3 : 2;
  if (
    !reply ||
    reply.sensor !== sensor ||
    typeof reply.session_id !== 'string' ||
    !reply.session_id.length ||
    reply.session_id.length > 200
  )
    throw new Error('Mock reply identity is invalid');
  if (
    !Number.isSafeInteger(reply.first_index) ||
    reply.first_index < 0 ||
    !Number.isSafeInteger(reply.count) ||
    reply.count < 0 ||
    reply.count > 400 ||
    !Number.isSafeInteger(reply.first_index + reply.count)
  )
    throw new Error('Mock reply range is invalid');
  if (!Array.isArray(reply.data) || reply.data.length !== reply.count)
    throw new Error('Mock reply count does not match its data');
  for (const sample of reply.data) {
    if (
      !Array.isArray(sample) ||
      sample.length !== width ||
      sample.some(
        (value) =>
          !Number.isInteger(value) || value < -8388608 || value > 8388607,
      )
    )
      throw new Error('Mock reply contains an invalid sample');
  }
  for (const range of reply.lost ?? []) {
    if (
      !Number.isSafeInteger(range.from_index) ||
      range.from_index < 0 ||
      (range.to_index != null &&
        (!Number.isSafeInteger(range.to_index) ||
          range.to_index < range.from_index ||
          range.to_index === Number.MAX_SAFE_INTEGER))
    )
      throw new Error('Mock reply contains an invalid loss range');
  }
}

function rangeCovered(losses, start, endExclusive) {
  let cursor = start;
  const sorted = losses
    .filter((item) => item.to_index != null)
    .map((item) => [item.from_index, item.to_index + 1])
    .sort((a, b) => a[0] - b[0]);
  for (const [from, to] of sorted) {
    if (to <= cursor) continue;
    if (from > cursor) return false;
    cursor = Math.max(cursor, to);
    if (cursor >= endExclusive) return true;
  }
  return cursor >= endExclusive;
}

function readStoredSample(store, session, sensor, index, width) {
  const row = store.get(
    'SELECT first_index,count,payload FROM chunks WHERE session=? AND sensor=? AND first_index<=? AND first_index+count>? ORDER BY first_index DESC LIMIT 1',
    session,
    sensor,
    index,
    index,
  );
  if (!row) return null;
  const values = unpackInt24(row.payload);
  const offset = (index - row.first_index) * width;
  return values.slice(offset, offset + width);
}
