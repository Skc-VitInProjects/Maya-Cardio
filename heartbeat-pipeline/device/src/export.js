import { unpackInt24 } from '@heartbeat/core';

/** Stream device samples and loss records as the specified NDJSON format. */
export function exportDevice(store, session) {
  for (const row of store.iterate(
    'SELECT sensor,first_index,count,payload FROM chunks WHERE session=? ORDER BY sensor,first_index',
    session,
  )) {
    const values = unpackInt24(row.payload);
    const channels = row.sensor === 1 ? 3 : 2;
    for (let i = 0; i < row.count; i++)
      process.stdout.write(
        `${JSON.stringify({ sensor: row.sensor, index: row.first_index + i, values: values.slice(i * channels, (i + 1) * channels) })}\n`,
      );
  }
  for (const row of store.iterate(
    'SELECT sensor,from_index,to_index,reason FROM losses WHERE session=? ORDER BY sensor,from_index',
    session,
  ))
    process.stdout.write(`${JSON.stringify(row)}\n`);
}
