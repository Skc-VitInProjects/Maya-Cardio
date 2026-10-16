#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-$USER}"
if [[ "$ROOT" != "/opt/heartbeat-pipeline" ]]; then
  echo "Install the checkout at /opt/heartbeat-pipeline first (current path: $ROOT)." >&2
  exit 1
fi
sudo install -d -o "$RUN_USER" -g "$RUN_USER" /etc/heartbeat-pipeline /var/lib/heartbeat-pipeline
if [[ ! -f /etc/heartbeat-pipeline/pipeline.env ]]; then sudo install -m 600 "$ROOT/.env.example" /etc/heartbeat-pipeline/pipeline.env; fi
sed "s/^User=pi$/User=$RUN_USER/; s/^Group=pi$/Group=$RUN_USER/" "$ROOT/deploy/pipeline.service" | sudo tee /etc/systemd/system/pipeline.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable pipeline.service
echo "Edit /etc/heartbeat-pipeline/pipeline.env, then start with sudo systemctl start pipeline.service."
