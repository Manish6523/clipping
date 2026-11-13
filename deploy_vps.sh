#!/bin/bash
set -e

# ==============================================================================
# AutoClip Engine - Complete Oracle Cloud Always-Free Setup Script
# Works on Ubuntu 22.04 LTS / 24.04 LTS (x86_64 or ARM64 Ampere A1)
# ==============================================================================

echo "=========================================================="
echo " Starting AutoClip Cloud Setup on Oracle Linux / Ubuntu   "
echo "=========================================================="

# 1. Update system & install required build tools, FFmpeg and Node.js
echo "[1/6] Updating packages & installing system dependencies..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y git ffmpeg python3-pip python3-venv python3-dev build-essential curl libgl1 libglib2.0-0

# Install Node.js 20 LTS (if not present)
if ! command -v node &> /dev/null; then
    echo "[1.1/6] Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# 2. Setup Python Virtual Environment
echo "[2/6] Setting up Python virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate

# Upgrade pip & install Python dependencies
echo "[3/6] Installing Python dependencies (requirements.txt)..."
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt

# YouTube downloads: yt-dlp must stay current (YouTube changes break old versions) and needs a
# JavaScript runtime for YouTube's player challenges. Deno is yt-dlp's default; Node.js also works.
pip install -U "yt-dlp[default]"
if ! command -v deno &> /dev/null; then
    echo "[3.1/6] Installing Deno (JavaScript runtime for yt-dlp)..."
    curl -fsSL https://deno.land/install.sh | sudo DENO_INSTALL=/usr/local sh -s -- -y || \
        echo "Deno install failed - yt-dlp will fall back to Node.js"
fi

# 3. Build React Frontend
echo "[4/6] Building Production React Frontend..."
cd frontend
npm install --legacy-peer-deps
npm run build
cd ..

# 4. Configure Firewall (Oracle Cloud Ubuntu IPTables)
echo "[5/6] Opening Port 8080 on OS Firewall..."
if command -v ufw &> /dev/null; then
    sudo ufw allow 8080/tcp || true
fi
# Oracle Cloud Ubuntu images use iptables by default:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8080 -j ACCEPT || true
sudo netfilter-persistent save || true

# 5. Create Systemd 24/7 Background Service
echo "[6/6] Configuring systemd background service (autoclip.service)..."
CURRENT_DIR=$(pwd)
CURRENT_USER=$(whoami)

sudo tee /etc/systemd/system/autoclip.service > /dev/null <<EOF
[Unit]
Description=AutoClip Autonomous Engine & Web Dashboard
After=network.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${CURRENT_DIR}
Environment="PATH=${CURRENT_DIR}/venv/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=${CURRENT_DIR}/venv/bin/python main.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Reload and enable service
sudo systemctl daemon-reload
sudo systemctl enable autoclip.service

echo "=========================================================="
echo " Setup complete!"
echo ""
echo "Next Steps:"
echo "1. Verify/edit your environment variables:"
echo "   nano config/.env"
echo ""
echo "2. Start your 24/7 background service:"
echo "   sudo systemctl start autoclip"
echo ""
echo "3. Check live status & logs:"
echo "   sudo systemctl status autoclip"
echo "   journalctl -u autoclip -f"
echo ""
echo "4. In Oracle Cloud Console, make sure to add an Ingress Rule"
echo "   for TCP Port 8080 in your Virtual Cloud Network (VCN) Security List."
echo "=========================================================="

