# Case Study: Never Lose a Heartbeat — Resilient Bedside Biosignal Pipeline

## 1. Executive Summary & Clinical Context

In clinical intensive care and continuous patient monitoring, biosignal data represents life-critical physiological telemetry. A bedside monitor continuously samples high-frequency electrophysiological waveforms—such as electrocardiograms (ECG) and hemodynamic pressure—often for hours or days without human supervision. 

In actual hospital environments, operational conditions are hostile to software:
1. **Unreliable Connectivity**: Hospital Wi-Fi frequently drops without warning due to roaming between access points, RF attenuation, or network maintenance.
2. **Abrupt Power Interruptions**: Plugs are inadvertently kicked or pulled, emergency battery handoffs fail, or devices are abruptly relocated between wards.
3. **Hardware Constraints**: Bedside monitors run on compact, energy-efficient, passively cooled embedded hardware—typically an ARM64 system-on-chip with at most 4 CPU cores and 2 GB of RAM.
4. **Zero Human Supervision**: Nobody sits by the bedside monitor watching the daemon; the pipeline must autonomously recover from fatal faults, power cycling, and upstream sensor stalls without silent data corruption.

The **Never Lose a Heartbeat** pipeline is an industrial-grade, crash-resilient edge-to-cloud data ingestion and processing system. It guarantees that **every received sample is persisted to non-volatile local storage before any network operation**, seamlessly transitions between **online cloud streaming** and **offline edge analytics**, honestly accounts for all signal loss without fabrication, and syncs hours of accumulated backlog to the cloud within minutes of network restoration.

---

## 2. Core Problem & Engineering Requirements

The pipeline ingests two continuous biosensors simulated by `biosignal-mock` at **400 Hz** with signed 24-bit integer values:
* **Sensor 1 (3 channels)**: Represents a 3-lead electrophysiological signal. Channel 2 exhibits a sharp QRS ECG waveform with rhythmic heart rates varying between 60, 90, and 72 BPM.
* **Sensor 2 (2 channels)**: Represents dual-channel baseline physiological measurements (Channel 1 ~400,000, Channel 2 ~150,000).

```
   ┌────────────────────────────────────────────────────────┐
   │ 400 Hz Biosensors (Signed 24-bit, synchronized samples) │
   └───────────────────────────┬────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
     [Sensor 1: 3ch]                       [Sensor 2: 2ch]
     ch1: 0.6 * ECG                        ch1: ~400,000 baseline
     ch2: ECG Waveform                     ch2: ~150,000 baseline
     ch3: 1.3 * ECG
```

### Key Engineering Constraints
* **Device Limits**: ARM64 Raspberry Pi 4 (Quad-core Cortex-A72, $\le 2$ GB RAM).
* **Storage Reliability**: Every sample must survive process termination (`kill -9`), kernel panics, and abrupt power disconnection.
* **Online Mode**: Stream continuously to a cloud API on Render; compute per-second physiological metrics within **5 seconds**.
* **Offline Mode**: If the cloud is unreachable, process data on the Raspberry Pi itself using the **exact same algorithmic logic**.
* **Transition Deadline**: Shift between Online and Offline modes in either direction within **10 seconds** of network changes, with **zero sample loss or duplication**.
* **Catch-Up Synchronization**: Following outages up to 2 hours (~14,400 one-second chunks), restore a complete, deduplicated cloud session within **15 minutes**.
* **Honest Accounting**: Never interpolate or invent missing physiological data. If samples are lost, record exact half-open index ranges with explicit diagnostic root causes.

---

## 3. Foundational Architectural Principles

The solution is architected around five immutable invariants:

### 1. Disk First, Network Second
The collector process writes directly to local SQLite storage before any network or processing layer touches the data. Collection and storage are completely decoupled from network latency, timeouts, and transport errors. Even if the network hangs indefinitely, collection proceeds at full speed.

### 2. Identity by Coordinate Tuple `(session, sensor, index)`
Wall-clock time is completely excluded from sample ordering, windowing, deduplication, and synchronization. In hospital systems, Network Time Protocol (NTP) updates or manual RTC adjustments can cause backwards or forward time jumps. Every sample is strictly identified by `(session_id, sensor_id, sample_index)`.

### 3. Universal Idempotency
All database writes (local SQLite and cloud MongoDB Atlas) utilize unique compound keys and upsert semantics (`$setOnInsert` / `INSERT OR IGNORE`). Retried uploads, duplicated network packets, or re-read mock chunks can never create duplicate samples or corrupt state.

### 4. Continuous Index Accounting
Every sample index $i \ge 0$ is accounted for: it is either physically stored on disk or covered by an explicit loss interval `[from_index, to_index]` with a recorded reason (`buffer_overflow`, `unreported_gap`, `mock_restart_or_power_loss`, `disk_full`).

### 5. Unified Computational Core
Online cloud analytics and offline edge analytics execute the identical pure functions from the `@heartbeat/core` package. There is zero drift between edge-calculated and cloud-calculated physiological metrics.

---

## 4. Edge Layer Engineering (Device Pipeline)

```
   ┌──────────────────────────────────────────────────────────────┐
   │                     DEVICE LAYER (ARM64)                     │
   │                                                              │
   │  ┌─────────────────┐        TCP (NL-JSON)   ┌─────────────┐  │
   │  │ biosignal-mock  │◄───────────────────────┤  Collector  │  │
   │  └─────────────────┘                        └──────┬──────┘  │
   │                                                    │         │
   │                                       Atomic fsync │         │
   │                                                    ▼         │
   │                             ┌─────────────────────────────┐  │
   │                             │  SQLite WAL (synchronous)   │  │
   │                             │  chunks | losses | cursors  │  │
   │                             └──────────┬───────────┬──────┘  │
   │                                        │           │         │
   │                    Offline Computation │           │ Upload  │
   │                                        ▼           ▼         │
   │                             ┌─────────────┐ ┌─────────────┐  │
   │                             │    Local    │ │  Dual-Lane  │  │
   │                             │  Processor  │ │  Uploader   │  │
   │                             └─────────────┘ └─────────────┘  │
   └──────────────────────────────────────────────────────────────┘
```

### 4.1 Mock Ingestion & Mutex Serialization
The provided `biosignal-mock` allows only **one TCP client connection** at a time. The device pipeline spawns two independent loops for Sensor 1 and Sensor 2, synchronized via an asynchronous mutex lock (`withMockLock` in `collector.js`). This ensures requests never interleave or block one another.

### 4.2 Raw-String CRC-32 Validation
The mock protocol provides a CRC-32 checksum calculated over the JSON text of the `data` array exactly as transmitted over TCP:
```
{"session_id":"5f0c2a9e","sensor":1,"first_index":120000,"count":3,"data":[[...],[...]],"crc32":"f9a5bf62"}
```
Parsing this line into a JavaScript object and re-serializing it via `JSON.stringify()` alters whitespace and token formatting, corrupting the checksum. The pipeline implements `extractDataText()` in `core/crc.js`, which scans the raw input line with an $O(n)$ bracket counter to isolate the exact character slice from `[` to `]` of `"data": [...]`, feeding it directly to `zlib.crc32`. Corrupt replies trigger immediate exponential backoff retries (up to 3 attempts).

### 4.3 SQLite WAL & Crash Durability
To achieve true crash and power-cut safety, the local store (`store.js`) configures:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
```
* **WAL (Write-Ahead Logging)** allows continuous local reads (by the uploader and local processor) without locking out collector writes.
* **`synchronous = FULL`** issues an explicit `fsync()` to the underlying storage hardware at every transaction commit, guaranteeing that when `store.saveReply()` completes, the samples are durably written to physical non-volatile media.
* **Payload Compression**: Samples are packed into big-endian signed 24-bit integers (`packInt24`), reducing raw JSON array overhead by over 70% before writing to disk.

### 4.4 Storage Exhaustion Mitigation
When an SD card or eMMC fills up (`SQLITE_FULL`), traditional programs crash and cease logging. The pipeline pre-allocates an **8 MB emergency reserve file** (`reserve.bin`) at startup. Upon receiving an `SQLITE_FULL` error, the pipeline deletes the reserve file, captures the current cursor position, commits an explicit loss record with reason `'disk_full'`, and signals a high-priority diagnostic alert.

---

## 5. Network Autonomy & Dual-Mode State Machine

```
                 Probe Success (x2)
         ┌─────────────────────────────────┐
         │                                 │
         ▼                                 │
   ┌───────────┐                     ┌───────────┐
   │  ONLINE   │                     │  OFFLINE  │
   └───────────┘                     └───────────┘
         │                                 ▲
         │       Probe Failure (x2)        │
         └─────────────────────────────────┘
```

The device daemon operates an independent heartbeat loop (`mode.js`) probing `POST /api/v1/heartbeat` every 1,000 ms:

1. **Hysteresis Switching**:
   * **ONLINE $\rightarrow$ OFFLINE**: Triggered by **2 consecutive heartbeat failures**. Because each probe has a 2-second timeout, the pipeline shifts to OFFLINE mode within 2–5 seconds of an outage (well within the 10-second limit).
   * **OFFLINE $\rightarrow$ ONLINE**: Triggered by **2 consecutive heartbeat successes**. Transitions back to ONLINE mode within 2–3 seconds of connectivity restoration.
2. **Dual-Lane Uploader**:
   To satisfy both the 5-second online latency rule and the 15-minute catch-up deadline without overwhelming the free MongoDB Atlas M0 cluster (~100 ops/sec limit):
   * **Live Lane**: Transmits all unacknowledged chunks within the most recent 10-second sliding window (`index > max_head - 4000`), allowing the cloud to immediately compute real-time heart rate.
   * **Backlog Lane**: Transmits older unacknowledged chunks in batches of up to 50 chunks, throttled to preserve database headroom.
   * **Gzip Payload**: Ingestion payloads are gzipped in memory, reducing network payload sizes by over 80%.

---

## 6. Shared Signal Processing Core

Both edge and cloud compute physiological metrics over non-overlapping **1-second windows** ($w \in \mathbb{N}$ spanning samples $400w$ to $400w + 399$):

```
 Window w: [400w  ──────────────  400w + 399]
 ────────────────────────────────────────────
 Sensor 1: 3 channels (ECG lead)
 Sensor 2: 2 channels (Hemodynamic pressure)
```

### 6.1 Per-Window Metrics
For each window, the pipeline outputs:
* `missing_1`, `missing_2`: Total unavailable samples per sensor in the window.
* `complete`: Boolean flag (`true` strictly when `missing_1 === 0 && missing_2 === 0`).
* `mean`, `min`, `max`: Per-channel arrays over available samples (or `null` if all samples in the window are lost).
* `magnitude`: Vector magnitude $\text{mean}\left(\sqrt{\text{ch}_1^2 + \text{ch}_2^2}\right)$ over available Sensor 2 samples.
* `mode`: `'online'` (computed on Render) or `'offline'` (computed locally on the device).
* Decimals rounded to 1 decimal place (`round1()`).

### 6.2 Heart Rate Detection Algorithm
Heart rate is computed from **Sensor 1, Channel 2** according to strict clinical waveform rules:

```
                  Sample i (Peak Candidate)
                             │
     ◄───── 800 samples ─────┼─ 1 sample ─►
     [ Prior Max Tracking ]  │  [ Neighbour Check ]
                             ▼
              current > before && current > after
              current > 0.5 * max(prior 800)
              i - lastPeak >= 100
```

1. **Peak Candidate Qualification**:
   Sample $i$ is recognized as an R-peak if and only if:
   * The 800 samples prior to $i$ and 1 sample following $i$ are available.
   * $s_i > s_{i-1}$ and $s_i > s_{i+1}$ (strict local prominence).
   * $s_i > 0.5 \times \max(s_{i-800}, \dots, s_{i-1})$. To compute this efficiently in $O(1)$ amortized time without re-scanning 800 items per sample, the core uses an **$O(n)$ monotonic deque**.
   * $i - \text{lastPeak} \ge 100$ samples (refractory lockout of 250 ms, preventing T-wave false triggers).
2. **5-Second Window BPM Calculation**:
   The heart rate for window $w$ evaluates all peaks in the trailing 5-second interval ($400(w - 4)$ to $400(w + 1) - 1$):
   $$\text{BPM} = \frac{60}{\text{mean peak gap in seconds}} = \frac{24000 \times (n - 1)}{p_n - p_1}$$
   Where $n$ is the number of detected peaks and $p_1, p_n$ are the first and last peak sample indices.
3. **Null Availability Guard**:
   `heart_rate` evaluates to `null` if:
   * $w < 4$ (insufficient 5-second history).
   * Any sample in the 5-second window is missing.
   * Fewer than 2 peaks are detected in the interval.

---

## 7. Cloud Architecture & Deployed Service

```
   ┌──────────────────────────────────────────────────────────────┐
   │                     CLOUD LAYER (RENDER)                     │
   │                                                              │
   │  ┌──────────────┐         POST /ingest         ┌──────────┐  │
   │  │   Edge Node  ├─────────────────────────────►│ Express  │  │
   │  │  (Raspberry) │◄─────────────────────────────┤ REST API │  │
   │  └──────────────┘       Accounted Ranges       └────┬─────┘  │
   │                                                     │        │
   │                                    Idempotent write │        │
   │                                                     ▼        │
   │                                            ┌──────────────┐  │
   │                                            │ MongoDB      │  │
   │                                            │ Atlas M0     │  │
   │                                            └──────────────┘  │
   └──────────────────────────────────────────────────────────────┘
```

The cloud service runs on **Render** backed by **MongoDB Atlas M0**:
* **Live Service**: `https://heartbeat-pipeline.onrender.com`
* **Health Check**: `GET /api/v1/health` $\rightarrow$ `{"ok":true}`
* **Collections & Indexes**:
  * `chunks`: Compound unique index on `(session, sensor, first_index)`.
  * `losses`: Compound unique index on `(session, sensor, from_index, reason)`.
  * `results`: Compound unique index on `(session, window, mode)`.
  * `devices`: Heartbeat telemetry and live cursor tracking.
* **Accounted Interval Synchronization**:
  When chunks and losses are ingested, the cloud computes merged half-open intervals (`accounted_ranges`) and returns them in the HTTP response. The device uploader updates its local metadata cache (`accounted:<session>`), acknowledging committed records and pruning them from subsequent upload loops.

---

## 8. Failure Modes & Resilience Verification

| Failure Event | Pipeline Response & Guarantee |
|---|---|
| **Abrupt Power Cut** | SQLite WAL with `synchronous=FULL` guarantees zero corruption of committed transactions. Uncommitted samples held only in RAM are bounded to at most the mock's 10-second buffer retention. Upon reboot, the collector resumes reading from the stored cursor. |
| **Network Disconnection** | The device probe detects 2 consecutive timeouts and switches to OFFLINE mode within 5 seconds. Collection continues uninterrupted. The local processor takes over, calculating window statistics and heart rate locally. |
| **Network Restoration** | The probe registers 2 successes and switches to ONLINE mode within 3 seconds. The dual-lane uploader streams the live head while draining the accumulated backlog in the background. |
| **Process Crash (`SIGKILL`)** | Systemd unit `pipeline.service` restarts the daemon within 1 second (`RestartSec=1`). The daemon reads the database on boot, runs `PRAGMA quick_check`, and resumes from `next_index`. |
| **Mock Server Restart** | The collector detects a change in `session_id`. It marks previous unfinished sessions as closed, logs an open-ended loss record `[next_index, null]` with reason `'mock_restart_or_power_loss'`, and re-initializes tracking at index 0 for the new session. |
| **Corrupt Mock Packet** | Raw CRC-32 extraction detects the checksum mismatch. The corrupt line is discarded, and the collector re-requests the identical index up to 3 times before recording an unread gap. |
| **Storage Exhaustion** | On `SQLITE_FULL`, the 8 MB reserve file is unlinked. The pipeline commits an explicit loss record with reason `'disk_full'`, enters an alert state, and reports remaining disk space in `pipeline status`. |

---

## 9. Conclusion

The **Never Lose a Heartbeat** pipeline demonstrates how clinical systems can achieve bulletproof reliability on modest embedded hardware:
* **Storage-First Safety**: High-frequency telemetry is committed to disk using battle-tested SQLite WAL semantics before any network operations take place.
* **Deterministic Accounting**: The $(session, sensor, index)$ coordinate system ensures zero dependency on unstable system clocks.
* **Seamless Edge/Cloud Parity**: Identical signal processing logic guarantees uninterrupted medical analytics across total network outages.
* **Turnkey Deployment**: With the cloud service active on Render and MongoDB Atlas, the pipeline is fully prepared for immediate validation on physical ARM64 hardware or virtualized testbeds.
