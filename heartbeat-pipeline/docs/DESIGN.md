# Design note

## Architecture

One device daemon is the only TCP client of the unmodified mock. It requests both sensors, validates each reply's CRC from the raw `data` substring, checks sample identity and values, detects gaps and compares overlapping samples. Each accepted reply is committed to SQLite in one transaction using WAL and `synchronous=FULL`; the commit is the point at which a sample is called saved. Sample keys are `(session, sensor, index)`. Losses are recorded with their source and reason, including an open-ended loss when the mock's old session end cannot be determined.

An independent heartbeat loop switches the device between online and offline modes. The uploader sends unacknowledged chunks and losses as gzip batches. MongoDB unique indexes and idempotent upserts make retries safe. The cloud processor and the local offline processor use the same `core` code for decoding, statistics and heart rate. Data exports stream as NDJSON. The Express API also serves the static dashboard.

## Guarantees and limits

After a successful SQLite commit, accepted samples are durable subject to the storage device honoring flushes. Retries do not create duplicate chunks. A returned loss range is retained as unavailable; the application never fills a gap with invented values. Indexes, rather than wall-clock timestamps, determine order. The included local tests cover core functions, selected differential heart-rate windows with deterministic gaps, duplicate replies and restart-from-zero behavior.

This is not yet an acceptance-tested deployment. No supplied mock/ground-truth binary, ARM64 board, Atlas database or cloud deployment was available during this review. Therefore the online latency, switching deadline, full outage catch-up, SD-card power-fail behavior, full ground-truth parity and the cloud service's free-tier capacity are not established. `synchronous=FULL` cannot protect against hardware that lies about flush completion. An unknown loss end means the exact number of lost samples is unknown.

Heart-rate missingness currently assumes sensor 1 only, and the code uses JavaScript's centralized `round1()` rule; confirm both plus the output schema against the judge's reference.

## Power-cut loss bound

There is **no finite maximum loss independent of outage duration** in the current system. A reply not yet committed is not saved. The mock retains only its latest 10 seconds per sensor; after a power cut, unread samples can be reread while they remain in that buffer. If the device is unavailable longer than the buffer, the mock discards older unread samples and reports them as a loss. If the mock restarts, the old session end may be unknown and is recorded with `to_index: null`. Thus a restart within the retention period can recover pending samples, but a longer cut can lose the unread interval accumulated during downtime; the exact count depends on the cut duration and mock behavior. The former two-second claim was unsupported and has been removed.

## ARM64 resource figures

**Not measured.** The required one-hour online run has not been performed. Environment, duration, average CPU, peak memory, disk writes and network bytes must be recorded from the constrained ARM64 host using `tools/resource-log.sh`; do not substitute an extrapolation for a measurement.
