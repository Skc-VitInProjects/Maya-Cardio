# Design and guarantees

## Architecture

The collector is the only mock client. It requests each sensor independently, checks the CRC against the raw `data` array substring, removes duplicate indices, and commits chunks, cursors, and reported losses to SQLite in a transaction with WAL and `synchronous=FULL`. The device uploader retries idempotent chunk and loss upserts. The cloud uses unique keys on `(session, sensor, first_index)` and `(session, sensor, from_index, reason)`. The same core package supplies integer packing, statistics, peak detection, and rounding to both sides.

The API runs on Express and stores records in MongoDB Atlas. The dashboard is a static page served by Express. Cloud credentials, the ARM64 mock executable, and actual deployment settings are supplied by the operator.

## Guarantees and limits

The collector treats a sample as saved only after its SQLite transaction commits. It does not interpolate gaps. Reported mock losses and detected gaps are retained with their source and reason. Repeated uploads use idempotency keys. Ordering and deduplication use sample indices, never wall-clock time.

The project has not been tested here against the supplied mock or on ARM64. It does not establish that a particular SD card honors fsync, that cloud quotas remain available, or that data the mock discards before delivery can be recovered. Free cloud services may sleep or reject writes at quota limits. The stateless heart-rate scan needs differential validation against the assessment reference, especially for pathological signals and gaps.

## Power loss and measurements

The design target is no more than **2 seconds per sensor**: one reply may be in flight while the mock retains an approximately 10-second unread buffer. Committed replies use `synchronous=FULL`; an uncommitted reply is not counted as saved and must be recovered from the mock or represented as an unknown-tail loss after its session changes. This is a design bound, not a measured result. Replace it with the observed maximum from power-cut evidence.

ARM64 environment: **not measured**. One-hour online run: **not run**. Average CPU: **TBD**. Peak memory: **TBD**. Disk writes: **TBD**. Network sent: **TBD**. Measure on the target ARM64 environment with `tools/resource-log.sh` and retain the raw logs.

## Open assessment assumptions

The brief leaves the time limit, date, mock download location, and unknown-tail export expectations blank. The implementation assumes heart-rate missingness applies to sensor 1 and emits only complete windows. Confirm the reference output schema, tie-rounding rule, mock poll behavior, and treatment of unknown loss endpoints with the assessment contact.
