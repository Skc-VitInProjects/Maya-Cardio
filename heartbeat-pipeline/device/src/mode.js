/** Poll cloud health independently from uploads and persist hysteretic mode changes. */
export async function runModeLoop(config, store, stopping) {
  let failures = 0; let successes = 0;
  while (!stopping()) {
    const started = performance.now();
    try {
      if (!config.cloudUrl) throw new Error('cloud URL not configured');
      const session = store.get('SELECT id FROM sessions ORDER BY first_seen DESC LIMIT 1')?.id ?? null;
      const saved = Object.fromEntries([1, 2].map(sensor => [sensor, Number(store.get('SELECT COALESCE(SUM(count),0) n FROM chunks WHERE session=? AND sensor=?', session, sensor)?.n ?? 0)]));
      const response = await fetch(`${config.cloudUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey },
        body: JSON.stringify({ device_id: config.deviceId, mode: store.get("SELECT value FROM meta WHERE key='mode'")?.value ?? 'offline', session, saved }),
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error(`health returned ${response.status}`);
      const heartbeat = await response.json();
      if (session && heartbeat.accounted) store.run('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)', `accounted:${session}`, JSON.stringify(heartbeat.accounted));
      store.run("INSERT OR REPLACE INTO meta(key,value) VALUES('cloud_known_at',?)", heartbeat.server_time ?? new Date().toISOString());
      failures = 0; successes++;
      if (successes >= 2) store.run("INSERT OR REPLACE INTO meta(key,value) VALUES('mode','online')");
    } catch (error) {
      successes = 0; failures++;
      if (failures >= 2) store.run("INSERT OR REPLACE INTO meta(key,value) VALUES('mode','offline')");
      process.stderr.write(`${JSON.stringify({ level: 'info', event: 'probe_failure', monotonic_ms: Math.round(performance.now()), message: error.message })}\n`);
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1000 - (performance.now() - started))));
  }
}
