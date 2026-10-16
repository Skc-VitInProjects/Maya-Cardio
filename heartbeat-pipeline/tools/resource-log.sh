#!/usr/bin/env bash
set -euo pipefail
PID="${1:?usage: resource-log.sh PID [interface] [seconds]}"
IFACE="${2:-eth0}"; DURATION="${3:-3600}"; INTERVAL=10
UPLOADER_BYTES_FILE="${PIPELINE_UPLOADER_BYTES_FILE:-/var/lib/heartbeat-pipeline/uploader-bytes.txt}"
UPLOADER0=0; [[ -f "$UPLOADER_BYTES_FILE" ]] && UPLOADER0=$(cat "$UPLOADER_BYTES_FILE")
read -r U0 S0 < <(awk '{print $14, $15}' "/proc/$PID/stat"); read -r W0 < <(awk '/write_bytes/ {print $2}' "/proc/$PID/io"); TX0=$(awk -v i="$IFACE" '$1 ~ i":" {print $10}' /proc/net/dev)
kill -0 "$PID" || { echo "process $PID is not running" >&2; exit 1; }
START=$SECONDS
while (( SECONDS - START < DURATION )); do
  kill -0 "$PID" || { echo "process $PID exited during measurement" >&2; exit 1; }
  sleep "$INTERVAL"
done
ELAPSED=$((SECONDS-START))
read -r U1 S1 < <(awk '{print $14, $15}' "/proc/$PID/stat"); W1=$(awk '/write_bytes/ {print $2}' "/proc/$PID/io"); TX1=$(awk -v i="$IFACE" '$1 ~ i":" {print $10}' /proc/net/dev)
UPLOADER1="$UPLOADER0"; [[ -f "$UPLOADER_BYTES_FILE" ]] && UPLOADER1=$(cat "$UPLOADER_BYTES_FILE")
PEAK=$(awk '/VmHWM/ {print $2}' "/proc/$PID/status")
HZ=$(getconf CLK_TCK); CPU=$(awk -v d="$((U1+S1-U0-S0))" -v h="$HZ" -v t="$ELAPSED" 'BEGIN{printf "%.2f",d/h/t*100}')
printf '{"duration_s":%s,"average_cpu_percent_one_core":%s,"peak_memory_mb":%.2f,"disk_write_mb":%.2f,"uploader_body_mb":%.2f,"interface_tx_mb":%.2f}\n' "$ELAPSED" "$CPU" "$(awk -v x="$PEAK" 'BEGIN{print x/1024}')" "$(awk -v x="$((W1-W0))" 'BEGIN{print x/1048576}')" "$(awk -v x="$((UPLOADER1-UPLOADER0))" 'BEGIN{print x/1048576}')" "$(awk -v x="$((TX1-TX0))" 'BEGIN{print x/1048576}')"
