# Heartbeat Pipeline: Workflow Specifications & Mermaid Diagrams

This document details the core runtime workflows, sequence interactions, and state machines governing the **Never Lose a Heartbeat** pipeline.

---

## 1. Collector Ingestion & Raw CRC-32 Validation Sequence

This sequence ensures zero-data-loss ingestion from the single-client `biosignal-mock` with raw CRC verification and atomic SQLite persistence.

```mermaid
sequenceDiagram
    autonumber
    participant Mock as biosignal-mock (TCP 7100)
    participant Collector as collector.js
    participant CRC as core/crc.js
    participant DB as SQLite WAL (store.js)

    Note over Collector: Async Mutex acquired (withMockLock)
    Collector->>DB: Query next_index from cursors for sensor s
    DB-->>Collector: Return current cursor (e.g. 120000)

    loop Up to 3 CRC Retries
        Collector->>Mock: {"cmd":"read","sensor":s,"from_index":120000}
        Mock-->>Collector: Raw JSON Line (with "data":[[...]], "crc32":"...")
        
        Collector->>CRC: extractDataText(rawLine)
        CRC-->>Collector: Exact raw substring "[ [720,1200,...], ... ]"
        
        Collector->>CRC: zlib.crc32(rawSubstring)
        
        alt CRC Matches
            Note over Collector: Reply verified
        else CRC Mismatch
            Note over Collector: Corrupt payload! Wait 100ms and retry
        end
    end

    alt Mock Restart Detected (reply.session_id != current)
        Collector->>DB: Close old sessions, record loss [next_index, null] with reason 'mock_restart_or_power_loss'
        Collector->>Mock: Re-read from index 0 for new session
    end

    Collector->>Collector: Check duplicate & trim samples < next_index
    Collector->>Collector: Check gaps (if reply.first_index > next, record 'unreported_gap')
    Collector->>Collector: Pack fresh samples into signed 24-bit binary (packInt24)

    Note over DB: BEGIN TRANSACTION (fsync)
    Collector->>DB: INSERT OR IGNORE INTO chunks(session, sensor, first_index, payload, crc32)
    Collector->>DB: INSERT OR IGNORE INTO losses (reported mock losses + gaps)
    Collector->>DB: UPDATE cursors SET next_index = new_max, ended = reply.session_end
    Note over DB: COMMIT (synchronous=FULL)

    Note over Collector: Mutex released for next sensor
```

---

## 2. Mode State Machine & Network Transition (FSM)

The device daemon operates an independent heartbeat loop evaluating network reachability against the Render cloud service.

```mermaid
stateDiagram-v2
    [*] --> OFFLINE: Pipeline Boot

    state OFFLINE {
        [*] --> OfflineProcessing
        OfflineProcessing: Local Processor computes ready 1s windows
        OfflineProcessing: Results persisted to SQLite with mode='offline'
        OfflineProcessing: Collector commits to SQLite uninterrupted
    }

    state ONLINE {
        [*] --> OnlineStreaming
        OnlineStreaming: Dual-Lane Uploader active (live + backlog)
        OnlineStreaming: Cloud computes ready 1s windows with mode='online'
        OnlineStreaming: Collector commits to SQLite uninterrupted
    }

    OFFLINE --> Probing: Heartbeat probe tick (every 1000ms)
    Probing --> OFFLINE: Probe failed (timeout 2s / HTTP err)
    Probing --> OnlineCandidate: 1st Successful Probe
    OnlineCandidate --> Probing: 2nd Probe failed
    OnlineCandidate --> ONLINE: 2nd Successful Probe (Hysteresis met, ≤3s)

    ONLINE --> FailingCandidate: 1st Probe failed / timeout
    FailingCandidate --> ONLINE: Probe recovers
    FailingCandidate --> OFFLINE: 2nd Probe failed (Hysteresis met, ≤5s)
```

---

## 3. Dual-Lane Upload & Accounted Synchronization

The uploader simultaneously fulfills real-time streaming (<5s delay) and large backlog catch-up (<15 min for 2-hour outage) without violating MongoDB Atlas rate limits.

```mermaid
sequenceDiagram
    autonumber
    participant SQLite as SQLite Store (Device)
    participant Uploader as uploader.js (Device)
    participant Express as Render API (Cloud)
    participant Mongo as MongoDB Atlas (Cloud)
    participant CloudProc as Cloud Processor

    Note over Uploader: Mode == 'online'
    Uploader->>SQLite: Get accounted ranges from meta key 'accounted:<session>'
    SQLite-->>Uploader: {[0, 120000], ...}

    Uploader->>SQLite: Query unacknowledged chunks
    SQLite-->>Uploader: Chunks list

    Note over Uploader: Partition Chunks into Two Lanes
    Note over Uploader: Lane 1 (Live): Chunks within latest 10s (head - 4000)
    Note over Uploader: Lane 2 (Backlog): Older unacknowledged chunks (≤50 chunks)

    Uploader->>Uploader: Gzip JSON body (base64 packed payloads)
    Uploader->>Express: POST /api/v1/ingest (gzip compressed)

    Note over Express: Authenticate x-api-key
    Express->>Mongo: Idempotent Bulk Upsert chunks ($setOnInsert)
    Express->>Mongo: Idempotent Bulk Upsert losses ($setOnInsert)
    Express->>Express: Merge accounted intervals (accounted.js)
    Express->>Mongo: Update session accounted_ranges

    Express->>CloudProc: Trigger processReadyWindows(session, fromWindow)
    CloudProc->>Mongo: Read contiguous samples & compute ready online windows
    CloudProc->>Mongo: Upsert results with mode='online', received_at, processed_at

    Express-->>Uploader: HTTP 200 OK { accounted: {...}, counts: {...} }

    Uploader->>SQLite: Cache new accounted ranges in meta 'accounted:<session>'
    Uploader->>SQLite: Update total uploader_bytes counter
```

---

## 4. Signal Processing & Sliding Deque Peak Tracking

This workflow executes on both edge and cloud to generate identical 1-second window outputs and ECG heart rate calculations.

```mermaid
flowchart TD
    Start["New Window w Evaluated<br/>(Samples 400w to 400w+399)"] --> CheckAccounted{"Are both sensors<br/>fully accounted?"}
    
    CheckAccounted -- No --> Wait["Skip window until chunks/losses arrive"]
    CheckAccounted -- Yes --> MissingCount["Count missing samples<br/>missing_1, missing_2<br/>complete = (missing_1==0 && missing_2==0)"]

    MissingCount --> StatsCalc["Compute per-channel mean, min, max<br/>Compute Sensor 2 magnitude = mean(√(ch1² + ch2²))"]
    
    StatsCalc --> CheckWindow{"Is window w ≥ 4?"}
    CheckWindow -- No --> NullHR["heart_rate = null<br/>(Insufficient 5s history)"]
    CheckWindow -- Yes --> Check5sMissing{"Any missing samples in<br/>last 5s [400(w-4) .. 400(w+1)-1]?"}
    
    Check5sMissing -- Yes --> NullHR
    Check5sMissing -- No --> ScanPeaks["Scan Sensor 1 Channel 2<br/>from max(0, 400(w-4) - 1600)<br/>using Monotonic Deque"]

    ScanPeaks --> DequeMaintenance["Maintain sliding max of prior 800 samples<br/>via O(n) deque"]
    DequeMaintenance --> PeakCheck{"Sample i is Peak candidate?<br/>1. s[i] > s[i-1] and s[i] > s[i+1]<br/>2. s[i] > 0.5 * max(prior 800)<br/>3. i - lastPeak ≥ 100 samples"}
    
    PeakCheck -- Yes --> AddPeak["Record peak index i"]
    PeakCheck -- No --> NextSample["Advance sample i"]
    AddPeak --> NextSample

    NextSample --> Filter5s["Filter peaks strictly within 5s window<br/>[400(w-4) .. 400(w+1)-1]"]
    Filter5s --> CountPeaks{"Peak count n ≥ 2?"}
    
    CountPeaks -- No --> NullHR
    CountPeaks -- Yes --> CalcBPM["Calculate BPM:<br/>bpm = round1(24000 * (n - 1) / (p_last - p_first))"]

    CalcBPM --> AssembleResult["Assemble Window Result Object<br/>{window, missing_1, missing_2, complete, mean, min, max, magnitude, heart_rate, mode}"]
    NullHR --> AssembleResult
    AssembleResult --> Persist["Persist to database<br/>(SQLite if offline, MongoDB if online)"]
```

---

## 5. Sudden Power Cut & Reboot Recovery Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Power as Electrical Event
    participant Pi as Raspberry Pi Hardware
    participant OS as Linux / systemd
    participant Daemon as pipeline daemon
    participant SQLite as SQLite Storage (WAL)
    participant Mock as biosignal-mock

    Power->>Pi: Sudden Power Cut (unclean shutdown)
    Note over SQLite: SQLite WAL + synchronous=FULL ensures<br/>all previously committed transactions remain intact on disk.
    
    Power->>Pi: Power Restored / Cold Boot
    Pi->>OS: Linux Kernel boots
    OS->>Daemon: systemd starts pipeline.service (WantedBy=multi-user.target)
    
    Daemon->>SQLite: Open DB & execute PRAGMA quick_check
    SQLite-->>Daemon: 'ok'
    Daemon->>Daemon: Verify reserve.bin (8 MB) exists
    
    Daemon->>SQLite: Query unfinished sessions (ended=0)
    SQLite-->>Daemon: Returns last session ID & cursors (next_index)
    
    Daemon->>Mock: Connect TCP & request sensor 1 from next_index
    Mock-->>Daemon: Response header {session_id, first_index, ...}
    
    alt Mock session_id matches existing session
        Note over Daemon: Normal continuation: mock buffer still held unread data!
        Daemon->>SQLite: Commit remaining samples seamlessly
    else Mock session_id differs (Mock was restarted too)
        Note over Daemon: Mock was power-cycled and reset to 0
        Daemon->>SQLite: Mark old session ended=1
        Daemon->>SQLite: Record loss [next_index, null] reason 'mock_restart_or_power_loss'
        Daemon->>Daemon: Initialize new session at index 0
    end
    
    Daemon->>Daemon: Resume regular dual collector loops & mode probe
```

---

## 6. Storage Full (ENOSPC) Emergency Mitigation

```mermaid
flowchart TD
    WriteAttempt["store.saveReply() called"] --> ExecuteSQL["Execute INSERT INTO chunks/losses"]
    ExecuteSQL --> CheckError{"Database error?"}
    
    CheckError -- "Success" --> Done["Transaction committed durably"]
    CheckError -- "Error != SQLITE_FULL" --> ThrowErr["Throw Fatal Error"]
    
    CheckError -- "Error == SQLITE_FULL" --> Emergency["Catch SQLITE_FULL Exception"]
    Emergency --> DeleteReserve["Unlink pre-allocated emergency file:<br/>fs.unlinkSync('reserve.bin')<br/>(Frees 8 MB immediately on disk)"]
    
    DeleteReserve --> PersistLossOnly["Re-execute transaction with dropSamples=true:<br/>1. Drop chunk binary payload<br/>2. INSERT INTO losses (reason: 'disk_full')<br/>3. Advance cursors past the unwritten samples<br/>4. Set meta 'disk_full' = 'true'"]
    
    PersistLossOnly --> LogAlert["Log ERROR to stderr: disk_full_unrecorded / reserve_released"]
    LogAlert --> ReportStatus["pipeline status continues reporting<br/>disk_free_mb and honest losses"]
```
