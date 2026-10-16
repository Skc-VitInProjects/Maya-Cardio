import fs from 'node:fs';
import { collectSensor } from './collector.js';
import { Store } from './store.js';
import { runModeLoop } from './mode.js';
import { processOffline } from './localProcessor.js';
import { runUploader } from './uploader.js';

/** Start long-running device services and shut them down cleanly on signals. */
export async function runDaemon(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(config.dbPath);
  const unfinished = store.get(
    'SELECT id FROM sessions WHERE ended=0 ORDER BY first_seen DESC LIMIT 1',
  );
  const sessionState = { current: unfinished?.id ?? null };
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const background = [
    runModeLoop(config, store, () => stopping),
    runUploader(config, store, () => stopping),
  ];
  const collectorLoop = async (sensor) => {
    while (!stopping) {
      const started = performance.now();
      try {
        await collectSensor({ config, store, sensor, sessionState });
        await processOffline(store, sessionState.current);
      } catch (error) {
        if (error.code === 'SQLITE_FULL' || /SQLITE_FULL/.test(error.message)) {
          try {
            fs.unlinkSync(store.reservePath);
          } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT')
              process.stderr.write(
                `${JSON.stringify({ level: 'error', event: 'reserve_release_failed', message: unlinkError.message })}\n`,
              );
          }
          process.stderr.write(
            `${JSON.stringify({ level: 'error', event: 'disk_full_unrecorded', sensor, message: 'Unable to commit the exact reply loss after reserve release' })}\n`,
          );
        } else
          process.stderr.write(
            `${JSON.stringify({ level: 'warn', event: 'collector_error', sensor, message: error.message })}\n`,
          );
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, config.pollMs - (performance.now() - started)),
        ),
      );
    }
  };
  await Promise.allSettled([...background, collectorLoop(1), collectorLoop(2)]);
  store.close();
}
