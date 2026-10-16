import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDatabase } from './db.js';
import { ingest } from './ingest.js';
import { accounted } from './accounted.js';
import { processReadyWindows } from './processor.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Build the cloud API app with injected Mongo database. */
export function createApp(db, apiKey = process.env.API_KEY ?? '') {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('X-Frame-Options', 'DENY'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  app.use((req, res, next) => { const start = performance.now(); res.on('finish', () => process.stdout.write(`${JSON.stringify({ level: 'info', event: 'http_request', method: req.method, path: req.path, status: res.statusCode, duration_ms: Math.round(performance.now() - start) })}\n`)); next(); });
  app.use(express.json({ limit: '8mb', inflate: true }));
  const auth = (req, res, next) => {
    if (!apiKey || req.get('x-api-key') !== apiKey) return res.status(401).json({ error: 'unauthorized' });
    next();
  };
  app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/v1/heartbeat', auth, async (req, res, next) => {
    try { const { device_id, mode, session, saved } = req.body; await db.collection('devices').updateOne({ device_id }, { $set: { device_id, mode, session, saved, seen_at: new Date() } }, { upsert: true }); res.json({ server_time: new Date().toISOString(), accounted: session ? await accounted(db, session) : {} }); } catch (e) { next(e); }
  });
  app.post('/api/v1/ingest', auth, async (req, res, next) => { try { const result = await ingest(db, req.body); await processReadyWindows(db, req.body.session, req.body.process_from_window ?? 0); res.json(result); } catch (e) { next(e); } });
  app.get('/api/v1/sessions', async (_req, res, next) => { try { res.json(await db.collection('sessions').find({}, { projection: { _id: 0 } }).sort({ updated_at: -1 }).toArray()); } catch (e) { next(e); } });
  app.get('/api/v1/sessions/:id/accounted', auth, async (req, res, next) => { try { res.json(await accounted(db, req.params.id)); } catch (e) { next(e); } });
  app.get('/api/v1/sessions/:id/summary', async (req, res, next) => {
    try { const session = req.params.id; const docs = await db.collection('chunks').aggregate([{ $match: { session } }, { $group: { _id: '$sensor', count: { $sum: '$count' } } }]).toArray(); const inCloud = { 1: docs.find(x => x._id === 1)?.count ?? 0, 2: docs.find(x => x._id === 2)?.count ?? 0 }; const device = await db.collection('devices').findOne({ session }, { sort: { seen_at: -1 } }); const saved = device?.saved ?? inCloud; const backlog = { 1: Math.max(0, saved[1] - inCloud[1]), 2: Math.max(0, saved[2] - inCloud[2]) }; const losses = await db.collection('losses').find({ session }, { projection: { _id: 0 } }).sort({ from_index: -1 }).limit(12).toArray(); const results = await db.collection('results').find({ session }, { projection: { _id: 0, window: 1, mode: 1, heart_rate: 1 } }).sort({ window: -1 }).limit(10).toArray(); res.json({ session, saved, in_cloud: inCloud, backlog, losses, latest_windows: results, mode: device?.mode ?? 'offline' }); } catch (e) { next(e); }
  });
  app.get('/api/v1/sessions/:id/results', auth, async (req, res, next) => { try { res.type('application/x-ndjson'); const cursor = db.collection('results').find({ session: req.params.id }).sort({ window: 1, mode: 1 }); for await (const row of cursor) { delete row._id; res.write(`${JSON.stringify(row)}\n`); } res.end(); } catch (e) { next(e); } });
  app.get('/api/v1/sessions/:id/export', auth, async (req, res, next) => { try { res.type('application/x-ndjson'); const session = req.params.id; for (const sensor of [1, 2]) { const width = sensor === 1 ? 3 : 2; const cursor = db.collection('chunks').find({ session, sensor }).sort({ first_index: 1 }); for await (const c of cursor) { const data = Buffer.from(c.payload); for (let j = 0; j < c.count; j++) { const vals = []; for (let k = 0; k < width; k++) { const o = (j * width + k) * 3; let v = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2]; if (v & 0x800000) v -= 0x1000000; vals.push(v); } res.write(`${JSON.stringify({ sensor, index: c.first_index + j, values: vals })}\n`); } } } for await (const l of db.collection('losses').find({ session }).sort({ sensor: 1, from_index: 1 })) { delete l._id; res.write(`${JSON.stringify(l)}\n`); } res.end(); } catch (e) { next(e); } });
  app.delete('/api/v1/sessions/:id', auth, async (req, res, next) => { try { const session = req.params.id; await Promise.all(['chunks', 'losses', 'results'].map(c => db.collection(c).deleteMany({ session }))); await db.collection('sessions').deleteOne({ id: session }); res.json({ deleted: session }); } catch (e) { next(e); } });
  app.use(express.static(path.join(here, '../public')));
  app.use((err, _req, res, _next) => { process.stderr.write(`${JSON.stringify({ level: 'error', message: err.message })}\n`); res.status(500).json({ error: 'internal_error' }); });
  return app;
}

/** Start API after validating cloud environment. */
export async function start() {
  if (!process.env.MONGODB_URI || !process.env.API_KEY) throw new Error('MONGODB_URI and API_KEY are required');
  const { client, db } = await connectDatabase(process.env.MONGODB_URI, process.env.MONGODB_DB ?? 'heartbeat');
  const port = Number(process.env.PORT ?? 3000); const server = createApp(db).listen(port, () => process.stdout.write(`${JSON.stringify({ event: 'listening', port })}\n`));
  const shutdown = async () => { server.close(); await client.close(); process.exit(0); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
