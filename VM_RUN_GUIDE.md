# Step-by-Step Guide: Running Heartbeat Pipeline on a Virtual Machine

This guide walks you through running the device pipeline on a Linux Virtual Machine (ARM64 or x86_64) connected to your live deployment on Render (`https://heartbeat-pipeline.onrender.com`).

---

## 1. Preparing the Virtual Machine Environment

The assessment specifies a **Raspberry Pi-class environment (at most 4 CPU cores and 2 GB RAM)**. You can use any of the following:

| Virtualization Platform | Recommended Image | Resource Limits to Set |
|---|---|---|
| **Multipass (Ubuntu)** | Ubuntu 24.04 LTS (ARM64 or x64) | `multipass launch -c 4 -m 2G -d 10G -n heartbeat-vm` |
| **QEMU / UTM (Mac/Linux/Win)** | Raspberry Pi OS 64-bit or Debian ARM64 | 4 Cores, 2048 MB RAM |
| **VirtualBox / VMware** | Debian 12 64-bit or Ubuntu Server | 4 vCPUs, 2048 MB RAM |
| **Cloud ARM64 Free Instance** | Oracle Cloud Free Tier (Ampere) / AWS t4g.small | 2–4 OCPUs, 2 GB RAM |

---

## 2. Install Prerequisites on the VM

Open a terminal inside your VM and execute:

```bash
# 1. Update package lists and install system tools
sudo apt-get update
sudo apt-get install -y curl git build-essential python3 xz-utils

# 2. Install Node.js 22 LTS (Official ARM64 or x64 build)
# For ARM64:
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ]; then
  NODE_PKG="node-v22.23.0-linux-arm64"
else
  NODE_PKG="node-v22.23.0-linux-x64"
fi

cd /tmp
curl -fsSLO "https://nodejs.org/dist/v22.23.0/${NODE_PKG}.tar.xz"
sudo tar -xJf "${NODE_PKG}.tar.xz" -C /usr/local --strip-components=1

# Verify Node.js version (must be >= 22.0.0)
node --version
npm --version
```

---

## 3. Clone and Setup the Project on the VM

```bash
# 1. Clone your repository
sudo git clone https://github.com/Skc-VitInProjects/Maya-Cardio.git /opt/maya-cardio
sudo chown -R "$USER:$USER" /opt/maya-cardio
cd /opt/maya-cardio/heartbeat-pipeline

# 2. Install dependencies
npm ci

# 3. Run deploy installer script (sets up systemd service and /usr/local/bin/pipeline symlink)
sudo bash ./deploy/install.sh
```

---

## 4. Configure the Pipeline Environment

Edit the environment file on the VM:

```bash
sudo nano /etc/heartbeat-pipeline/pipeline.env
```

Ensure the configuration points to your deployed Render URL and credentials:

```ini
# Mock Service Configuration
PIPELINE_MOCK_HOST=127.0.0.1
PIPELINE_MOCK_PORT=7100

# Live Cloud Deployment (Render)
PIPELINE_CLOUD_URL=https://heartbeat-pipeline.onrender.com
PIPELINE_API_KEY=64abaf926b9aef2b52805759a7a359e32f9c3c2a51e2ca46e8b463998afa1396

# Local Storage
PIPELINE_DATA_DIR=/var/lib/heartbeat-pipeline
PIPELINE_POLL_MS=500
PIPELINE_DEVICE_ID=bedside-vm-01
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

## 5. Launch the Mock Service

You need the mock service generating samples on port 7100. 

### Option A: Using the Provided Node.js Mock Emulator
If you do not have the proprietary binary on your VM yet, run the built-in emulator:
```bash
# In Terminal 1 (Run in background or tmux):
cd /opt/maya-cardio/heartbeat-pipeline
node tools/mock-emulator.js --mode signal --seed 7 --duration 3600 --port 7100
```

### Option B: Using the MayaCardio `biosignal-mock` Binary
```bash
sudo chmod +x /usr/bin/biosignal-mock
/usr/bin/biosignal-mock --mode signal --seed 7 --duration 3600 --port 7100
```

---

## 6. Run the Pipeline Daemon

### Running via systemd (Production Service)
```bash
# Start and enable the service
sudo systemctl start pipeline.service
sudo systemctl status pipeline.service

# View live system logs
journalctl -u pipeline.service -f
```

### Alternatively, Run Interactively in the Foreground
For debugging and immediate feedback:
```bash
cd /opt/maya-cardio/heartbeat-pipeline
node device/src/cli.js run
```

---

## 7. Verify Operation with Required CLI Commands

Open another terminal on the VM and test the required pipeline commands:

### 1. Check Status
```bash
pipeline status
```
**Expected Output (single JSON line):**
```json
{"mode":"online","session":"5f0c2a9e","saved":{"1":4800,"2":4800},"in_cloud":{"1":4800,"2":4800},"backlog":{"1":0,"2":0},"lost":{"1":0,"2":0},"disk_free_mb":18450.2,"cloud_known_at":"2026-10-16T11:20:00.000Z"}
```

### 2. View Computed Results (Online and Offline)
```bash
# Replace SESSION_ID with the session shown in pipeline status
pipeline results --session SESSION_ID
```
Outputs one JSON line per second window containing `missing_1`, `missing_2`, `complete`, channel statistics, `magnitude`, and computed `heart_rate` (BPM).

### 3. Export Data from Device
```bash
pipeline export --session SESSION_ID --from device
```

### 4. Export Data from Cloud
```bash
pipeline export --session SESSION_ID --from cloud
```

---

## 8. Performing Failure Injection Tests on the VM

Use `tools/faults.sh` to trigger assessment failure tests:

### 1. Network Outage & Catch-Up Test
```bash
# Cut network connection to the cloud
sudo bash /opt/maya-cardio/heartbeat-pipeline/tools/faults.sh network-cut

# Check pipeline status (switches to OFFLINE within 5s, backlog increases)
pipeline status

# Restore network
sudo bash /opt/maya-cardio/heartbeat-pipeline/tools/faults.sh network-restore

# Watch the pipeline return to ONLINE and the backlog drain to 0
pipeline status
```

### 2. Process Crash Test
```bash
# Kill daemon process with SIGKILL
sudo bash /opt/maya-cardio/heartbeat-pipeline/tools/faults.sh pipeline-kill

# Verify systemd automatically restarts it within 1 second
sudo systemctl status pipeline.service
pipeline status
```

### 3. Open the Cloud Dashboard
Open the deployed dashboard in your browser:
👉 [https://heartbeat-pipeline.onrender.com/](https://heartbeat-pipeline.onrender.com/)

You will see your VM session streaming live, showing mode shifts, sample counts, backlog drain, heart rate graphs, and loss records in real time!
