# Fresh start on the Oracle Always-Free ARM machine (4 OCPU / 24 GB)

**Why:** the current server is `VM.Standard.E2.1.Micro` - 1 GB RAM, 1 burstable OCPU. Whisper `small`,
live recording for several streamers and the render pipeline don't fit: it thrashes swap, gets OOM-killed,
and one long Quick Clip can block every live moment. The Ampere `VM.Standard.A1.Flex` Always-Free shape gives
up to **4 OCPU, 24 GB RAM and 200 GB block storage** at no cost.

**Approach: clean install, no data copied.** The new server starts with an empty database. You re-enter your keys
and re-create streamers / YouTube connections in the dashboard (about 20 minutes, listed in step 4).
Nothing on the old server is touched until you decide to retire it.

Reference guide for creating the machine: <https://github.com/davidruzicka/oracle-cloud-free-4core-24gb-machine>
(README only, no code).

---

## 0. Decide before you start

| Question | Recommendation |
|---|---|
| Shape split | **One VM: 4 OCPU / 24 GB** - the app is one process, a single big box is simplest |
| Boot volume | **100 GB**. The free tier's 200 GB total *includes* the old Micro's ~47 GB boot volume, so 100 GB leaves headroom while both exist |
| Upgrade to Pay-As-You-Go? | **Yes, recommended.** It is the reliable way to get ARM capacity (people report weeks of "out of host capacity" on the plain free account vs. days on PAYG). Staying inside the Always-Free limits costs $0, and PAYG accounts are not subject to idle-instance reclamation. Needs a card |
| Region / AD | **Same as now** (`ap-mumbai-1`) so the existing VCN, subnet and security-list rules (ports 22 and 80) are reused |
| Old server | Keep it **stopped but not deleted** for a few days as a fallback (see step 7) |

### Free-tier limits to stay inside (so the bill stays $0)
- A1 total across all VMs: **<= 4 OCPU, <= 24 GB RAM**
- Block storage total (all boot + data volumes): **<= 200 GB**
- Outbound data: **10 TB/month** (this app uses a tiny fraction)
- Don't add paid extras (NAT gateway, extra load balancers, ...)
- Add a **budget alert at $1** (Console -> Billing -> Budgets) so any mistake is visible immediately

---

## 1. Upgrade the account and create the VM (you, in the Oracle console)

1. Console -> **Billing & Cost Management -> Upgrade and Manage Payment -> Upgrade to Pay As You Go**.
   Wait until the upgrade is confirmed *before* creating the instance.
2. **Compute -> Instances -> Create instance**
   - Name: `autoclip-arm`
   - Image: **Canonical Ubuntu 24.04** (the aarch64 image is selected automatically for A1)
   - Shape: *Change shape* -> **Ampere -> VM.Standard.A1.Flex** -> OCPU `4`, Memory `24 GB`
   - Networking: existing VCN `autoclip-vcn` + `public subnet-autoclip-vcn`, **assign a public IPv4**
   - SSH keys: *paste public keys* -> paste the contents of your current `ssh-key-2026-11-07.key.pub`
     (same key = nothing new to manage)
   - Boot volume: *specify a custom size* -> **100 GB**
3. **"Out of host capacity"?** Retry later or at a different time of day; capacity frees up in bursts.
4. When it is Running, note the **new public IP** (`NEW_IP`). Ports **22** and **80** are already open on `autoclip-vcn`;
   port 8080 does **not** need to be public (nginx fronts it).

Test the login from your laptop:
```bash
ssh -i ssh-key-2026-11-07.key ubuntu@NEW_IP 'uname -m; nproc; free -g | head -2'
# expect: aarch64, 4, ~23 GB
```

---

## 2. Install on the new VM

```bash
ssh -i KEY ubuntu@NEW_IP
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/Manish6523/clipping.git
cd clipping
chmod +x deploy_vps.sh scripts/*.sh
./deploy_vps.sh        # apt deps, Node, venv, pip, Deno, frontend build, systemd unit (already ARM-aware)
```

`deploy_vps.sh` already supports ARM64 and the Python packages used here (`faster-whisper`/`ctranslate2`,
`opencv-python-headless`, `numpy`, `aiohttp`, ...) publish aarch64 builds. **Verify before going further** - this
is the one real ARM risk:

```bash
source venv/bin/activate
python - <<'PY'
import faster_whisper, cv2, numpy, aiohttp, aiogram, yt_dlp, PIL
print("imports ok:", cv2.__version__, faster_whisper.__version__)
PY
python -m pytest tests -q --ignore=tests/test_quick_clip_pipeline.py --ignore=tests/test_real_video_quick_clip.py
ffmpeg -hide_banner -filters 2>/dev/null | grep -E " subtitles | zoompan "     # libass + zoompan present
deno --version && node --version
```
If an import or test fails, stop and tell me - nothing else has been changed yet.

Then nginx, firewall, swap safety net and big-machine tuning:
```bash
./scripts/bootstrap_arm_vps.sh clip.manish.casa
```
This installs nginx with the same reverse-proxy config as `ORACLE_CLOUD_SETUP.md`, opens port 80 in the OS
firewall, adds a 2 GB safety swap (`swappiness=10`), creates `config/.env` from the example if missing, and sets
(only if not already set):

| Variable | Old (1 GB) | New | Meaning |
|---|---|---|---|
| `WHISPER_CONCURRENCY` | 1 | **2** | transcriptions at the same time |
| `MAX_CONCURRENT_JOBS` | 1 | **2** | render/judge pipelines at the same time |
| `LIVE_WHISPER_MODEL` | base | **small** | live moments get a better model |

---

## 3. Configure and start

```bash
nano config/.env          # fill in the 3 required values
```
| Key | Where to get it |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the same bot as before (@BotFather) |
| `ADMIN_CHAT_ID` | your Telegram chat id (same as before) |
| `GEMINI_API_KEY` | one Gemini key (more can be added in Settings) |

> **Important:** a Telegram bot token can only be polled by **one** server at a time. Stop the old service first,
> otherwise both fight ("Conflict: terminated by other getUpdates") and live watchers/uploads run twice:
> ```bash
> ssh -i KEY ubuntu@137.23.61.124 'sudo systemctl stop autoclip'      # old server
> ```
> (Or give the new server a *new* bot via BotFather and keep the old one running until you're done.)

```bash
sudo systemctl start autoclip
journalctl -u autoclip -f       # expect: "AutoClipDaemon initialized successfully", web server up, bot polling
```
Temporary access before DNS changes: `http://NEW_IP` (nginx) or an SSH tunnel `ssh -L 8080:localhost:8080 ubuntu@NEW_IP`.

---

## 4. Re-create your setup in the dashboard (about 20 minutes)

| Where | What to do |
|---|---|
| **Settings -> Gemini key pool** | add your keys (use *Import* to paste several at once). Keep the pool text you copied from the old server |
| **Settings -> AI models** | Quick Clip `small` (or `medium` - there's RAM for it), live `small`, min virality score 70 |
| **Settings -> YouTube downloads** | upload `cookies.txt` again (datacenter IPs get "confirm you're not a bot"), then *Test a link* |
| **Settings -> Storage & alerts** | retention 3 days (default), **Send test alert** -> arrives in Telegram |
| **Streamers (Channels)** | add each streamer; pick a template and group. Re-assign any template that no longer exists (e.g. `x2twins`) |
| **Templates** | the repo ships the default templates. Your custom ones from the old server (`kai_blured`, `x2twin_template_common`, ...) are optional: copy the 8 small JSON files (68 KB) with `scp -i KEY ubuntu@OLD_IP:~/apps/clipping/templates/*.json ubuntu@NEW_IP:~/apps/clipping/templates/`, or skip and rebuild in Template Studio |
| **Distribution -> Google app** | paste the OAuth client ID + secret again (Google Cloud Console -> Credentials) |
| **Distribution -> Accounts** | *Sign in with YouTube* for each channel (the tokens are not copied), then set slots / daily cap / privacy / approval mode |
| **Distribution -> Mappings** | tick which channel each streamer posts to |

Google OAuth needs **no console change**: the redirect URI is the domain (`https://clip.manish.casa/api/youtube/oauth2callback`),
which stays the same.

**What you start without:** previous clips, queue, published-clip view/retention history (the AI's "what worked" examples
rebuild over a few weeks), and the auto-approve trial statistics. Everything already published stays on YouTube.

---

## 5. Switch the domain

Cloudflare -> DNS -> record **`clip`** -> change the A record to `NEW_IP` (keep "Proxied"; SSL mode stays "Flexible",
nginx listens on port 80 only - same as today). It takes effect within about a minute.

---

## 6. Verify (10 minutes)

| Check | Expected |
|---|---|
| `https://clip.manish.casa` loads | dashboard, no errors |
| Settings -> *Send test alert* | message arrives in Telegram |
| Live Pulse | streamers show live/offline correctly, chat connected, **Whisper "Idle"**, memory ~10-20 % |
| First live hype | moment goes Triggered -> ... -> Clip made / Rejected within minutes (never "waiting" forever) |
| Quick Clip, a short (<= 5 min) video | produces clips; the Review badge increases |
| Distribution | each channel shows "Connected" and a quota meter |
| `free -h`, `uptime` on the new VM | no swap use, load well below 4 |

Run the `youtu.be` link that failed before - with 24 GB it should finish in minutes.

---

## 7. Retire the old server
- **Rollback (anytime in the first days):** `sudo systemctl stop autoclip` on NEW, `sudo systemctl start autoclip` on OLD,
  Cloudflare A record back to the old IP. The old server's data was never modified.
- After a week of good behaviour: **terminate the old Micro** (frees ~47 GB of the 200 GB block-storage budget).
- Optional: update `ORACLE_CLOUD_SETUP.md` (shape, IP, swap step) - I can do this after the move.
- Safety net: a daily database backup on the new VM, e.g. cron:
  ```bash
  mkdir -p ~/backups
  0 4 * * * python3 -c "import sqlite3,datetime as d;s=sqlite3.connect('/home/ubuntu/apps/clipping/data/autoclip.db');o=sqlite3.connect('/home/ubuntu/backups/autoclip-'+d.date.today().isoformat()+'.db');s.backup(o)"
  ```
- Security: the dashboard is public at the domain. `AUTH_LOCK_ENABLED=true` in `config/.env` (PIN via Telegram `/pin`) is worth enabling.

---

## Code follow-ups worth doing regardless of the new machine
These are what made the old server fail so badly and are still sensible on a big one:
1. **Whisper job timeout** - a hung or very long transcription must not hold the slot forever.
2. **Live moments before manual jobs** - priority for the Whisper slot.
3. **Refuse/split very long videos** (e.g. a 2h43m livestream as Quick Clip) with a clear message.
4. **Option to turn off automatic VOD processing** (it downloads streamers' past broadcasts on its own).

## Time estimate
| Phase | Who | Time |
|---|---|---|
| PAYG upgrade + create VM (incl. capacity retries) | you | 10 min - days (capacity) |
| Steps 2-3: install, verify ARM, configure | me + you | 20-30 min |
| Step 4: re-create setup in the dashboard | you | ~20 min |
| Steps 5-6: DNS + verify | me + you | 15 min |
