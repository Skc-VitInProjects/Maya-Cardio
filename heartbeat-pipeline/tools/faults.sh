#!/usr/bin/env bash
set -euo pipefail
pipeline_kill(){ sudo pkill -9 -f '[p]ipeline run'; }
network_cut(){ sudo iptables -A OUTPUT -p tcp --dport 443 -j DROP; }
network_restore(){ sudo iptables -D OUTPUT -p tcp --dport 443 -j DROP; }
mock_stop(){ sudo pkill -STOP -f '[b]iosignal-mock'; }
mock_continue(){ sudo pkill -CONT -f '[b]iosignal-mock'; }
mock_restart(){ sudo pkill -TERM -f '[b]iosignal-mock' || true; }
disk_full(){ echo 'Run with PIPELINE_DATA_DIR on a dedicated 20 MB tmpfs; this helper does not mount filesystems.'; }
clock_change(){ echo 'Change the clock only in a disposable test VM.'; }
power_cut(){ echo 'Perform a hard VM reset or physical power cut only on a dedicated test device.'; }
reboot_device(){ sudo reboot; }
case "${1:-}" in
  pipeline-kill) pipeline_kill;;
  network-cut) network_cut;;
  network-restore) network_restore;;
  mock-stop) mock_stop;;
  mock-continue) mock_continue;;
  mock-restart) mock_restart;;
  disk-full) disk_full;;
  clock-change) clock_change;;
  power-cut) power_cut;;
  reboot) reboot_device;;
  *) echo "Usage: $0 {pipeline-kill|network-cut|network-restore|mock-stop|mock-continue|mock-restart|disk-full|clock-change|power-cut|reboot}" >&2; exit 2;;
esac
