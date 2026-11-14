import React, { useEffect, useRef, useState } from 'react';
import { Download, Upload, Trash2, CheckCircle2, AlertTriangle, Loader2, Play } from 'lucide-react';
import axios from 'axios';
import { Panel, Button, IconButton, Input, Field, Notice, Pill } from './ui';

/**
 * Settings → YouTube downloads: yt-dlp health on THIS server, cookies.txt upload for
 * datacenter IPs that YouTube blocks, and a one-tap link test with a plain-English reason.
 */
export default function YouTubeDownloads() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testUrl, setTestUrl] = useState('');
  const [test, setTest] = useState(null);
  const fileRef = useRef(null);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = async () => {
    try {
      setStatus((await axios.get('/api/settings/youtube-downloads')).data);
    } catch {
      setStatus(null);
    }
  };
  useEffect(() => { load(); }, []);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      setStatus((await axios.post('/api/settings/youtube-downloads/cookies', form)).data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    setStatus((await axios.delete('/api/settings/youtube-downloads/cookies')).data);
  };

  const runTest = async () => {
    if (!testUrl.trim()) return;
    setTest({ loading: true });
    try {
      const res = await axios.post('/api/settings/youtube-downloads/test', { url: testUrl.trim() }, { timeout: 120000 });
      setTest(res.data);
    } catch (err) {
      setTest({ ok: false, error: err.response?.data?.error || err.message });
    }
  };

  const ok = (v) => (v ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0" /> : <AlertTriangle size={14} className="text-amber-400 shrink-0" />);

  const when = (t) => new Date(t * 1000).toLocaleDateString();
  const soon = status?.cookies?.expires && status.cookies.expires * 1000 < Date.now() + 3 * 86400000;

  return (
    <Panel title="YouTube downloads" icon={Download} className="space-y-4">
      <p className="text-xs text-muted -mt-1">Quick Clip and VOD clipping download from YouTube with yt-dlp on this server.</p>

      {status && (
        <div className="flex flex-wrap gap-1.5">
          <Pill tone={status.js_runtime ? 'good' : 'warn'}>JS runtime: {status.js_runtime || 'none'}</Pill>
          <Pill tone={status.challenge_solver_installed ? 'good' : 'warn'}>Challenge solver {status.challenge_solver_installed ? 'installed' : 'missing'}</Pill>
          <Pill tone="good">yt-dlp {status.yt_dlp_version || '?'}</Pill>
          <Pill tone={status.cookies?.present ? (soon ? 'warn' : 'good') : 'warn'}>
            Cookies: {status.cookies?.present ? 'uploaded' : 'none'}
            {status.cookies?.present && status.cookies.updated ? ` · ${when(status.cookies.updated)}` : ''}
            {status.cookies?.expires ? ` · expires ${when(status.cookies.expires)}` : ''}
          </Pill>
        </div>
      )}
      {status && !status.js_runtime && <Notice tone="warn" icon={AlertTriangle}>Install Deno or Node.js on the server.</Notice>}
      {status && !status.challenge_solver_installed && <Notice tone="warn" icon={AlertTriangle}>Run <code className="font-mono">pip install -U "yt-dlp[default]"</code></Notice>}

      <div className="rounded-xl bg-canvas border border-line p-3 space-y-2.5">
        <p className="text-[11.5px] text-muted leading-relaxed">
          On a VPS, YouTube often blocks downloads ("confirm you're not a bot"). Install the <b className="text-slate-300">Get cookies.txt LOCALLY</b> browser extension,
          open youtube.com while logged in (a spare account is safest), export, and upload the file here.
        </p>
        <div className="flex gap-2">
          <Button block variant="primary" icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}>Upload cookies.txt</Button>
          {status?.cookies?.present && <IconButton icon={Trash2} label="Remove cookies" variant="secondary" onClick={() => setConfirmRemove(true)} className="hover:!text-bad" />}
          <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={upload} />
        </div>
        {confirmRemove && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-bad">Remove the uploaded cookies?</span>
            <Button size="sm" variant="danger" onClick={remove}>Remove</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          </div>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
      </div>

      <Field label="Test a link from this server">
        <div className="flex gap-2">
          <Input type="url" inputMode="url" value={testUrl} onChange={(e) => setTestUrl(e.target.value)} placeholder="https://youtu.be/…" className="flex-1 min-w-0" />
          <Button icon={Play} loading={test?.loading} disabled={!testUrl.trim()} onClick={runTest}>Test</Button>
        </div>
      </Field>
      {test && !test.loading && (
        <Notice tone={test.ok ? 'good' : 'bad'} icon={test.ok ? CheckCircle2 : AlertTriangle}>{test.ok ? `Works: "${test.title}"` : test.error}</Notice>
      )}
    </Panel>
  );
}
