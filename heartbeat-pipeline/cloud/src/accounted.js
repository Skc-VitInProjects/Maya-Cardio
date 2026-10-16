/** Merge half-open intervals in ascending order. */
export function mergeRanges(ranges) {
  const sorted = ranges
    .filter((r) => r[1] == null || r[1] > r[0])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && (last[1] == null || range[0] <= last[1])) {
      if (last[1] != null)
        last[1] = range[1] == null ? null : Math.max(last[1], range[1]);
    } else out.push([...range]);
  }
  return out;
}

/** Build accounted half-open sample ranges from chunks and losses. */
export async function accounted(db, session) {
  const cached = await db
    .collection('sessions')
    .findOne({ id: session }, { projection: { accounted_ranges: 1 } });
  if (cached?.accounted_ranges) return cached.accounted_ranges;
  const output = { 1: [], 2: [] };
  for (const sensor of [1, 2]) {
    const chunks = await db
      .collection('chunks')
      .find({ session, sensor }, { projection: { first_index: 1, count: 1 } })
      .toArray();
    const losses = await db
      .collection('losses')
      .find({ session, sensor }, { projection: { from_index: 1, to_index: 1 } })
      .toArray();
    output[sensor] = mergeRanges([
      ...chunks.map((c) => [c.first_index, c.first_index + c.count]),
      ...losses.map((l) => [
        l.from_index,
        l.to_index == null ? null : l.to_index + 1,
      ]),
    ]);
  }
  await db
    .collection('sessions')
    .updateOne(
      { id: session },
      { $set: { accounted_ranges: output } },
      { upsert: true },
    );
  return output;
}
