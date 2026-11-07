# Deploying AutoClip on Oracle Cloud (Always-Free 24/7 VPS)

Oracle Cloud gives you **4 ARM Ampere Cores + 24 GB RAM + 200 GB SSD** completely free forever. This guide walks you through setting up AutoClip to run 24/7 without keeping your laptop on.

---

## Step 1: Create Your Always-Free Instance in Oracle Cloud

1. Log in to [Oracle Cloud Console](https://cloud.oracle.com/).
2. Under **Quick Actions**, click **Create a VM instance**.
3. **Configure the VM**:
   - **Name**: `autoclip-server`
   - **Image**: Ubuntu 22.04 or 24.04 Minimal/Standard.
   - **Shape**: Click **Change Shape** -> Select **Ampere** (ARM) -> **VM.Standard.A1.Flex**.
     - Set **OCPUs**: 2 or 4 (Free tier allows up to 4).
     - Set **Memory**: 12 GB or 24 GB (Free tier allows up to 24 GB).
   - **Networking**: Keep defaults (assign a public IPv4 address).
   - **SSH Keys**: Click **Save private key** (save the `.key` file on your laptop to connect).
   - Click **Create**.

---

## Step 2: Open Port 8080 in Oracle Cloud Firewall

By default, Oracle blocks incoming traffic. You must allow Port `8080`:

1. On your instance page, click your **Subnet** link (under **Primary VNIC**).
2. Click the **Default Security List for...**.
3. Click **Add Ingress Rules**:
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: `TCP`
   - **Destination Port Range**: `8080`
   - **Description**: `AutoClip Web UI & API`
4. Click **Add Ingress Rules**.

---

## Step 3: Connect to your Server

Open PowerShell or Terminal on your laptop and SSH into your server:

```bash
ssh -i "path/to/your-key.key" ubuntu@<YOUR_PUBLIC_IP>
```

---

## Step 4: Clone AutoClip & Run the 1-Click Setup Script

Once inside your server, run:

```bash
# 1. Clone your repository
git clone <YOUR_GIT_REPO_URL> clipping
cd clipping

# 2. Make setup script executable and run it
chmod +x deploy_vps.sh
./deploy_vps.sh
```

The script will automatically:
- Install Python 3, FFmpeg, Node.js, and build tools.
- Create the virtual environment and install all dependencies.
- Build the optimized production React frontend.
- Open port 8080 in the Ubuntu OS firewall.
- Configure `autoclip.service` as a 24/7 background service managed by `systemd`.

---

## Step 5: Configure `.env` & Start AutoClip

1. Edit your environment file on the server:
   ```bash
   nano config/.env
   ```
   Add your keys (`TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, etc.) and save with `Ctrl+O`, then `Ctrl+X`.

2. Start the 24/7 background service:
   ```bash
   sudo systemctl start autoclip
   ```

3. Check that it's running:
   ```bash
   sudo systemctl status autoclip
   ```

4. View live logs anytime:
   ```bash
   journalctl -u autoclip -f
   ```

---

## Step 6: Access AutoClip from Any Device

Open your browser (on your phone, tablet, or PC):
```
http://<YOUR_PUBLIC_IP>:8080
```

> **Pro Tip (Free HTTPS & Custom Domain without Port 8080):**
> You can install **Cloudflare Tunnel** (`cloudflared`) on this VPS. It gives you free SSL (`https://clips.yourdomain.com`) with zero port exposure.
