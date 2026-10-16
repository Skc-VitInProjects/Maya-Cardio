/** Merge half-open intervals in ascending order. */
export function mergeRanges(ranges) {
  const sorted = ranges.filter(r => r[1] > r[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else out.push([...range]);
  }
  return out;
}

/** Build accounted half-open sample ranges from chunks and losses. */
export async function accounted(db, session) {
  const output = { 1: [], 2: [] };
  for (const sensor of [1, 2]) {
    const chunks = await db.collection('chunks').find({ session, sensor }, { projection: { first_index: 1, count: 1 } }).toArray();
    const losses = await db.collection('losses').find({ session, sensor }, { projection: { from_index: 1, to_index: 1 } }).toArray();
    output[sensor] = mergeRanges([
      ...chunks.map(c => [c.first_index, c.first_index + c.count]),
      ...losses.map(l => [l.from_index, l.to_index == null ? l.from_index + 1 : l.to_index + 1]),
    ]);
  }
  return output;
}
