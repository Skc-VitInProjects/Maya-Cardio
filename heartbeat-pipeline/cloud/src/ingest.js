import { accounted, mergeRanges } from './accounted.js';
import { payloadBuffer } from './binary.js';

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function validateBody(body) {
  if (
    !body ||
    typeof body !== 'object' ||
    typeof body.session !== 'string' ||
    !body.session.length ||
    body.session.length > 200
  )
    throw badRequest('session must be a non-empty string');
  if (body.chunks != null && !Array.isArray(body.chunks))
    throw badRequest('chunks must be an array');
  if (body.losses != null && !Array.isArray(body.losses))
    throw badRequest('losses must be an array');
  if (body.results != null && !Array.isArray(body.results))
    throw badRequest('results must be an array');
  if (
    (body.chunks?.length ?? 0) > 1000 ||
    (body.losses?.length ?? 0) > 2000 ||
    (body.results?.length ?? 0) > 1000
  )
    throw badRequest('ingest batch is too large');
  if (body.mode != null && !['online', 'offline'].includes(body.mode))
    throw badRequest('mode must be online or offline');
  if (
    body.ended != null &&
    (typeof body.ended !== 'object' || Array.isArray(body.ended))
  )
    throw badRequest('ended must be an object');
  for (const chunk of body.chunks ?? []) {
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk))
      throw badRequest('chunk must be an object');
    const channels = chunk.sensor === 1 ? 3 : chunk.sensor === 2 ? 2 : 0;
    if (
      !channels ||
      !Number.isSafeInteger(chunk.first_index) ||
      chunk.first_index < 0 ||
      !Number.isSafeInteger(chunk.count) ||
      chunk.count < 1 ||
      chunk.count > 400 ||
      !Number.isSafeInteger(chunk.first_index + chunk.count)
    )
      throw badRequest('chunk sensor or sample range is invalid');
    if (
      typeof chunk.payload !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        chunk.payload,
      )
    )
      throw badRequest('chunk payload must be base64');
    const bytes = Buffer.from(chunk.payload, 'base64');
    if (
      bytes.toString('base64') !== chunk.payload ||
      bytes.length !== chunk.count * channels * 3
    )
      throw badRequest('chunk payload size does not match its sample count');
    if (typeof chunk.crc32 !== 'string' || !/^[0-9a-f]{8}$/i.test(chunk.crc32))
      throw badRequest('chunk crc32 is invalid');
  }
  for (const loss of body.losses ?? []) {
    if (!loss || typeof loss !== 'object' || Array.isArray(loss))
      throw badRequest('loss must be an object');
    if (
      ![1, 2].includes(loss.sensor) ||
      !Number.isSafeInteger(loss.from_index) ||
      loss.from_index < 0 ||
      (loss.to_index != null &&
        (!Number.isSafeInteger(loss.to_index) ||
          loss.to_index < loss.from_index ||
          loss.to_index === Number.MAX_SAFE_INTEGER)) ||
      typeof loss.reason !== 'string' ||
      !loss.reason.length
    )
      throw badRequest('loss record is invalid');
  }
  for (const result of body.results ?? []) {
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw badRequest('result must be an object');
    if (
      !Number.isSafeInteger(result.window) ||
      result.window < 0 ||
      !['online', 'offline'].includes(result.mode) ||
      (result.heart_rate != null &&
        (!Number.isFinite(result.heart_rate) || result.heart_rate < 0))
    )
      throw badRequest('result record is invalid');
  }
}

/** Idempotently persist an ingest payload and return updated accounted ranges. */
export async function ingest(db, body) {
  validateBody(body);
  const now = new Date();
  const chunks = body.chunks ?? [];
  const losses = body.losses ?? [];
  const previousRanges = await accounted(db, body.session);

  if (chunks.length) {
    const incoming = new Map();
    for (let i = 0; i < chunks.length; i++)
      for (let j = 0; j < i; j++) {
        const left = chunks[i];
        const right = chunks[j];
        if (
          left.sensor === right.sensor &&
          left.first_index < right.first_index + right.count &&
          right.first_index < left.first_index + left.count &&
          left.first_index !== right.first_index
        )
          throw badRequest('chunks in one batch may not overlap');
      }
    for (const chunk of chunks) {
      const key = `${chunk.sensor}:${chunk.first_index}`;
      const previous = incoming.get(key);
      if (
        previous &&
        (previous.count !== chunk.count ||
          previous.crc32 !== chunk.crc32 ||
          previous.payload !== chunk.payload)
      ) {
        const error = new Error(`Conflicting chunks in batch at ${key}`);
        error.status = 409;
        throw error;
      }
      incoming.set(key, chunk);
    }
    const existing = await db
      .collection('chunks')
      .find({
        session: body.session,
        $or: chunks.map((chunk) => ({
          sensor: chunk.sensor,
          first_index: { $lt: chunk.first_index + chunk.count },
          $expr: {
            $gt: [{ $add: ['$first_index', '$count'] }, chunk.first_index],
          },
        })),
      })
      .toArray();
    const byKey = new Map(
      existing.map((row) => [`${row.sensor}:${row.first_index}`, row]),
    );
    for (const chunk of chunks) {
      const end = chunk.first_index + chunk.count;
      for (const row of existing) {
        if (
          row.sensor === chunk.sensor &&
          row.first_index < end &&
          row.first_index + row.count > chunk.first_index &&
          row.first_index !== chunk.first_index
        ) {
          const error = new Error(
            `Overlapping chunk at sensor ${chunk.sensor}, index ${chunk.first_index}`,
          );
          error.status = 409;
          throw error;
        }
      }
      const old = byKey.get(`${chunk.sensor}:${chunk.first_index}`);
      if (
        old &&
        (old.count !== chunk.count ||
          old.crc32 !== chunk.crc32 ||
          !payloadBuffer(old.payload).equals(
            Buffer.from(chunk.payload, 'base64'),
          ))
      ) {
        const error = new Error(
          `Conflicting duplicate chunk at sensor ${chunk.sensor}, index ${chunk.first_index}`,
        );
        error.status = 409;
        throw error;
      }
    }
    await db.collection('chunks').bulkWrite(
      chunks.map((chunk) => ({
        updateOne: {
          filter: {
            session: body.session,
            sensor: chunk.sensor,
            first_index: chunk.first_index,
          },
          update: {
            $setOnInsert: {
              session: body.session,
              sensor: chunk.sensor,
              first_index: chunk.first_index,
              count: chunk.count,
              payload: Buffer.from(chunk.payload, 'base64'),
              crc32: chunk.crc32,
              received_at: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  if (losses.length)
    await db.collection('losses').bulkWrite(
      losses.map((loss) => ({
        updateOne: {
          filter: {
            session: body.session,
            sensor: loss.sensor,
            from_index: loss.from_index,
            reason: loss.reason,
          },
          update: {
            $setOnInsert: { ...loss, session: body.session, received_at: now },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );

  const nextRanges = { 1: [...previousRanges[1]], 2: [...previousRanges[2]] };
  for (const chunk of chunks)
    nextRanges[chunk.sensor].push([
      chunk.first_index,
      chunk.first_index + chunk.count,
    ]);
  for (const loss of losses)
    nextRanges[loss.sensor].push([
      loss.from_index,
      loss.to_index == null ? null : loss.to_index + 1,
    ]);
  for (const sensor of [1, 2])
    nextRanges[sensor] = mergeRanges(nextRanges[sensor]);

  await db.collection('sessions').updateOne(
    { id: body.session },
    {
      $set: {
        id: body.session,
        updated_at: now,
        mode: body.mode ?? 'online',
        ended: body.ended ?? {},
        accounted_ranges: nextRanges,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true },
  );

  if (body.results?.length)
    await db.collection('results').bulkWrite(
      body.results.map((result) => ({
        updateOne: {
          filter: {
            session: body.session,
            window: result.window,
            mode: result.mode,
          },
          update: {
            $setOnInsert: {
              ...result,
              session: body.session,
              received_at: now,
              processed_at: new Date(),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );

  const counts = {};
  for (const sensor of [1, 2])
    counts[sensor] =
      (
        await db
          .collection('chunks')
          .aggregate([
            { $match: { session: body.session, sensor } },
            { $group: { _id: null, n: { $sum: '$count' } } },
          ])
          .next()
      )?.n ?? 0;
  return { accounted: nextRanges, counts };
}
