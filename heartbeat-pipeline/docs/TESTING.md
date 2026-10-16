# Acceptance and fault testing

No external acceptance test has been run in this workspace. The system has not been exercised against the supplied mock, MongoDB Atlas, Render, or a constrained ARM64 Linux device. Populate `docs/evidence/` with the command, environment, logs, and ground-truth output before claiming any row passed.

| Fault or check | Method | Expected evidence |
|---|---|---|
| Ramp integrity | Run mock in ramp mode, export device and cloud, pipe each to `tools/verify-ramp.js` and the supplied `check_ground_truth` | Zero value mismatch and no unlisted gaps |
| Pipeline kill | Kill the daemon and allow systemd to restart it | Resume cursor and export comparison |
| Reboot or power cut | Reboot and hard-reset only a disposable test device | Database quick check, loss tail and measured maximum loss |
| Network loss and restore | Use a silent DROP rule, then remove it | Monotonic mode-change logs, continued offline processing, cloud backlog completion |
| Two-hour outage | Seed a representative backlog and time its drain against the real cloud | Clearly labeled seeded drain time and complete cloud export |
| Disk full | Dedicated small tmpfs in a disposable environment | `disk_full` record and daemon status |
| Clock change | Change time in a disposable VM | No duplicate or unaccounted indices |
| Mock restart and stall | Restart or pause the unmodified mock; proxy corrupt and duplicate replies | Unknown-tail loss as appropriate, CRC rejection, retries, and idempotent export |
| Cloud restart | Restart deployed service | Mode transition and recovered backlog |
| Resource run | Run for one hour online on the limited ARM64 host | Average CPU, peak RSS, disk writes, network bytes and environment |

`tools/faults.sh` has operator functions for selected fault injections. It intentionally does not mount filesystems or change the clock without a human operating a dedicated test host. The current automated scripts are scaffolding and do not replace this evidence matrix.
