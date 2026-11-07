# AutoClip - Oracle Cloud Always-Free Operations & Production Guide

This guide contains everything you need to know about your live Oracle Cloud server, including credentials, SSH access, firewall commands, domain setup, and service management.

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
* **Production HTTPS Domain**: [https://clip.manish.casa](https://clip.manish.casa)
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

## 3. Production Architecture

```
Internet (Phone / Laptop)
           │
           ▼
Cloudflare Edge (SSL / Flexible HTTPS)
           │ (Port 80)
           ▼
Oracle Cloud VPS (137.23.61.124)
           │
           ▼
Nginx Reverse Proxy (/etc/nginx/sites-available/clip.manish.casa)
           │ (Port 8080)
           ▼
AutoClip Daemon & Web UI (systemd: autoclip.service)
```

---

## 4. Google OAuth App Configuration

In **[Google Cloud Console](https://console.cloud.google.com/apis/credentials)**:
* **Authorized JavaScript origins**:
  ```text
  https://clip.manish.casa
  ```
* **Authorized redirect URIs**:
  ```text
  https://clip.manish.casa/api/youtube/oauth2callback
  http://localhost:8080/api/youtube/oauth2callback
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
| **Restart Nginx** | `sudo systemctl restart nginx` |

---

## 6. How to Deploy Future Code Updates

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
