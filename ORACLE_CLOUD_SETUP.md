# AutoClip - Oracle Cloud Always-Free Operations & Production Guide

This guide contains everything you need to know about your live Oracle Cloud server, including credentials, SSH access, firewall commands, and service management.

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
* **Web UI Dashboard URL**: `http://137.23.61.124:8080`
* **GitHub Repository**: [https://github.com/Manish6523/clipping](https://github.com/Manish6523/clipping)
* **Server Code Directory**: `/home/ubuntu/apps/clipping`

---

## 2. How to SSH Into Your Server

Whenever you want to log in to your server from your Windows laptop, open **Command Prompt (`cmd`)** or **PowerShell**:

```cmd
cd C:\Users\krish\Downloads\cloud-infra-oracle
ssh -i "ssh-key-2026-11-07.key" ubuntu@137.23.61.124
```

---

## 3. Firewall Rules (Dual-Layer: Cloud + OS)

Oracle Cloud requires two firewall permissions to let traffic through to port 8080:

### Layer A: Oracle Cloud VCN Security List (Already configured)
* **Source CIDR**: `0.0.0.0/0`
* **IP Protocol**: `TCP`
* **Destination Port Range**: `8080`

### Layer B: Ubuntu Internal OS Firewall (Run once on server)
If you ever experience a connection timeout on port 8080, run:
```bash
sudo iptables -I INPUT 1 -p tcp --dport 8080 -j ACCEPT
sudo iptables-save | sudo tee /etc/iptables/rules.v4
```

---

## 4. Virtual Memory (Swap) Configuration

Because the micro shape has 1 GB of physical RAM, a 4 GB virtual swap file ensures that FFmpeg video encoding, faster-whisper transcription, and stream monitoring run without memory crashes:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 5. Daily Management Commands

All operations on the server should be run inside the project folder:
```bash
cd ~/apps/clipping
```

| Action | Command (on server) |
|---|---|
| **View Live Realtime Logs** | `journalctl -u autoclip -f` |
| **Check Service Status** | `sudo systemctl status autoclip` |
| **Restart AutoClip** | `sudo systemctl restart autoclip` |
| **Stop AutoClip** | `sudo systemctl stop autoclip` |
| **Start AutoClip** | `sudo systemctl start autoclip` |
| **Edit Environment / API Keys** | `nano config/.env` |

---

## 6. How to Deploy Future Updates

Whenever you make changes to the code on your laptop and push to GitHub:

```powershell
# On your laptop:
git add .
git commit -m "feat: new updates"
git push origin main
```

Then update your server with:

```bash
# On your Oracle Cloud server:
cd ~/apps/clipping
git pull origin main
cd frontend && npm run build && cd ..
sudo systemctl restart autoclip
```
AutoClip will immediately reload the latest changes without downtime!
