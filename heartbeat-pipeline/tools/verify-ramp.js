#!/usr/bin/env node
import readline from 'node:readline';

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
let n = 0;
let errors = 0;
for await (const line of input) {
  const item = JSON.parse(line);
  if (!Number.isInteger(item.index)) continue;
  const width = item.sensor === 1 ? 3 : 2;
  for (let c = 0; c < width; c++) {
    const expected = ((item.sensor === 1 ? 3 : 2) * item.index + c) % 8388608;
    if (item.values[c] !== expected) {
      process.stderr.write(
        `Mismatch ${item.sensor}:${item.index}:${c}: ${item.values[c]} != ${expected}\n`,
      );
      errors++;
    }
  }
  n++;
}
process.stdout.write(`${JSON.stringify({ checked: n, errors })}\n`);
if (errors) process.exitCode = 1;
