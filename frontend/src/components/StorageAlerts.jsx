import React, { useEffect, useState } from 'react';
import { HardDrive, Bell, CheckCircle2, AlertTriangle, Save } from 'lucide-react';
import axios from 'axios';
import { Panel, Button, Input, Field, Notice, Progress } from './ui';

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
  const [error, setError] = useState('');

  const apply = (d) => {
    setData(d);
    setDays(String(d.source_retention_days));
  };

  useEffect(() => {
    axios.get('/api/settings/maintenance').then((r) => apply(r.data)).catch(() => setData(null));
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      apply((await axios.post('/api/settings/maintenance', { source_retention_days: Number(days) })).data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
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
    <Panel title="Storage & alerts" icon={HardDrive} className="space-y-4">
      <p className="text-xs text-muted -mt-1">Keeps the disk from filling up and tells you on Telegram when something breaks.</p>

      {disk && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted">Disk</span>
            <span className={disk.low ? 'text-bad font-semibold' : 'text-slate-300'}>{gb(disk.free)} free of {gb(disk.total)}</span>
          </div>
          <Progress value={usedPct} tone={disk.low ? 'bad' : usedPct > 75 ? 'warn' : 'good'} className="!h-2" />
        </div>
      )}

      <Field label="Delete source footage of published clips after"
        hint={`The finished video, thumbnail and captions are kept; only the raw footage for trimming and template switching goes.${data ? ` ${data.published_sources_kept} published clip(s) still have theirs.` : ''}`}>
        <div className="flex gap-2 items-center">
          <Input type="number" inputMode="decimal" min="0" max="365" step="1" value={days} onChange={(e) => setDays(e.target.value)} className="!w-24" />
          <span className="text-xs text-muted flex-1">days (0 = keep forever)</span>
          <Button variant="primary" icon={saved ? CheckCircle2 : Save} loading={saving} disabled={!dirty || days === ''} onClick={save}>{saved ? 'Saved' : 'Save'}</Button>
        </div>
      </Field>
      {error && <Notice tone="bad">{error}</Notice>}

      <div className="rounded-xl bg-canvas border border-line p-3 space-y-2.5">
        <p className="flex items-start gap-2 text-xs text-slate-300"><Bell size={14} className="text-warn shrink-0 mt-px" />
          Telegram alerts: blocked downloads, expired cookies, quota used up, failed uploads, low disk.</p>
        {data && !data.telegram_configured && <Notice tone="warn">Set <code className="font-mono">TELEGRAM_BOT_TOKEN</code> and <code className="font-mono">ADMIN_CHAT_ID</code> in .env and restart to receive them.</Notice>}
        <Button block icon={Bell} loading={test?.loading} onClick={sendTest}>Send test alert</Button>
        {test && !test.loading && <Notice tone={test.ok ? 'good' : 'bad'} icon={test.ok ? CheckCircle2 : AlertTriangle}>{test.ok ? 'Sent - check Telegram.' : test.error}</Notice>}
      </div>
    </Panel>
  );
}
