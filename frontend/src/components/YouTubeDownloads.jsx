import React, { useEffect, useRef, useState } from 'react';
import { Download, Upload, Trash2, CheckCircle2, AlertTriangle, Loader2, Play } from 'lucide-react';
import axios from 'axios';

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
    try {
      const form = new FormData();
      form.append('file', file);
      setStatus((await axios.post('/api/settings/youtube-downloads/cookies', form)).data);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Remove the uploaded YouTube cookies?')) return;
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

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
      <div className="flex items-start gap-2">
        <Download className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-white">YouTube downloads</h2>
          <p className="text-xs text-slate-400">Quick Clip and VOD clipping download from YouTube with yt-dlp on this server.</p>
        </div>
      </div>

      {status && (
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2 text-slate-200">
            {ok(status.js_runtime)}
            JavaScript runtime: <b className="text-white">{status.js_runtime || 'none found'}</b>
            {!status.js_runtime && <span className="text-amber-300">— install Deno or Node.js</span>}
          </div>
          <div className="flex items-center gap-2 text-slate-200">
            {ok(status.challenge_solver_installed)}
            Challenge solver: <b className="text-white">{status.challenge_solver_installed ? 'installed' : 'missing'}</b>
            {!status.challenge_solver_installed && <code className="text-amber-300">pip install -U "yt-dlp[default]"</code>}
          </div>
          <div className="flex items-center gap-2 text-slate-200">
            {ok(true)} yt-dlp <b className="text-white">{status.yt_dlp_version || 'unknown'}</b>
          </div>
          <div className="flex items-center gap-2 text-slate-200">
            {ok(status.cookies?.present)}
            Cookies: <b className="text-white">{status.cookies?.present ? 'uploaded' : 'none'}</b>
            {status.cookies?.present && status.cookies.updated && (
              <span className="text-slate-500">({new Date(status.cookies.updated * 1000).toLocaleDateString()})</span>
            )}
            {status.cookies?.expires && (
              <span className={status.cookies.expires * 1000 < Date.now() + 3 * 86400000 ? 'text-rose-300' : 'text-slate-500'}>
                · expires {new Date(status.cookies.expires * 1000).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl bg-slate-950/60 border border-white/[0.06] p-3 space-y-2">
        <p className="text-[11px] text-slate-400 leading-snug">
          On a VPS, YouTube often blocks downloads ("confirm you're not a bot"). Fix: install a
          <b className="text-slate-200"> "Get cookies.txt LOCALLY"</b> browser extension, open youtube.com while logged in
          (a spare account is safest), export, and upload the file here.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
            className="flex-1 h-10 rounded-xl bg-sky-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload cookies.txt
          </button>
          {status?.cookies?.present && (
            <button type="button" onClick={remove} className="h-10 px-3 rounded-xl bg-white/[0.06] text-rose-300" aria-label="Remove cookies">
              <Trash2 size={14} />
            </button>
          )}
          <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={upload} />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="ytdlp-test" className="text-xs font-semibold text-slate-300">Test a link from this server</label>
        <div className="flex gap-2">
          <input
            id="ytdlp-test"
            type="url"
            inputMode="url"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            placeholder="https://youtu.be/…"
            className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-base sm:text-sm text-white"
          />
          <button type="button" onClick={runTest} disabled={test?.loading || !testUrl.trim()}
            className="px-4 rounded-xl bg-white/[0.08] text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">
            {test?.loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test
          </button>
        </div>
        {test && !test.loading && (
          <p className={`text-xs flex items-start gap-1.5 ${test.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
            {test.ok ? <CheckCircle2 size={14} className="shrink-0 mt-px" /> : <AlertTriangle size={14} className="shrink-0 mt-px" />}
            <span className="break-words">{test.ok ? `Works: "${test.title}"` : test.error}</span>
          </p>
        )}
      </div>
    </div>
  );
}
