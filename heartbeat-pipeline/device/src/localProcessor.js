import {
  unpackInt24,
  computeWindowStats,
  computeHeartRate,
} from '@heartbeat/core';

function samplesFor(store, session, sensor, start, end) {
  const samples = new Map();
  const width = sensor === 1 ? 3 : 2;
  for (const row of store.all(
    'SELECT first_index,count,payload FROM chunks WHERE session=? AND sensor=? AND first_index<=? AND first_index+count>? ORDER BY first_index',
    session,
    sensor,
    end,
    start,
  )) {
    const values = unpackInt24(row.payload);
    for (let j = 0; j < row.count; j++) {
      const index = row.first_index + j;
      if (index >= start && index <= end)
        samples.set(index, values.slice(j * width, (j + 1) * width));
    }
  }
  for (const row of store.all(
    'SELECT from_index,to_index FROM losses WHERE session=? AND sensor=? AND from_index<=? AND (to_index IS NULL OR to_index>=?)',
    session,
    sensor,
    end,
    start,
  )) {
    for (
      let i = Math.max(start, row.from_index);
      i <= Math.min(end, row.to_index ?? end);
      i++
    )
      samples.set(i, null);
  }
  return samples;
}

function rangeCovered(store, session, sensor, start, end) {
  const ranges = [
    ...store
      .all(
        'SELECT first_index,count FROM chunks WHERE session=? AND sensor=? AND first_index<? AND first_index+count>?',
        session,
        sensor,
        end,
        start,
      )
      .map((r) => [r.first_index, r.first_index + r.count]),
    ...store
      .all(
        'SELECT from_index,to_index FROM losses WHERE session=? AND sensor=? AND from_index<? AND (to_index IS NULL OR to_index>=?)',
        session,
        sensor,
        end,
        start,
      )
      .map((r) => [
        r.from_index,
        r.to_index == null ? Number.POSITIVE_INFINITY : r.to_index + 1,
      ]),
  ].sort((a, b) => a[0] - b[0]);
  let cursor = start;
  for (const [from, to] of ranges) {
    if (to <= cursor) continue;
    if (from > cursor) return false;
    cursor = Math.max(cursor, to);
    if (cursor >= end) return true;
  }
  return cursor >= end;
}

/** Compute every offline window whose sample range is fully accounted. */
export async function processOffline(store, session) {
  if (!session) return;
  const mode =
    store.get("SELECT value FROM meta WHERE key='mode'")?.value ?? 'offline';
  if (mode !== 'offline') return;
  const max = [1, 2].map((sensor) => {
    const chunkEnd = Number(
      store.get(
        'SELECT COALESCE(MAX(first_index+count),0) n FROM chunks WHERE session=? AND sensor=?',
        session,
        sensor,
      )?.n ?? 0,
    );
    const lossEnd = Number(
      store.get(
        'SELECT COALESCE(MAX(to_index+1),0) n FROM losses WHERE session=? AND sensor=? AND to_index IS NOT NULL',
        session,
        sensor,
      )?.n ?? 0,
    );
    return Math.max(chunkEnd, lossEnd);
  });
  const lastWindow = Math.floor(Math.max(...max) / 400) - 1;
  for (let w = 0; w <= lastWindow; w++) {
    if (
      store.get(
        'SELECT 1 FROM results WHERE session=? AND window=? AND mode=?',
        session,
        w,
        'offline',
      )
    )
      continue;
    const s2map = samplesFor(store, session, 2, w * 400, w * 400 + 399);
    const s1start = w * 400;
    const s1end = w * 400 + 399;
    const s1map = samplesFor(store, session, 1, s1start, s1end);
    const s2 = Array.from(
      { length: 400 },
      (_, i) => s2map.get(w * 400 + i) ?? null,
    );
    const s1 = Array.from(
      { length: 400 },
      (_, i) => s1map.get(w * 400 + i) ?? null,
    );
    const stats = computeWindowStats(s1, s2);
    const hrStart = Math.max(0, 400 * (w - 4) - 1600);
    const hrEnd = 400 * (w + 1);
    if (
      !rangeCovered(store, session, 1, hrStart, hrEnd + 1) ||
      !rangeCovered(store, session, 2, w * 400, w * 400 + 400)
    )
      continue;
    const hrMap = samplesFor(store, session, 1, hrStart, hrEnd);
    const hrValues = Array.from(
      { length: hrEnd - hrStart + 1 },
      (_, i) => hrMap.get(hrStart + i)?.[1] ?? null,
    );
    stats.session = session;
    stats.window = w;
    stats.mode = 'offline';
    stats.heart_rate = computeHeartRate(hrValues, w, hrStart);
    store.run(
      'INSERT OR IGNORE INTO results(session,window,mode,body) VALUES(?,?,?,?)',
      session,
      w,
      'offline',
      JSON.stringify(stats),
    );
  }
}
