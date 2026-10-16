# MayaCardio Heartbeat Pipeline

This repository contains the Heartbeat Pipeline assessment implementation in [`heartbeat-pipeline/`](heartbeat-pipeline/). It collects synthetic 400 Hz samples from the supplied, unmodified `biosignal-mock`, commits them locally before upload, and accounts for known gaps.

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

Clone the repository, install locked dependencies, and install the systemd service:

```sh
sudo git clone https://github.com/Skc-VitInProjects/Maya-Cardio.git /opt/maya-cardio
sudo chown -R "$USER:$USER" /opt/maya-cardio
cd /opt/maya-cardio/heartbeat-pipeline
npm ci
sudo bash ./deploy/install.sh
sudo nano /etc/heartbeat-pipeline/pipeline.env
```

Set `PIPELINE_MOCK_HOST` and `PIPELINE_MOCK_PORT` to the mock address. For cloud use, set `PIPELINE_CLOUD_URL` and `PIPELINE_API_KEY` to the deployed endpoint and matching key. `PIPELINE_DATA_DIR` defaults to `/var/lib/heartbeat-pipeline`; keep it on persistent storage with enough free space. The environment file is created from `.env.example`; replace every placeholder and keep the cloud database variables on the cloud service only.

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

## Cloud setup

The free-tier cloud uses Express and MongoDB Atlas. Deploy the repository-root [`render.yaml`](render.yaml) as a Render Blueprint. It pins Node.js 22.23.0 and installs only the cloud and shared-core workspaces; the device's native SQLite dependency is not needed by the cloud service. Set `MONGODB_URI`, `MONGODB_DB`, and a strong `API_KEY` in the service environment. Point Atlas network access at the service as required by the chosen free plan. The dashboard is served by the API. Configure a free uptime monitor for `/api/v1/health` if the service sleeps; the device also probes it once per second.

If Render logs `MongoServerError: bad auth`, check the Atlas **Database Access** user and password used in `MONGODB_URI` (these are separate from your Atlas website login). Re-copy the driver URI from Atlas and make sure its username and password match that database user. Percent-encode reserved characters in URI credentials, such as `@` as `%40` and `#` as `%23`; do not share the URI in logs or support messages. Update the Render variable and save and deploy the service. A rejected-authentication error means the app reached MongoDB; an IP access-list problem normally appears as a connection timeout instead.

## Checks and submission status

From `heartbeat-pipeline/`, run `npm ci`, `npm test`, `npm run lint`, and `npm run format:check`. The application includes the ramp verifier and fault proxy tools. Actual mock acceptance, destructive fault runs, ARM64 resource measurements, and a demo recording require the supplied mock and target environments; record evidence in [`heartbeat-pipeline/docs/evidence/`](heartbeat-pipeline/docs/evidence/). The current status and limitations are in the [design note](heartbeat-pipeline/docs/DESIGN.md) and [test matrix](heartbeat-pipeline/docs/TESTING.md).

The recording has not been produced; a timed checklist is in [`heartbeat-pipeline/docs/DEMO_SCRIPT.md`](heartbeat-pipeline/docs/DEMO_SCRIPT.md). AI assistance is disclosed in [`heartbeat-pipeline/docs/AI_DISCLOSURE.md`](heartbeat-pipeline/docs/AI_DISCLOSURE.md).
