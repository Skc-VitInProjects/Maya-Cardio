# Heartbeat Pipeline

Heartbeat Pipeline collects two 400 Hz biosignals, commits accepted replies to a local SQLite WAL database, and synchronizes data to a MongoDB-backed cloud API. The device keeps collecting while the cloud is unavailable. Its accounting rule is: each known sample index is stored once or covered by a loss record with a reason.

## Live dashboard

The deployed [Heartbeat Pipeline dashboard](https://heartbeat-pipeline.onrender.com/) shows cloud sessions, sample counts, backlog, recent heart-rate windows, and recorded losses. The health endpoint is [https://heartbeat-pipeline.onrender.com/api/v1/health](https://heartbeat-pipeline.onrender.com/api/v1/health). All assessment data must be synthetic.

## Requirements

- Raspberry Pi OS 64-bit or another ARM64 Linux host limited to four cores and 2 GB RAM.
- Node.js 22 LTS and npm. `better-sqlite3` uses its prebuilt binary when available; otherwise install the platform build tools required by that package.
- The supplied `biosignal-mock` executable. Do not modify it.
- Free MongoDB Atlas M0 and a free Render web service for deployment.

## Device installation

Clone the repository to `/opt/heartbeat-pipeline`, run `npm ci`, and run `sudo bash ./deploy/install.sh`. Edit `/etc/heartbeat-pipeline/pipeline.env` with the mock address, cloud URL, API key, and data directory, then start the service with `sudo systemctl start pipeline`. Start the unmodified mock separately with `biosignal-mock --mode signal --seed 7 --duration 3600 --port 7100`.

| Variable             | Purpose                 | Default     |
| -------------------- | ----------------------- | ----------- |
| `PIPELINE_MOCK_HOST` | Mock TCP hostname       | `127.0.0.1` |
| `PIPELINE_MOCK_PORT` | Mock TCP port           | `7100`      |
| `PIPELINE_CLOUD_URL` | Cloud base URL          | unset       |
| `PIPELINE_API_KEY`   | Cloud write/export key  | unset       |
| `PIPELINE_DATA_DIR`  | Device data directory   | `./data`    |
| `PIPELINE_POLL_MS`   | Sensor polling interval | `500`       |

Commands are `pipeline run`, `pipeline status`, `pipeline export --session ID --from device|cloud`, and `pipeline results --session ID`. Exports are newline-delimited JSON.

## Cloud deployment

Create an Atlas M0 database in a nearby region and a database user with read/write access to the `heartbeat` database. Configure Atlas network access for the Render service; the free service has no fixed outbound IP. Create a Render Blueprint from the repository-root `render.yaml`, then set `MONGODB_URI`, `MONGODB_DB=heartbeat`, and a long random `API_KEY` in the service environment. Configure the device with `PIPELINE_CLOUD_URL=https://heartbeat-pipeline.onrender.com` and the same key as `PIPELINE_API_KEY`. If Atlas reports `bad auth`, verify the database username/password and percent-encode reserved characters in the URI credentials. Add a free uptime monitor for `/api/v1/health` if needed. Monitor Atlas storage: the M0 tier is limited, so stop ingest or remove old synthetic test sessions before it fills.

## Verification and operations

Use `tools/verify-ramp.js` with device or cloud NDJSON export on stdin to check ramp values. `tools/fault-proxy.js` can proxy the mock for corrupt, duplicate, stalled, and sensor-specific stalled replies. `bash tools/faults.sh` provides guarded operator actions; destructive actions belong only on a disposable test environment. Run `bash tools/resource-log.sh PID eth0 3600` to record resource use on Linux, including compressed uploader body bytes and interface transmit bytes. Store actual commands, logs, and results in `docs/evidence/`.

See [DESIGN.md](DESIGN.md) for guarantees and limitations and [TESTING.md](TESTING.md) for the acceptance matrix. Do not report a test, cloud deployment, ARM64 measurement, or resource run as completed unless its evidence was collected.
