import path from 'node:path';

/** Read and validate device configuration from the environment. */
export function readConfig(env = process.env) {
  const number = (name, fallback, min, max) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
    return value;
  };
  return {
    mockHost: env.PIPELINE_MOCK_HOST ?? '127.0.0.1',
    mockPort: number('PIPELINE_MOCK_PORT', 7100, 1, 65535),
    cloudUrl: (env.PIPELINE_CLOUD_URL ?? '').replace(/\/$/, ''),
    apiKey: env.PIPELINE_API_KEY ?? '',
    dataDir: path.resolve(env.PIPELINE_DATA_DIR ?? './data'),
    pollMs: number('PIPELINE_POLL_MS', 500, 100, 5000),
    deviceId: env.PIPELINE_DEVICE_ID ?? 'device-1',
    dbPath: path.resolve(env.PIPELINE_DB_PATH ?? path.join(env.PIPELINE_DATA_DIR ?? './data', 'pipeline.sqlite')),
  };
}
