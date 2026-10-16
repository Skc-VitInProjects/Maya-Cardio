#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-$USER}"
sudo install -d -o "$RUN_USER" -g "$RUN_USER" /etc/heartbeat-pipeline /var/lib/heartbeat-pipeline
if [[ ! -f /etc/heartbeat-pipeline/pipeline.env ]]; then sudo install -m 600 "$ROOT/.env.example" /etc/heartbeat-pipeline/pipeline.env; fi
sed -e "s|@APP_ROOT@|$ROOT|g" -e "s/^User=pi$/User=$RUN_USER/; s/^Group=pi$/Group=$RUN_USER/" "$ROOT/deploy/pipeline.service" | sudo tee /etc/systemd/system/pipeline.service >/dev/null
sudo chmod 755 "$ROOT/device/src/cli.js"
sudo ln -sfn "$ROOT/device/src/cli.js" /usr/local/bin/pipeline
sudo systemctl daemon-reload
sudo systemctl enable pipeline.service
echo "Edit /etc/heartbeat-pipeline/pipeline.env, then start with sudo systemctl start pipeline.service."
