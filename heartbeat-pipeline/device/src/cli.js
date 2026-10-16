#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import { readConfig } from './config.js';
import { Store } from './store.js';
import { runDaemon } from './daemon.js';
import { printStatus } from './status.js';
import { exportDevice } from './export.js';
import { printResults } from './results.js';

const program = new Command();
program
  .name('pipeline')
  .description('Durable biosignal collection and processing')
  .version('1.0.0');
program
  .command('run')
  .description('Run collector, local processor, uploader and mode monitor')
  .action(async () => runDaemon(readConfig()));
program
  .command('status')
  .description('Print current pipeline status as one JSON line')
  .action(() => {
    const c = readConfig();
    const store = new Store(c.dbPath);
    printStatus(store, c);
    store.close();
  });
program
  .command('export')
  .requiredOption('--session <id>')
  .requiredOption('--from <source>')
  .action(async (options) => {
    const c = readConfig();
    if (options.from === 'cloud') return exportCloud(c, options.session);
    if (options.from !== 'device')
      throw new Error('--from must be device or cloud');
    const store = new Store(c.dbPath);
    try {
      exportDevice(store, options.session);
    } finally {
      store.close();
    }
  });
program
  .command('results')
  .requiredOption('--session <id>')
  .action(async (options) => {
    const c = readConfig();
    const store = new Store(c.dbPath);
    try {
      printResults(store, options.session);
    } finally {
      store.close();
    }
    if (c.cloudUrl && c.apiKey) {
      const response = await fetch(
        `${c.cloudUrl}/api/v1/sessions/${encodeURIComponent(options.session)}/results`,
        {
          headers: { 'x-api-key': c.apiKey },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok)
        throw new Error(
          `Cloud results failed: ${response.status} ${await response.text()}`,
        );
      for await (const chunk of response.body) process.stdout.write(chunk);
    }
  });
async function exportCloud(config, session) {
  if (!config.cloudUrl)
    throw new Error('PIPELINE_CLOUD_URL is required for cloud export');
  const res = await fetch(
    `${config.cloudUrl}/api/v1/sessions/${encodeURIComponent(session)}/export`,
    {
      headers: { 'x-api-key': config.apiKey },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok)
    throw new Error(`Cloud export failed: ${res.status} ${await res.text()}`);
  for await (const chunk of res.body) process.stdout.write(chunk);
}
program.parseAsync(process.argv).catch((error) => {
  fs.writeSync(
    2,
    `${JSON.stringify({ level: 'error', message: error.message })}\n`,
  );
  process.exitCode = 1;
});
