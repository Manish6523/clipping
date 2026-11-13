import React, { useEffect, useState } from 'react';
import { HardDrive, Bell, Loader2, CheckCircle2, AlertTriangle, Save } from 'lucide-react';
import axios from 'axios';

const gb = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`;

/**
 * Settings → Storage & alerts: how long published clips keep their source footage,
 * disk usage on this server, and a Telegram test for problem alerts.
 */
export default function StorageAlerts() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState('3');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState(null);

  const apply = (d) => {
    setData(d);
    setDays(String(d.source_retention_days));
  };

  useEffect(() => {
    axios.get('/api/settings/maintenance').then((r) => apply(r.data)).catch(() => setData(null));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      apply((await axios.post('/api/settings/maintenance', { source_retention_days: Number(days) })).data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTest({ loading: true });
    try {
      await axios.post('/api/settings/test-alert');
      setTest({ ok: true });
    } catch (err) {
      setTest({ ok: false, error: err.response?.data?.error || err.message });
    }
  };

  const disk = data?.disk;
  const usedPct = disk ? Math.round((disk.used / disk.total) * 100) : 0;
  const dirty = data && Number(days) !== data.source_retention_days;

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
      <div className="flex items-start gap-2">
        <HardDrive className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-white">Storage &amp; alerts</h2>
          <p className="text-xs text-slate-400">Keeps the disk from filling up and tells you on Telegram when something breaks.</p>
        </div>
      </div>

      {disk && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-slate-300">Disk</span>
            <span className={disk.low ? 'text-rose-300 font-semibold' : 'text-slate-400'}>
              {gb(disk.free)} free of {gb(disk.total)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full ${disk.low ? 'bg-rose-500' : usedPct > 75 ? 'bg-amber-400' : 'bg-emerald-500'}`}
              style={{ width: `${usedPct}%` }} />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="retention-days" className="text-xs font-semibold text-slate-300">
          Delete source footage of published clips after
        </label>
        <div className="flex gap-2 items-center">
          <input id="retention-days" type="number" inputMode="decimal" min="0" max="365" step="1"
            value={days} onChange={(e) => setDays(e.target.value)}
            className="w-24 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-base sm:text-sm text-white" />
          <span className="text-xs text-slate-400 flex-1">days (0 = keep forever)</span>
          <button type="button" onClick={save} disabled={saving || !dirty || days === ''}
            className="h-10 px-4 rounded-xl bg-violet-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 leading-snug">
          The finished video, thumbnail and captions are kept; only the raw footage used for trimming and
          template switching is removed.
          {data && ` ${data.published_sources_kept} published clip(s) still have their source.`}
        </p>
      </div>

      <div className="rounded-xl bg-slate-950/60 border border-white/[0.06] p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs text-slate-200">
          <Bell size={14} className="text-amber-300 shrink-0" />
          <span className="flex-1">
            Telegram alerts: blocked downloads, expired cookies, quota used up, failed uploads, low disk.
          </span>
        </div>
        {data && !data.telegram_configured && (
          <p className="text-[11px] text-amber-300">Set TELEGRAM_BOT_TOKEN and ADMIN_CHAT_ID in .env and restart to receive them.</p>
        )}
        <button type="button" onClick={sendTest} disabled={test?.loading}
          className="w-full h-10 rounded-xl bg-white/[0.08] text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40">
          {test?.loading ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />} Send test alert
        </button>
        {test && !test.loading && (
          <p className={`text-xs flex items-start gap-1.5 ${test.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
            {test.ok ? <CheckCircle2 size={14} className="shrink-0 mt-px" /> : <AlertTriangle size={14} className="shrink-0 mt-px" />}
            <span className="break-words">{test.ok ? 'Sent - check Telegram.' : test.error}</span>
          </p>
        )}
      </div>
    </div>
  );
}
