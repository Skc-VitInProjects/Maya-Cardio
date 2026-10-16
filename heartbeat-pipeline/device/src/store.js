import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/** Durable SQLite store using WAL and FULL synchronous commits. */
export class Store {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.filename = filename;
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, first_seen TEXT NOT NULL, ended INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS cursors(session TEXT NOT NULL, sensor INTEGER NOT NULL, next_index INTEGER NOT NULL DEFAULT 0, ended INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session,sensor));
      CREATE TABLE IF NOT EXISTS chunks(session TEXT NOT NULL,sensor INTEGER NOT NULL,first_index INTEGER NOT NULL,count INTEGER NOT NULL,payload BLOB NOT NULL,crc32 TEXT NOT NULL,PRIMARY KEY(session,sensor,first_index)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS losses(session TEXT NOT NULL,sensor INTEGER NOT NULL,from_index INTEGER NOT NULL,to_index INTEGER,reason TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(session,sensor,from_index,reason));
      CREATE TABLE IF NOT EXISTS results(session TEXT NOT NULL,window INTEGER NOT NULL,mode TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(session,window,mode));
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    `);
    const check = this.db.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error(`SQLite quick_check failed: ${check}`);
    this.reservePath = path.join(path.dirname(filename), 'reserve.bin');
    if (!fs.existsSync(this.reservePath)) {
      const fd = fs.openSync(this.reservePath, 'w');
      fs.writeSync(fd, Buffer.alloc(8 * 1024 * 1024));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    }
  }

  /** Execute a set of writes atomically and durably. */
  transaction(fn) { return this.db.transaction(fn)(); }
  /** Read SQL rows. */
  all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  /** Read one SQL row. */
  get(sql, ...params) { return this.db.prepare(sql).get(...params); }
  /** Iterate SQL rows without loading the full result into memory. */
  *iterate(sql, ...params) { yield* this.db.prepare(sql).iterate(...params); }
  /** Execute a SQL write. */
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }
  /** Close the database cleanly. */
  close() { this.db.close(); }

  /** Save one validated reply and advance its cursor in the same transaction. */
  saveReply(reply, fresh, payload) {
    const insertSession = this.db.prepare('INSERT OR IGNORE INTO sessions(id,first_seen) VALUES(?,?)');
    const cursor = this.db.prepare('INSERT INTO cursors(session,sensor,next_index,ended) VALUES(?,?,0,0) ON CONFLICT(session,sensor) DO NOTHING');
    const chunk = this.db.prepare('INSERT OR IGNORE INTO chunks(session,sensor,first_index,count,payload,crc32) VALUES(?,?,?,?,?,?)');
    const loss = this.db.prepare('INSERT OR IGNORE INTO losses(session,sensor,from_index,to_index,reason,source) VALUES(?,?,?,?,?,?)');
    const advance = this.db.prepare('UPDATE cursors SET next_index=?,ended=? WHERE session=? AND sensor=?');
    this.transaction(() => {
      insertSession.run(reply.session_id, new Date().toISOString());
      cursor.run(reply.session_id, reply.sensor);
      for (const item of reply.lost ?? []) loss.run(reply.session_id, reply.sensor, item.from_index, item.to_index ?? null, item.reason ?? 'mock_loss', 'mock');
      if (fresh.length) chunk.run(reply.session_id, reply.sensor, fresh[0].index, fresh.length, payload, reply.crc32);
      const maxLoss = Math.max(-1, ...(reply.lost ?? []).map(item => Number(item.to_index ?? -1)));
      const next = Math.max(Number(reply.first_index) + Number(reply.count), maxLoss + 1, Number(this.get('SELECT next_index FROM cursors WHERE session=? AND sensor=?', reply.session_id, reply.sensor)?.next_index ?? 0));
      advance.run(next, reply.session_end ? 1 : 0, reply.session_id, reply.sensor);
      if (reply.session_end) this.run('UPDATE sessions SET ended=1 WHERE id=?', reply.session_id);
    });
  }
}
