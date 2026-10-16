#!/usr/bin/env node
import net from 'node:net';
const listenPort = Number(process.env.PROXY_PORT ?? 7101);
const targetPort = Number(process.env.MOCK_PORT ?? 7100);
const fault = process.env.FAULT ?? 'pass';
let held = false;
net
  .createServer((client) => {
    const upstream = net.createConnection({
      host: process.env.MOCK_HOST ?? '127.0.0.1',
      port: targetPort,
    });
    let request = '';
    client.on('data', (chunk) => {
      request += chunk.toString();
      const newline = request.indexOf('\n');
      if (newline < 0) return;
      const line = request.slice(0, newline);
      request = request.slice(newline + 1);
      const sensor = JSON.parse(line).sensor;
      if (fault === 'sensor2-stall' && sensor === 2) return;
      upstream.write(`${line}\n${request}`);
      request = '';
    });
    let pending = '';
    upstream.on('data', (chunk) => {
      if (fault === 'stall' || fault === 'sensor2-stall') return;
      pending += chunk.toString();
      const newline = pending.indexOf('\n');
      if (newline < 0) return;
      let line = pending.slice(0, newline);
      const rest = pending.slice(newline + 1);
      pending = '';
      if (fault === 'corrupt' && !held) {
        const reply = JSON.parse(line);
        reply.crc32 = '00000000';
        line = JSON.stringify(reply);
        held = true;
      }
      client.write(
        `${line}\n${fault === 'duplicate' ? `${line}\n` : ''}${rest}`,
      );
    });
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  })
  .listen(listenPort, '0.0.0.0', () =>
    process.stdout.write(`fault proxy ${fault} listening on ${listenPort}\n`),
  );
