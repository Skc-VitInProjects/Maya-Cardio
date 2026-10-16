#!/usr/bin/env bash
set -euo pipefail
PID="${1:?usage: resource-log.sh PID [interface] [seconds]}"
IFACE="${2:-eth0}"; DURATION="${3:-3600}"; INTERVAL=10
read -r U0 S0 < <(awk '{print $14, $15}' "/proc/$PID/stat"); read -r W0 < <(awk '/write_bytes/ {print $2}' "/proc/$PID/io"); TX0=$(awk -v i="$IFACE" '$1 ~ i":" {print $10}' /proc/net/dev)
START=$(date +%s); PEAK=0; SAMPLES=0
while (( $(date +%s) - START < DURATION )); do HWM=$(awk '/VmHWM/ {print $2}' "/proc/$PID/status"); (( HWM > PEAK )) && PEAK=$HWM; ((SAMPLES+=1)); sleep "$INTERVAL"; done
read -r U1 S1 < <(awk '{print $14, $15}' "/proc/$PID/stat"); W1=$(awk '/write_bytes/ {print $2}' "/proc/$PID/io"); TX1=$(awk -v i="$IFACE" '$1 ~ i":" {print $10}' /proc/net/dev)
HZ=$(getconf CLK_TCK); CPU=$(awk -v d="$((U1+S1-U0-S0))" -v h="$HZ" -v n="$SAMPLES" 'BEGIN{printf "%.2f",d/h/n/10*100}')
printf '{"duration_s":%s,"average_cpu_percent_one_core":%s,"peak_memory_mb":%.2f,"disk_write_mb":%.2f,"interface_tx_mb":%.2f}\n' "$DURATION" "$CPU" "$(awk -v x="$PEAK" 'BEGIN{print x/1024}')" "$(awk -v x="$((W1-W0))" 'BEGIN{print x/1048576}')" "$(awk -v x="$((TX1-TX0))" 'BEGIN{print x/1048576}')"
