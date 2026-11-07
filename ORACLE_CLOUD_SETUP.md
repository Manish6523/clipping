# AutoClip - Oracle Cloud Always-Free Setup & Operations Guide

This guide documents what we configured, how your server is set up, and the exact steps to reconnect or run AutoClip in the future.

---

## 1. Cloud Infrastructure Details

* **Cloud Provider**: Oracle Cloud Infrastructure (OCI)
* **Region**: `ap-mumbai-1` (India West - Mumbai)
* **Instance Name**: `instance-20261107-2002`
* **Shape**: `VM.Standard.E2.1.Micro` (AMD Always Free, 100% Free Forever)
* **Operating System**: Canonical Ubuntu 24.04 LTS
* **Public IP**: `137.23.61.124`
* **Private Key Location (Your Laptop)**: `C:\Users\krish\Downloads\cloud-infra-oracle\ssh-key-2026-11-07.key`
* **Virtual Cloud Network**: `autoclip-vcn`
* **Public Subnet**: `public subnet-autoclip-vcn`
* **Firewall Ingress Rule**: TCP Port `8080` open to `0.0.0.0/0` (for Web Dashboard)

---

## 2. How to SSH Into Your Server Next Time

Whenever you want to log in to your server from your Windows laptop, open **Command Prompt (`cmd`)** or **PowerShell** and run:

```cmd
cd C:\Users\krish\Downloads\cloud-infra-oracle
ssh -i "ssh-key-2026-11-07.key" ubuntu@137.23.61.124
```

> **Note on Permissions**:
> Windows SSH key permissions have already been secured using `icacls`, so you can directly run the command above without repeating the permission steps.

---

## 3. Recommended Initial Setup on the Server (First Login)

Run these commands inside your server terminal (`ubuntu@instance-20261107-2002:~$`):

### Step 3.1: Add 4 GB Virtual Swap Memory
Because the AMD micro instance has 1 GB of physical RAM, creating a 4 GB swap space prevents `faster-whisper` and `FFmpeg` from running out of memory:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Step 3.2: Clone AutoClip Code & Run 1-Click Deployment
```bash
# 1. Clone your repository (or copy your code files over)
git clone <YOUR_GIT_REPO_URL> clipping
cd clipping

# 2. Make our automated setup script executable and run it
chmod +x deploy_vps.sh
./deploy_vps.sh
```

The script will:
- Install Python 3.12, `ffmpeg`, Node.js 20, and C/C++ compilation tools.
- Create the Python `venv` and install `requirements.txt`.
- Build the optimized production React frontend.
- Open port 8080 in the Ubuntu Linux firewall (`iptables`).
- Create and register `autoclip.service` as a 24/7 background system daemon.

---

## 4. Daily Management Commands

| Action | Command (on server) |
|---|---|
| **Start AutoClip** | `sudo systemctl start autoclip` |
| **Stop AutoClip** | `sudo systemctl stop autoclip` |
| **Restart AutoClip** | `sudo systemctl restart autoclip` |
| **Check Live Status** | `sudo systemctl status autoclip` |
| **View Live Logs in Realtime** | `journalctl -u autoclip -f` |
| **Edit Environment / API Keys** | `nano config/.env` |

---

## 5. Accessing Your Dashboard

Once the service is started, you can access AutoClip from **any device** (phone, tablet, office PC, etc.):

```
http://137.23.61.124:8080
```
*(Your laptop does NOT need to remain turned on).*
