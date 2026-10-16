# Five-minute demo recording plan

Record this on the target or a disposable ARM64 VM after the acceptance tests are available. Keep the device status, systemd output and fault action visible; label the host and synthetic data. Do not present this plan as a completed demo.

| Time      | Show                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:25 | ARM64 environment and the mock/pipeline running; show the session ID and `pipeline status`.                                                               |
| 0:25–1:15 | Drop network with `bash tools/faults.sh network-cut`; show OFFLINE mode, continuing sample counts and offline results.                                    |
| 1:15–1:45 | Restore network; show ONLINE mode and backlog decreasing.                                                                                                 |
| 1:45–2:30 | Kill the service with `bash tools/faults.sh pipeline-kill`; show systemd restarting it and the same session/cursor resuming.                              |
| 2:30–4:15 | On a disposable VM, hard power-off in the hypervisor UI, power it on, then show SQLite recovery and any unknown-tail loss. Keep the cut duration visible. |
| 4:15–5:00 | Show the device/cloud export comparison, latest results, and one brief statement of measured limits.                                                      |

Network and process-kill steps are not a substitute for the hard power-off. Do not run the power cut on a production device or valuable storage.
