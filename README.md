# MayaCardio Heartbeat Pipeline

This repository contains the Heartbeat Pipeline assessment implementation in [`heartbeat-pipeline/`](heartbeat-pipeline/). It collects synthetic 400 Hz samples from the supplied, unmodified `biosignal-mock`, commits them locally before upload, and accounts for known gaps.

## Live dashboard

Open the deployed [Heartbeat Pipeline dashboard](https://heartbeat-pipeline.onrender.com/). It shows the sessions currently stored in the cloud, including device mode, saved and uploaded sample counts, backlog, recent heart-rate windows, and recorded losses. The dashboard reads from the deployed cloud service; board setup is only needed to run a device pipeline. Use synthetic assessment data only.

The cloud health endpoint is [https://heartbeat-pipeline.onrender.com/api/v1/health](https://heartbeat-pipeline.onrender.com/api/v1/health). A healthy response is `{"ok":true}`.

## Install on a fresh ARM64 board

These steps target Raspberry Pi OS 64-bit on a board limited to four cores and 2 GB RAM. Obtain the assessment's `biosignal-mock` and `check_ground_truth` binaries from the MayaCardio contact; the brief's download link is blank. Do not edit the mock.

Install system packages and the official Node.js 22 ARM64 build. The [Node.js v22.23.0 archive](https://nodejs.org/en/download/archive/v22.23.0) provides the Linux ARM64 binary and checksums; this example pins that release, available on 16 October 2026.

```sh
sudo apt-get update
sudo apt-get install -y curl xz-utils git build-essential python3
cd /tmp
curl -fsSLO https://nodejs.org/dist/v22.23.0/node-v22.23.0-linux-arm64.tar.xz
curl -fsSLO https://nodejs.org/dist/v22.23.0/SHASUMS256.txt
grep 'node-v22.23.0-linux-arm64.tar.xz$' SHASUMS256.txt | sha256sum --check -
sudo tar -xJf node-v22.23.0-linux-arm64.tar.xz -C /usr/local --strip-components=1
node --version
npm --version
```

Clone the repository, install the locked dependencies, and install the systemd service:

```sh
sudo git clone https://github.com/Skc-VitInProjects/Maya-Cardio.git /opt/maya-cardio
sudo chown -R "$USER:$USER" /opt/maya-cardio
cd /opt/maya-cardio/heartbeat-pipeline
npm ci
sudo bash ./deploy/install.sh
sudo nano /etc/heartbeat-pipeline/pipeline.env
```

Set `PIPELINE_MOCK_HOST` and `PIPELINE_MOCK_PORT` to the mock address. To upload to the live service, set `PIPELINE_CLOUD_URL=https://heartbeat-pipeline.onrender.com` and `PIPELINE_API_KEY` to the same key configured on Render. `PIPELINE_DATA_DIR` defaults to `/var/lib/heartbeat-pipeline`; keep it on persistent storage with enough free space. The environment file is created from `.env.example`; replace every placeholder. Keep `MONGODB_URI` and other database credentials on the cloud service only; the device needs only the cloud URL and API key.

Install the provided mock binary at `/usr/bin/biosignal-mock` or adjust its launch command. Start a synthetic test run and the pipeline:

```sh
sudo chmod 755 /usr/bin/biosignal-mock
sudo -u "$USER" /usr/bin/biosignal-mock --mode ramp --seed 7 --duration 3600 --port 7100
```

In a second terminal:

```sh
sudo systemctl start pipeline.service
sudo systemctl status pipeline.service
pipeline status
```

For heart-rate behavior, use `--mode signal` instead of `--mode ramp`. The mock is a separate process and must be running before collecting. `deploy/mock.service` is a reference unit if you want the mock managed by systemd; edit its user and executable path for the board.

## Commands

```sh
pipeline status
pipeline export --session SESSION_ID --from device
pipeline export --session SESSION_ID --from cloud
pipeline results --session SESSION_ID
```

`pipeline status` emits one JSON line. Device export streams stored samples followed by loss records as NDJSON. Cloud export and results require a reachable cloud service and the configured API key. Run the daemon in the foreground with `pipeline run` when debugging.

## Cloud setup and deployment

The cloud service uses Express and MongoDB Atlas. The repository-root [`render.yaml`](render.yaml) configures the Render Blueprint, pins Node.js 22.23.0, and installs only the cloud and shared-core workspaces. The device's native SQLite dependency is not needed by the cloud service.

1. In Atlas, create a database and a **database user** with read/write access to the `heartbeat` database. Copy the application connection string for that cluster.
2. In Render, deploy the repository-root `render.yaml` as a Blueprint. In the service environment, set `MONGODB_URI` to the Atlas connection string, `MONGODB_DB` to `heartbeat`, and `API_KEY` to a strong random secret.
3. Set the device's `PIPELINE_CLOUD_URL` to `https://heartbeat-pipeline.onrender.com` and its `PIPELINE_API_KEY` to the same value as Render's `API_KEY`.
4. Open the [dashboard](https://heartbeat-pipeline.onrender.com/) to view cloud sessions. If the free service sleeps, the first request may take longer; a free uptime monitor can check `/api/v1/health` at its shortest available interval.

If Render logs `MongoServerError: bad auth`, check that `MONGODB_URI` uses the Atlas **database user**, not your Atlas website login. Re-copy the driver URI and verify its username and password. Percent-encode reserved characters in URI credentials, such as `@` as `%40` and `#` as `%23`. Update the Render variable and save and deploy the service. Never include the URI or password in logs, screenshots, or support messages. An IP access-list problem normally appears as a connection timeout instead.

## Checks and submission status

From `heartbeat-pipeline/`, run `npm ci`, `npm test`, `npm run lint`, and `npm run format:check`. The application includes the ramp verifier and fault proxy tools. Actual mock acceptance, destructive fault runs, ARM64 resource measurements, and a demo recording require the supplied mock and target environments; record evidence in [`heartbeat-pipeline/docs/evidence/`](heartbeat-pipeline/docs/evidence/). The current status and limitations are in the [design note](heartbeat-pipeline/docs/DESIGN.md) and [test matrix](heartbeat-pipeline/docs/TESTING.md).

The recording has not been produced; a timed checklist is in [`heartbeat-pipeline/docs/DEMO_SCRIPT.md`](heartbeat-pipeline/docs/DEMO_SCRIPT.md). AI assistance is disclosed in [`heartbeat-pipeline/docs/AI_DISCLOSURE.md`](heartbeat-pipeline/docs/AI_DISCLOSURE.md).
