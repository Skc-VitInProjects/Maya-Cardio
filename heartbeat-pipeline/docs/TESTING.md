# Acceptance and fault testing

## Local verification completed

The latest local run is recorded in [`evidence/LOCAL_VALIDATION.md`](evidence/LOCAL_VALIDATION.md): 14 Node tests passed, ESLint passed, and Prettier check passed. These ran on Windows x64, not on the ARM64 target. The collector tests use a temporary loopback mock implementation; they do not use the assessment's supplied mock.

## Target acceptance still outstanding

No run against the supplied `biosignal-mock` or `check_ground_truth`, MongoDB Atlas, Render, or a constrained ARM64 Linux device has been performed. The following remain unverified. Save command lines, raw output, environment details and exports under `docs/evidence/` before marking any passed.

| Check                 | Method                                                                                                    | Evidence required                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Ramp integrity        | Run a ramp session; export device and cloud; run `tools/verify-ramp.js` and supplied `check_ground_truth` | Zero value mismatch, exact sample count, no unlisted gaps                                |
| Process kill/recovery | Kill the daemon and let systemd restart it                                                                | Cursor recovery, database check and export comparison                                    |
| Reboot and power cut  | Reboot and hard-reset only a disposable board                                                             | Recovery logs, loss ledger, observed interruption duration and maximum unread loss       |
| Network cut/restore   | Silently drop and restore the cloud connection                                                            | ONLINE/OFFLINE transition times, offline results and cloud backlog reaching zero         |
| Two-hour catch-up     | Seed or record a representative two-hour backlog and time its real drain                                  | Cloud/device export comparison and measured drain time                                   |
| Disk full             | Use a dedicated constrained filesystem in a disposable environment                                        | `disk_full` loss, continued daemon status and no silent advancement                      |
| Clock change          | Change time only in a disposable VM                                                                       | No duplicate or unaccounted sample indices                                               |
| Mock faults           | Use the proxy for corrupt, duplicate, stalled and sensor-2-stall replies; restart the unmodified mock     | CRC retry, no duplicate samples, other sensor progress and old-session unknown-tail loss |
| Cloud restart         | Restart the deployed service                                                                              | Restored database state and resumed backlog processing                                   |
| Resource measurement  | Run online for one hour on the ARM64 host capped at four cores and 2 GB                                   | Host/OS/Node details, actual duration, CPU, peak memory, disk writes and network bytes   |
| Demo video            | Record one run under five minutes showing network cut, process kill and power cut                         | Video file, visible fault actions, recovery/status and brief environment label           |

`tools/faults.sh` contains guarded operator actions but does not automate a safe hard power cut, system clock change, or disk-full mount. Those require a disposable test machine and a human operator. `tools/resource-log.sh` reports uploader request-body bytes and total interface transmit bytes separately; the latter includes unrelated host traffic. Neither figure has been measured on ARM64 yet.

The unrecorded capture sequence is in [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md).
