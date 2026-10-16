import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingest } from '../src/ingest.js';

function clone(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)]),
    );
  return value;
}

class MemoryCollection {
  constructor(name, db) {
    this.name = name;
    this.db = db;
  }

  async findOne(filter) {
    return this.db.rows[this.name].find((row) => row.id === filter.id) ?? null;
  }

  find(filter = {}) {
    const rows = this.db.rows[this.name].filter(
      (row) => !filter.session || row.session === filter.session,
    );
    return { toArray: async () => clone(rows) };
  }

  async bulkWrite(operations) {
    for (const { updateOne } of operations) {
      const fields = updateOne.filter;
      const index = this.db.rows[this.name].findIndex((row) =>
        Object.entries(fields).every(([key, value]) => row[key] === value),
      );
      if (index < 0 && updateOne.upsert)
        this.db.rows[this.name].push(clone(updateOne.update.$setOnInsert));
    }
  }

  async updateOne(filter, update) {
    let row = this.db.rows[this.name].find((item) => item.id === filter.id);
    if (!row) {
      row = clone(update.$setOnInsert ?? {});
      this.db.rows[this.name].push(row);
    }
    Object.assign(row, clone(update.$set ?? {}));
  }

  aggregate(pipeline) {
    const match = pipeline[0].$match;
    const count = this.db.rows[this.name]
      .filter(
        (row) => row.session === match.session && row.sensor === match.sensor,
      )
      .reduce((total, row) => total + row.count, 0);
    return { next: async () => (count ? { n: count } : null) };
  }
}

class MemoryDb {
  rows = { chunks: [], losses: [], results: [], sessions: [] };

  collection(name) {
    return new MemoryCollection(name, this);
  }
}

const chunk = {
  sensor: 1,
  first_index: 0,
  count: 1,
  payload: Buffer.from([0, 0, 1, 0, 0, 2, 0, 0, 3]).toString('base64'),
  crc32: '00000000',
};

test('cloud ingest retries are idempotent and conflicts are rejected', async () => {
  const db = new MemoryDb();
  const body = { session: 'session-a', chunks: [chunk] };
  const first = await ingest(db, body);
  const second = await ingest(db, body);
  assert.deepEqual(first.accounted[1], [[0, 1]]);
  assert.deepEqual(second.accounted[1], [[0, 1]]);
  assert.equal(db.rows.chunks.length, 1);
  assert.equal(second.counts[1], 1);

  await assert.rejects(
    ingest(db, {
      ...body,
      chunks: [
        {
          ...chunk,
          payload: Buffer.from([0, 0, 4, 0, 0, 5, 0, 0, 6]).toString('base64'),
        },
      ],
    }),
    (error) => error.status === 409,
  );
  assert.equal(db.rows.chunks.length, 1);
});

test('cloud ingest preserves and acknowledges open-ended losses', async () => {
  const db = new MemoryDb();
  const body = {
    session: 'old-session',
    losses: [
      { sensor: 2, from_index: 40, to_index: null, reason: 'mock_restart' },
    ],
  };
  const first = await ingest(db, body);
  const second = await ingest(db, body);
  assert.deepEqual(first.accounted[2], [[40, null]]);
  assert.deepEqual(second.accounted[2], [[40, null]]);
  assert.equal(db.rows.losses.length, 1);
});
