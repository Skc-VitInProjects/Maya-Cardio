import fs from 'node:fs';

/** Write the required one-line JSON status report. */
export function printStatus(store, config) {
  const session =
    store.get('SELECT id FROM sessions ORDER BY first_seen DESC LIMIT 1')?.id ??
    null;
  const totals = Object.fromEntries(
    [1, 2].map((sensor) => [
      sensor,
      Number(
        store.get(
          'SELECT COALESCE(SUM(count),0) n FROM chunks WHERE session=? AND sensor=?',
          session,
          sensor,
        )?.n ?? 0,
      ),
    ]),
  );
  const lost = Object.fromEntries(
    [1, 2].map((sensor) => [
      sensor,
      Number(
        store.get(
          'SELECT COALESCE(SUM(CASE WHEN to_index IS NULL THEN 0 ELSE to_index-from_index+1 END),0) n FROM losses WHERE session=? AND sensor=?',
          session,
          sensor,
        )?.n ?? 0,
      ),
    ]),
  );
  const disk = fs.statfsSync(config.dataDir);
  const status = {
    mode:
      store.get("SELECT value FROM meta WHERE key='mode'")?.value ?? 'offline',
    session,
    saved: totals,
    in_cloud: JSON.parse(
      store.get(
        'SELECT value FROM meta WHERE key=?',
        `accounted_counts:${session}`,
      )?.value ?? '{"1":0,"2":0}',
    ),
    backlog: null,
    lost,
    disk_free_mb: Math.round(((disk.bavail * disk.bsize) / 1048576) * 10) / 10,
    cloud_known_at:
      store.get("SELECT value FROM meta WHERE key='cloud_known_at'")?.value ??
      null,
  };
  status.backlog = Object.fromEntries(
    [1, 2].map((sensor) => [
      sensor,
      Math.max(0, status.saved[sensor] - status.in_cloud[sensor]),
    ]),
  );
  process.stdout.write(`${JSON.stringify(status)}\n`);
}
