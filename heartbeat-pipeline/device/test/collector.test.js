import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from '@heartbeat/core';
import { collectSensor } from '../src/collector.js';
import { Store } from '../src/store.js';

async function startMock(onRequest) {
  const server = net.createServer((socket) => {
    let input = '';
    socket.on('data', (chunk) => {
      input += chunk.toString();
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(input.slice(0, newline));
      const reply = onRequest(request);
      const rawData = JSON.stringify(reply.data);
      reply.crc32 = crc32(rawData);
      const line = JSON.stringify(reply).replace(
        `"data":${rawData}`,
        `"data":${rawData}`,
      );
      socket.end(`${line}\n`);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heartbeat-test-'));
  return { dir, store: new Store(path.join(dir, 'pipeline.sqlite')) };
}

test('restart recovery re-reads a new mock session from index zero', async () => {
  const { dir, store } = makeStore();
  const requests = [];
  const mock = await startMock((request) => {
    requests.push(request.from_index);
    return {
      session_id: 'new-session',
      sensor: 1,
      first_index: request.from_index || 0,
      count: request.from_index ? 0 : 1,
      lost: [],
      session_end: false,
      data: request.from_index ? [] : [[11, 22, 33]],
    };
  });
  try {
    store.run(
      'INSERT INTO sessions(id,first_seen) VALUES(?,?)',
      'old-session',
      new Date().toISOString(),
    );
    store.run(
      'INSERT INTO cursors(session,sensor,next_index,ended) VALUES(?,?,?,0)',
      'old-session',
      1,
      50,
    );
    const sessionState = { current: 'old-session' };
    await collectSensor({
      config: { mockHost: '127.0.0.1', mockPort: mock.port },
      store,
      sensor: 1,
      sessionState,
      logger: {},
    });
    assert.deepEqual(requests, [50, 0]);
    assert.equal(
      store.get(
        'SELECT count FROM chunks WHERE session=? AND sensor=1 AND first_index=0',
        'new-session',
      ).count,
      1,
    );
    assert.equal(
      store.get(
        'SELECT to_index FROM losses WHERE session=? AND sensor=1',
        'old-session',
      ).to_index,
      null,
    );
    assert.equal(
      store.get(
        'SELECT to_index FROM losses WHERE session=? AND sensor=2',
        'old-session',
      ).to_index,
      null,
    );
    assert.equal(
      store.get(
        'SELECT from_index FROM losses WHERE session=? AND sensor=2',
        'old-session',
      ).from_index,
      0,
    );
  } finally {
    mock.server.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate mock reply does not create a second chunk or sample', async () => {
  const { dir, store } = makeStore();
  const mock = await startMock(() => ({
    session_id: 'same-session',
    sensor: 1,
    first_index: 0,
    count: 1,
    lost: [],
    session_end: false,
    data: [[7, 8, 9]],
  }));
  try {
    const sessionState = { current: null };
    const config = { mockHost: '127.0.0.1', mockPort: mock.port };
    await collectSensor({ config, store, sensor: 1, sessionState, logger: {} });
    await collectSensor({ config, store, sensor: 1, sessionState, logger: {} });
    assert.equal(
      store.get(
        'SELECT COUNT(*) n FROM chunks WHERE session=? AND sensor=1',
        'same-session',
      ).n,
      1,
    );
    assert.deepEqual(
      store.all(
        'SELECT first_index,count FROM chunks WHERE session=?',
        'same-session',
      ),
      [{ first_index: 0, count: 1 }],
    );
  } finally {
    mock.server.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
