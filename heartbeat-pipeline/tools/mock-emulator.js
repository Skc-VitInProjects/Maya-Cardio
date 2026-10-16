#!/usr/bin/env node
/**
 * Standalone mock emulator implementing Section 6 of the MayaCardio assessment brief.
 * Mimics biosignal-mock with identical TCP JSON protocol, ramp/signal modes,
 * CRC-32 calculation, buffer retention, and reread capabilities.
 */
import net from 'node:net';
import crypto from 'node:crypto';
import { crc32 } from '../core/crc.js';

// Parse CLI options
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return fallback;
}

const mode = getArg('mode', 'ramp'); // 'ramp' or 'signal'
const seed = Number(getArg('seed', 7));
const duration = Number(getArg('duration', 3600)); // seconds
const port = Number(getArg('port', 7100));
const host = getArg('host', '0.0.0.0');

const sessionId = crypto.createHash('md5').update(`seed-${seed}-${Date.now()}`).digest('hex').slice(0, 8);
const startTime = Date.now();
const MAX_SAMPLES = duration * 400;
const BUFFER_SAMPLES = 10 * 400; // 10-second buffer (4000 samples)

// Synthetic signal generator for realistic ECG
function getSignalSample(sensor, index) {
  const minute = Math.floor(index / 24000);
  const cycleMin = minute % 6;
  const bpm = cycleMin < 2 ? 60 : cycleMin < 4 ? 90 : 72;
  const samplesPerBeat = (400 * 60) / bpm;
  const beatPhase = (index % Math.round(samplesPerBeat)) / samplesPerBeat;

  if (sensor === 1) {
    // Channel 2 ECG-like waveform with a sharp QRS peak
    let ch2 = 0;
    if (beatPhase < 0.05) {
      // P-wave
      ch2 = Math.round(150 * Math.sin((beatPhase / 0.05) * Math.PI));
    } else if (beatPhase >= 0.10 && beatPhase < 0.12) {
      // Q dip
      ch2 = -200;
    } else if (beatPhase >= 0.12 && beatPhase < 0.16) {
      // R sharp peak
      const rPhase = (beatPhase - 0.12) / 0.04;
      ch2 = Math.round(2400 * Math.sin(rPhase * Math.PI));
    } else if (beatPhase >= 0.16 && beatPhase < 0.18) {
      // S dip
      ch2 = -350;
    } else if (beatPhase >= 0.25 && beatPhase < 0.38) {
      // T wave
      const tPhase = (beatPhase - 0.25) / 0.13;
      ch2 = Math.round(350 * Math.sin(tPhase * Math.PI));
    } else {
      // Baseline noise
      ch2 = Math.round((((index * 13) % 20) - 10));
    }
    const ch1 = Math.round(ch2 * 0.6);
    const ch3 = Math.round(ch2 * 1.3);
    return [ch1, ch2, ch3];
  } else {
    // Sensor 2: channel 1 near 400,000, channel 2 near 150,000
    const ch1 = Math.round(400000 + 5000 * Math.sin((index / 400) * 0.1));
    const ch2 = Math.round(150000 + 3000 * Math.cos((index / 400) * 0.08));
    return [ch1, ch2];
  }
}

// Predictable ramp generator
function getRampSample(sensor, index) {
  if (sensor === 1) {
    return [
      (3 * index + 0) % 8388608,
      (3 * index + 1) % 8388608,
      (3 * index + 2) % 8388608,
    ];
  } else {
    return [
      (2 * index + 0) % 8388608,
      (2 * index + 1) % 8388608,
    ];
  }
}

function getSample(sensor, index) {
  return mode === 'signal' ? getSignalSample(sensor, index) : getRampSample(sensor, index);
}

// Track per-sensor read positions
const sensorCursors = { 1: 0, 2: 0 };

const server = net.createServer((socket) => {
  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    while (true) {
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd === -1) break;
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!line) continue;

      try {
        const req = JSON.parse(line);
        if (req.cmd === 'read') {
          handleRead(socket, req);
        }
      } catch (err) {
        socket.write(`${JSON.stringify({ error: err.message })}\n`);
      }
    }
  });

  socket.on('error', () => {});
});

function handleRead(socket, req) {
  const sensor = req.sensor;
  if (sensor !== 1 && sensor !== 2) {
    socket.write(`${JSON.stringify({ error: 'Invalid sensor' })}\n`);
    return;
  }

  // Calculate simulated wall-clock samples produced so far
  const elapsedSec = (Date.now() - startTime) / 1000;
  const currentAvailableSample = Math.min(MAX_SAMPLES, Math.floor(elapsedSec * 400));

  let requestedIndex = req.from_index !== undefined ? Number(req.from_index) : sensorCursors[sensor];
  if (Number.isNaN(requestedIndex) || requestedIndex < 0) requestedIndex = 0;

  const lost = [];
  const bufferFloor = Math.max(0, currentAvailableSample - BUFFER_SAMPLES);

  if (requestedIndex < bufferFloor) {
    lost.push({
      from_index: requestedIndex,
      to_index: bufferFloor - 1,
      reason: 'buffer_overflow',
    });
    requestedIndex = bufferFloor;
  }

  // Deliver up to 1 second of data (at most 400 samples)
  const count = Math.min(400, Math.max(0, currentAvailableSample - requestedIndex));
  const data = [];
  for (let i = 0; i < count; i++) {
    data.push(getSample(sensor, requestedIndex + i));
  }

  sensorCursors[sensor] = requestedIndex + count;
  const isEnd = (requestedIndex + count >= MAX_SAMPLES);

  // Compute CRC32 exactly over JSON array string
  const dataJson = JSON.stringify(data);
  const dataCrc = crc32(dataJson);

  const reply = {
    session_id: sessionId,
    sensor,
    first_index: requestedIndex,
    count,
    lost,
    session_end: isEnd,
    crc32: dataCrc,
    data,
  };

  socket.write(`${JSON.stringify(reply)}\n`);
}

server.listen(port, host, () => {
  process.stdout.write(
    `[biosignal-mock-emulator] Listening on ${host}:${port} | session: ${sessionId} | mode: ${mode} | duration: ${duration}s\n`
  );
});
