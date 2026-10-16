import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

/** Upload durable unacknowledged chunks and losses; retries are idempotent. */
export async function runUploader(config, store, stopping) {
  let lastCounterFlush = 0;
  while (!stopping()) {
    if (
      config.cloudUrl &&
      store.get("SELECT value FROM meta WHERE key='mode'")?.value === 'online'
    ) {
      const sessions = store.all('SELECT id FROM sessions ORDER BY first_seen');
      for (const { id: session } of sessions) {
        try {
          const ack = JSON.parse(
            store.get(
              `SELECT value FROM meta WHERE key=?`,
              `accounted:${session}`,
            )?.value ?? '{"1":[],"2":[]}',
          );
          const heads = Object.fromEntries(
            [1, 2].map((sensor) => [
              sensor,
              Number(
                store.get(
                  'SELECT COALESCE(MAX(first_index+count),0) n FROM chunks WHERE session=? AND sensor=?',
                  session,
                  sensor,
                )?.n ?? 0,
              ),
            ]),
          );
          const live = [];
          const backlog = [];
          for (const row of store.iterate(
            'SELECT session,sensor,first_index,count,payload,crc32 FROM chunks WHERE session=? ORDER BY first_index',
            session,
          )) {
            if (
              (ack[row.sensor] ?? []).some(
                ([start, end]) =>
                  row.first_index >= start &&
                  (end == null || row.first_index + row.count <= end),
              )
            )
              continue;
            if (
              row.first_index + row.count >
              Math.max(0, heads[row.sensor] - 4000)
            )
              live.push(row);
            else if (backlog.length < 50) backlog.push(row);
          }
          const chunks = [...live, ...backlog].map((row) => ({
            ...row,
            payload: Buffer.from(row.payload).toString('base64'),
          }));
          const losses = [];
          for (const loss of store.iterate(
            'SELECT sensor,from_index,to_index,reason,source FROM losses WHERE session=? ORDER BY from_index',
            session,
          )) {
            const end = loss.to_index == null ? null : loss.to_index + 1;
            if (
              (ack[loss.sensor] ?? []).some(
                ([start, stop]) =>
                  loss.from_index >= start &&
                  (stop == null || (end != null && end <= stop)),
              )
            )
              continue;
            losses.push(loss);
            if (losses.length >= 1000) break;
          }
          if (!chunks.length && !losses.length) continue;
          const ended = Object.fromEntries(
            [1, 2].map((sensor) => [
              sensor,
              Boolean(
                store.get(
                  'SELECT ended FROM cursors WHERE session=? AND sensor=?',
                  session,
                  sensor,
                )?.ended,
              ),
            ]),
          );
          const body = Buffer.from(
            JSON.stringify({
              session,
              lane: backlog.length ? 'live+backlog' : 'live',
              chunks,
              losses,
              ended,
              results: [],
            }),
          );
          const packed = gzipSync(body);
          const response = await fetch(`${config.cloudUrl}/api/v1/ingest`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'content-encoding': 'gzip',
              'x-api-key': config.apiKey,
            },
            body: packed,
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok)
            throw new Error(`ingest returned ${response.status}`);
          const data = await response.json();
          store.run(
            'INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)',
            `accounted:${session}`,
            JSON.stringify(data.accounted ?? ack),
          );
          store.run(
            'INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)',
            `accounted_counts:${session}`,
            JSON.stringify(data.counts ?? { 1: 0, 2: 0 }),
          );
          store.run(
            "INSERT OR REPLACE INTO meta(key,value) VALUES('cloud_known_at',?)",
            new Date().toISOString(),
          );
          const totalBytes =
            Number(
              store.get("SELECT value FROM meta WHERE key='uploader_bytes'")
                ?.value ?? 0,
            ) + packed.length;
          store.run(
            "INSERT OR REPLACE INTO meta(key,value) VALUES('uploader_bytes',?)",
            String(totalBytes),
          );
          if (performance.now() - lastCounterFlush >= 10000) {
            const counterPath = path.join(config.dataDir, 'uploader-bytes.txt');
            const temporaryPath = `${counterPath}.tmp`;
            fs.writeFileSync(temporaryPath, String(totalBytes));
            fs.renameSync(temporaryPath, counterPath);
            lastCounterFlush = performance.now();
          }
          process.stdout.write(
            `${JSON.stringify({ level: 'info', event: 'upload_sent', body_bytes: packed.length, total_body_bytes: totalBytes })}\n`,
          );
        } catch (error) {
          process.stderr.write(
            `${JSON.stringify({ level: 'warn', event: 'upload_error', message: error.message })}\n`,
          );
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
