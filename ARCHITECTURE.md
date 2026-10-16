# Heartbeat Pipeline: Architecture Specifications & Mermaid Diagrams

This document outlines the system topology, boundary isolation, and internal components of the **Never Lose a Heartbeat** data pipeline.

---

## 1. System Topology & Physical Boundaries

```mermaid
flowchart TB
    subgraph MockBoundary ["UPSTREAM ENVIRONMENT (Physical Board / VM)"]
        Mock["biosignal-mock<br/>(TCP Port 7100)<br/>400 Hz Synthesizer<br/>10s Circular Buffer"]
    end

    subgraph DeviceBoundary ["DEVICE ENVIRONMENT (ARM64, ≤4 Cores, ≤2 GB RAM)"]
        direction TB
        
        subgraph Ingestion ["Ingestion Subsystem"]
            Collector["Collector Daemon<br/>(withMockLock mutex)<br/>Raw CRC-32 Validation"]
        end

        subgraph LocalStorage ["Storage Subsystem (Durable)"]
            SQLite[("SQLite Database<br/>WAL Mode + synchronous=FULL<br/>chunks · losses · cursors · results")]
            ReserveFile["Emergency Reserve<br/>(reserve.bin, 8 MB)"]
        end

        subgraph ComputeSync ["Computation & Sync Subsystem"]
            LocalProc["Local Processor<br/>(Active during OFFLINE mode)<br/>Window Stats & Heart Rate"]
            ModeFSM["Mode State Machine<br/>(1s Heartbeat Probe)<br/>Hysteresis Transition"]
            Uploader["Dual-Lane Uploader<br/>Lane 1: Live (head - 10s)<br/>Lane 2: Backlog (≤50 chunks/tick)"]
        end

        subgraph OperatorInterface ["CLI Interface"]
            CLI["pipeline CLI<br/>status · export · results · run"]
        end
    end

    subgraph CloudBoundary ["CLOUD ENVIRONMENT (Render Free Tier + MongoDB Atlas)"]
        direction TB
        
        subgraph CloudAPI ["Render Express Web Service"]
            Express["Express REST API<br/>(/api/v1/ingest, /heartbeat, /export)"]
            CloudProc["Cloud Processor<br/>(Active during ONLINE mode)<br/>Window Stats & Heart Rate"]
            Dashboard["Static Web Dashboard<br/>(HTML5 / CSS / Vanilla JS)"]
        end

        subgraph CloudDatabase ["MongoDB Atlas M0 Free Cluster"]
            Mongo[("MongoDB Atlas Database<br/>Unique Compound Indices<br/>chunks · losses · results · sessions")]
        end
    end

    %% Network & IPC Interconnects
    Mock <-- "TCP / Newline-Delimited JSON<br/>(1 client at a time)" --> Collector
    Collector -- "1 Atomic fsync Transaction<br/>per Validated Reply" --> SQLite
    Collector -. "Emergency unlinking<br/>on SQLITE_FULL" .-> ReserveFile

    SQLite <--> LocalProc
    SQLite <--> Uploader
    ModeFSM -- "Monitors Health & Controls Mode" --> SQLite
    CLI <--> SQLite

    ModeFSM -- "POST /api/v1/heartbeat<br/>(1s interval, 2s timeout)" --> Express
    Uploader -- "POST /api/v1/ingest<br/>(gzip Base64 Payloads)" --> Express
    CLI -- "GET /api/v1/sessions/:id/export<br/>(Cloud NDJSON Export)" --> Express

    Express <--> CloudProc
    Express -- "Idempotent Bulk Upsert<br/>($setOnInsert)" --> Mongo
    CloudProc <--> Mongo
    Dashboard <-- "GET /api/v1/sessions/:id/summary" --> Express
```

---

## 2. Component Layering & Separation of Concerns

```mermaid
graph TD
    classDef device fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#fff;
    classDef core fill:#0f172a,stroke:#10b981,stroke-width:2px,color:#fff;
    classDef cloud fill:#312e81,stroke:#8b5cf6,stroke-width:2px,color:#fff;

    subgraph CoreLayer ["SHARED CORE MODULE (@heartbeat/core)"]
        CRC["crc.js<br/>Raw Slice CRC-32"]:::core
        Int24["int24.js<br/>24-bit Packing / Unpacking"]:::core
        Window["window.js<br/>Window Aggregations"]:::core
        Peaks["peaks.js / heartrate.js<br/>Monotonic Deque Peak Finder"]:::core
        Round["round.js<br/>Centralized round1()"]:::core
    end

    subgraph DeviceLayer ["DEVICE SUBSYSTEMS (@heartbeat/device)"]
        Daemon["daemon.js"]:::device
        Col["collector.js"]:::device
        Store["store.js (SQLite)"]:::device
        Mode["mode.js (FSM)"]:::device
        Up["uploader.js"]:::device
        LProc["localProcessor.js"]:::device
        CLIMod["cli.js / status.js / export.js"]:::device
    end

    subgraph CloudLayer ["CLOUD SUBSYSTEMS (@heartbeat/cloud)"]
        Server["server.js (Express)"]:::cloud
        Ingest["ingest.js (Upserts)"]:::cloud
        Accounted["accounted.js (Interval Merging)"]:::cloud
        CProc["processor.js"]:::cloud
        DB["db.js (MongoDB Client)"]:::cloud
    end

    %% Dependencies
    Col --> CRC
    Col --> Int24
    Col --> Store
    Store --> Int24
    LProc --> Window
    LProc --> Peaks
    LProc --> Int24
    Up --> Mode

    Ingest --> Accounted
    CProc --> Window
    CProc --> Peaks
    CProc --> Accounted
    Server --> Ingest
    Server --> CProc
    Server --> DB
```

---

## 3. Data Schema & Persistence Mapping

```mermaid
erDiagram
    %% SQLite Schema
    SESSIONS_SQLITE {
        string id PK
        string first_seen
        int ended
    }
    CURSORS_SQLITE {
        string session PK
        int sensor PK
        int next_index
        int ended
    }
    CHUNKS_SQLITE {
        string session PK
        int sensor PK
        int first_index PK
        int count
        blob payload
        string crc32
    }
    LOSSES_SQLITE {
        string session PK
        int sensor PK
        int from_index PK
        int to_index
        string reason PK
        string source
    }
    RESULTS_SQLITE {
        string session PK
        int window PK
        string mode PK
        string body
    }

    %% MongoDB Atlas Schema
    CHUNKS_MONGO {
        string session PK
        int sensor PK
        int first_index PK
        int count
        binData payload
        string crc32
        date received_at
    }
    LOSSES_MONGO {
        string session PK
        int sensor PK
        int from_index PK
        int to_index
        string reason PK
        date received_at
    }
    RESULTS_MONGO {
        string session PK
        int window PK
        string mode PK
        float heart_rate
        float magnitude
        object mean
        object min
        object max
        date processed_at
    }

    SESSIONS_SQLITE ||--o{ CHUNKS_SQLITE : contains
    SESSIONS_SQLITE ||--o{ LOSSES_SQLITE : tracks
    SESSIONS_SQLITE ||--o{ RESULTS_SQLITE : generates

    CHUNKS_SQLITE ..|> CHUNKS_MONGO : "Idempotent Replicate"
    LOSSES_SQLITE ..|> LOSSES_MONGO : "Idempotent Replicate"
    RESULTS_SQLITE ..|> RESULTS_MONGO : "Consistent Result Format"
```

---

## 4. Failure Isolation & Fault Containment Zones

```mermaid
flowchart LR
    subgraph Zone1 ["Zone 1: Sensor & Collection"]
        MockFaults["Corrupt CRC<br/>Duplicate Reply<br/>Buffer Overflow<br/>Sensor Stall"]
        CollectorRecovery["• 3x Retry on CRC error<br/>• Overlap check & deduplication<br/>• Immediate loss interval logging<br/>• Independent sensor loop"]
        MockFaults --> CollectorRecovery
    end

    subgraph Zone2 ["Zone 2: Device Hardware & OS"]
        OSFaults["Abrupt Power Loss<br/>Process SIGKILL<br/>SD Card Full (ENOSPC)<br/>System Clock Jump"]
        StorageRecovery["• SQLite WAL + fsync on commit<br/>• systemd Restart=always<br/>• 8 MB reserve unlinking & loss record<br/>• Clock-invariant (session,sensor,index)"]
        OSFaults --> StorageRecovery
    end

    subgraph Zone3 ["Zone 3: Hospital Network & WAN"]
        NetFaults["Wi-Fi Signal Drop<br/>Packet Loss / Timeout<br/>Cloud Server Sleep<br/>2-Hour Extended Outage"]
        NetworkRecovery["• 10s Hysteretic FSM to OFFLINE<br/>• Local Processor computes ready windows<br/>• Live lane streams immediately on restore<br/>• Backlog drains in background (≤50/s)"]
        NetFaults --> NetworkRecovery
    end
```
