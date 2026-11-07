# AutoClip - Complete Deployment & Operations Manual (With & Without Domain)

This comprehensive guide explains how to host AutoClip on Oracle Cloud Always-Free VPS for life, covering both deployment paths:
1. **Method A: Direct Public IP (Without a Domain)** — e.g. `http://137.23.61.124:8080`
2. **Method B: Custom Domain + Free HTTPS (With Cloudflare)** — e.g. `https://clip.manish.casa`

---

## 1. Cloud Infrastructure & Current Server Details

* **Cloud Provider**: Oracle Cloud Infrastructure (OCI)
* **Region**: `ap-mumbai-1` (India West - Mumbai)
* **Instance Name**: `instance-20261107-2002`
* **Shape**: `VM.Standard.E2.1.Micro` (AMD Always Free, \$0.00 Forever)
* **Operating System**: Canonical Ubuntu 24.04 LTS
* **Public IP**: `137.23.61.124`
* **Private Key Path (Laptop)**: `C:\Users\krish\Downloads\cloud-infra-oracle\ssh-key-2026-11-07.key`
* **Virtual Cloud Network**: `autoclip-vcn`
* **Subnet**: `public subnet-autoclip-vcn`
* **Server App Path**: `/home/ubuntu/apps/clipping`
* **GitHub Repository**: [https://github.com/Manish6523/clipping](https://github.com/Manish6523/clipping)

---

## 2. Connecting to the Server via SSH

From **Command Prompt (`cmd`)** or **PowerShell** on your laptop:

```cmd
cd C:\Users\krish\Downloads\cloud-infra-oracle
ssh -i "ssh-key-2026-11-07.key" ubuntu@137.23.61.124
```

> **If Windows ever gives a "Permissions are too open" error:**
> ```cmd
> icacls.exe "ssh-key-2026-11-07.key" /reset
> icacls.exe "ssh-key-2026-11-07.key" /grant:r "%USERNAME%":(R)
> icacls.exe "ssh-key-2026-11-07.key" /inheritance:r
> ```

---

## 3. Base Server Setup (Run Once on any fresh VPS)

### Step 3.1: Add 4 GB Virtual Swap Memory
*(Crucial on 1 GB RAM micro instances so FFmpeg and Whisper never run out of memory):*
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Step 3.2: Clone Project into `~/apps/`
```bash
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/Manish6523/clipping.git
cd clipping
chmod +x deploy_vps.sh
./deploy_vps.sh
```

### Step 3.3: Configure `.env` and Start
```bash
nano config/.env
# Paste GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, etc., then Ctrl+O, Enter, Ctrl+X
sudo systemctl start autoclip
```

---

## 4. Hosting PATH A: Without a Domain (Direct IP Access)

Use this method when you don't own a domain name and want to access the dashboard directly via IP address.

### Step A.1: Allow Port 8080 in Oracle Cloud Console
1. Go to **Networking** $\rightarrow$ **Virtual Cloud Networks** $\rightarrow$ Click **`autoclip-vcn`**.
2. Click **Security Lists** $\rightarrow$ **`Default Security List for autoclip-vcn`**.
3. Click **Add Ingress Rules**:
   * **Source CIDR**: `0.0.0.0/0`
   * **IP Protocol**: `TCP`
   * **Destination Port Range**: `8080`
   * **Description**: `AutoClip Direct IP`
4. Click **Add Ingress Rules**.

### Step A.2: Allow Port 8080 in Ubuntu Internal OS Firewall (`iptables`)
On the server terminal, run:
```bash
sudo iptables -I INPUT 1 -p tcp --dport 8080 -j ACCEPT
sudo iptables-save | sudo tee /etc/iptables/rules.v4
```

### Step A.3: Access the App
Open your browser on any phone or PC:
```
http://<YOUR_SERVER_PUBLIC_IP>:8080
# Example: http://137.23.61.124:8080
```

> **Note on YouTube OAuth**: Google blocks raw IP addresses for OAuth redirects. If using Method A without a domain, download your channel credentials JSON file and upload it manually via the **Import JSON** button in the Accounts tab.

---

## 5. Hosting PATH B: With a Domain + Free SSL (Cloudflare + Nginx)

Use this method for clean URLs (`https://clip.yourdomain.com`), free SSL encryption, and full Google OAuth "Sign in with YouTube" support.

### Step B.1: Add DNS Record in Cloudflare
1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/) $\rightarrow$ Click your domain (e.g. `manish.casa`).
2. Go to **DNS** $\rightarrow$ **Records** $\rightarrow$ **Add record**:
   * **Type**: `A`
   * **Name**: `clip` (or your chosen subdomain)
   * **IPv4 address**: `<YOUR_SERVER_PUBLIC_IP>` (e.g. `137.23.61.124`)
   * **Proxy status**: **Proxied (Orange cloud)**
   * **TTL**: `Auto`
3. Save the record.

### Step B.2: Set Cloudflare SSL Mode to "Flexible"
In Cloudflare:
1. Navigate to **SSL/TLS** on the left menu.
2. Select **Flexible**.
   *(Cloudflare automatically secures the browser-to-server connection with HTTPS!)*

### Step B.3: Allow Port 80 in Oracle Cloud Security List
1. In Oracle Cloud Console $\rightarrow$ **`Default Security List for autoclip-vcn`**.
2. Click **Add Ingress Rules**:
   * **Source CIDR**: `0.0.0.0/0`
   * **IP Protocol**: `TCP`
   * **Destination Port Range**: `80`
   * **Description**: `HTTP for Cloudflare & Nginx`
3. Save the rule.

### Step B.4: Configure Nginx Reverse Proxy on the Server
In your server SSH terminal, run:

```bash
# 1. Install Nginx
sudo apt update && sudo apt install -y nginx

# 2. Allow Port 80 in OS firewall
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo iptables-save | sudo tee /etc/iptables/rules.v4

# 3. Create Nginx site config (Replace clip.manish.casa with your domain if different)
sudo tee /etc/nginx/sites-available/clip.manish.casa > /dev/null << 'EOF'
server {
    listen 80;
    server_name clip.manish.casa;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        client_max_body_size 500M;
    }
}
EOF

# 4. Activate site and restart Nginx
sudo ln -sf /etc/nginx/sites-available/clip.manish.casa /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

### Step B.5: Update Google Cloud Console (YouTube OAuth)
In [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials):
* **Authorized JavaScript origins**:
  ```text
  https://clip.manish.casa
  ```
* **Authorized redirect URIs**:
  ```text
  https://clip.manish.casa/api/youtube/oauth2callback
  http://localhost:8080/api/youtube/oauth2callback
  ```

### Step B.6: Access the App
Open:
```
https://clip.manish.casa
```

---

## 6. Daily Management & Service Commands

All commands are run inside `~/apps/clipping`:

```bash
cd ~/apps/clipping
```

| Action | Command |
|---|---|
| **View Live Realtime Logs** | `journalctl -u autoclip -f` |
| **Check Background Status** | `sudo systemctl status autoclip` |
| **Restart AutoClip** | `sudo systemctl restart autoclip` |
| **Stop AutoClip** | `sudo systemctl stop autoclip` |
| **Start AutoClip** | `sudo systemctl start autoclip` |
| **Restart Nginx (Domain only)** | `sudo systemctl restart nginx` |
| **Edit Environment / API Keys** | `nano config/.env` |

---

## 7. How to Push Updates From Laptop to Cloud

Whenever you make code updates on your local laptop:

```powershell
# On your laptop:
git add .
git commit -m "feat: updated clip editor"
git push origin main
```

Then pull the updates on your cloud server:

```bash
# On your Oracle Cloud server:
cd ~/apps/clipping
git pull origin main
cd frontend && npm run build && cd ..
sudo systemctl restart autoclip
```
AutoClip will instantly reload and serve your latest code!
