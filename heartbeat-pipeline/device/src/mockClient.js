import net from 'node:net';

/** One-request newline JSON TCP client for the mock service. */
export function requestMock({ host, port, sensor, fromIndex, timeoutMs = 2000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let data = '';
    const timer = setTimeout(() => socket.destroy(new Error('mock request timed out')), timeoutMs);
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => socket.write(`${JSON.stringify({ cmd: 'read', sensor, from_index: fromIndex })}\n`));
    socket.on('data', chunk => {
      data += chunk.toString('utf8');
      const newline = data.indexOf('\n');
      if (newline >= 0) {
        clearTimeout(timer); socket.end();
        resolve(data.slice(0, newline));
      }
    });
    socket.once('timeout', () => socket.destroy(new Error('mock request timed out')));
    socket.once('error', error => { clearTimeout(timer); reject(error); });
    socket.once('close', () => clearTimeout(timer));
  });
}
