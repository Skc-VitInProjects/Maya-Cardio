/** Print stored results for one session as NDJSON. */
export function printResults(store, session) {
  for (const row of store.iterate(
    'SELECT body FROM results WHERE session=? ORDER BY window,mode',
    session,
  ))
    process.stdout.write(`${row.body}\n`);
}
