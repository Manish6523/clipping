import React, { useEffect, useRef, useState } from 'react';
import { VolumeX, Volume2, Music, Upload, Play, Square, ShieldAlert, Type, Wand2 } from 'lucide-react';
import axios from 'axios';

const AUDIO_MODES = [
  { id: 'bleep', label: 'Bleep', hint: 'Classic 1 kHz TV bleep' },
  { id: 'sfx', label: 'Sound FX', hint: 'Play a sound effect over the word' },
  { id: 'mute', label: 'Mute', hint: 'Drop the audio during the word' },
  { id: 'off', label: 'Off', hint: 'Leave audio untouched (captions only)' },
];

const CAPTION_STYLES = [
  { id: 'vowels', example: 'F*CK' },
  { id: 'middle', example: 'F**K' },
  { id: 'first', example: 'F***' },
  { id: 'full', example: '****' },
  { id: 'grawlix', example: '#$@!' },
  { id: 'none', example: 'FUCK' },
];

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start justify-between gap-3 py-2 cursor-pointer select-none">
      <span className="min-w-0">
        <span className="block text-sm text-slate-200">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500 leading-snug">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer ${checked ? 'bg-rose-500' : 'bg-slate-700'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

function WordListInput({ value = [], onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    onChange(Array.from(new Set([...value, ...parts])));
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
        />
        <button type="button" onClick={add} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer shrink-0">
          Add
        </button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onChange(value.filter((x) => x !== w))}
              className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:border-rose-500 hover:text-rose-300 cursor-pointer"
              title="Remove"
            >
              {w} ✕
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CensorSettings({ value, onChange }) {
  const cfg = value || {};
  const set = (patch) => onChange({ ...cfg, ...patch });

  const [sfxList, setSfxList] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState(null);
  const [testText, setTestText] = useState('bro what the fuck was that, holy shit chat clip it');
  const [preview, setPreview] = useState(null);
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const fileRef = useRef(null);

  const loadSfx = async () => {
    try {
      const res = await axios.get('/api/censor/sfx');
      setSfxList(res.data?.sfx || []);
    } catch (e) {
      console.error('Failed to load sound effects', e);
    }
  };

  useEffect(() => { loadSfx(); }, []);

  // Live preview of masking with the current (unsaved) settings
  useEffect(() => {
    if (!value) return undefined;
    const t = setTimeout(async () => {
      try {
        const res = await axios.post('/api/censor/preview', { text: testText, censor: cfg });
        setPreview(res.data);
      } catch {
        setPreview(null);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testText, JSON.stringify(cfg)]);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioCtxRef.current?.close?.();
  }, []);

  const stopAll = () => {
    audioRef.current?.pause();
    setPlaying(null);
  };

  const playSfx = (name) => {
    if (playing === name) { stopAll(); return; }
    stopAll();
    const a = new Audio(`/api/censor/sfx/${encodeURIComponent(name)}`);
    a.volume = Math.min(1, Number(cfg.sfx_volume ?? 0.9));
    a.onended = () => setPlaying(null);
    audioRef.current = a;
    setPlaying(name);
    a.play().catch(() => setPlaying(null));
  };

  const playBleep = () => {
    stopAll();
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = Number(cfg.bleep_frequency || 1000);
      gain.gain.value = Math.min(1, Number(cfg.bleep_volume ?? 0.35));
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } catch (e) {
      console.error('Bleep preview failed', e);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await axios.post('/api/censor/sfx', form);
      await loadSfx();
      if (res.data?.name) set({ sfx_file: res.data.name, audio_mode: 'sfx' });
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.error?.message || err.message));
    } finally {
      setUploading(false);
    }
  };

  if (!value) return null;
  const enabled = cfg.enabled !== false;

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <VolumeX className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-white">Profanity Censor</h2>
            <p className="text-xs text-slate-400 leading-snug">
              Bleeps swear words in the audio, masks them in captions, and cleans titles so Shorts keep full ads.
            </p>
          </div>
        </div>
        <Toggle checked={enabled} onChange={(v) => set({ enabled: v })} label="" />
      </div>

      <div className={`space-y-5 ${enabled ? '' : 'opacity-40 pointer-events-none'}`}>
        {/* Audio mode */}
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5" /> Audio
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {AUDIO_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => set({ audio_mode: m.id })}
                className={`text-left p-2.5 rounded-xl border transition-colors cursor-pointer ${
                  cfg.audio_mode === m.id
                    ? 'bg-rose-500/15 border-rose-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-[10px] text-slate-500 leading-tight mt-0.5">{m.hint}</span>
              </button>
            ))}
          </div>

          {cfg.audio_mode === 'bleep' && (
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <button type="button" onClick={playBleep} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white flex items-center gap-1.5 cursor-pointer">
                <Play className="w-3.5 h-3.5" /> Preview bleep
              </button>
              <label className="flex items-center gap-2 text-xs text-slate-400 flex-1 min-w-[180px]">
                Bleep volume
                <input type="range" min="0.05" max="1" step="0.05" value={cfg.bleep_volume ?? 0.35}
                  onChange={(e) => set({ bleep_volume: Number(e.target.value) })} className="flex-1 accent-rose-500" />
                <span className="font-mono w-8 text-right text-slate-300">{Math.round((cfg.bleep_volume ?? 0.35) * 100)}%</span>
              </label>
            </div>
          )}

          {cfg.audio_mode === 'sfx' && (
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400 flex items-center gap-1.5"><Music className="w-3.5 h-3.5" /> Sound effect</span>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={handleUpload} />
              </div>
              <div className="space-y-1.5">
                {sfxList.length === 0 && <p className="text-xs text-slate-500">No sound effects yet — upload a short clip (under 5 MB).</p>}
                {sfxList.map((s) => (
                  <div key={s.name} className={`flex items-center gap-2 p-2 rounded-lg border ${cfg.sfx_file === s.name ? 'border-rose-500 bg-rose-500/10' : 'border-slate-800'}`}>
                    <button type="button" onClick={() => playSfx(s.name)} className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white cursor-pointer" aria-label={`Play ${s.name}`}>
                      {playing === s.name ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button type="button" onClick={() => set({ sfx_file: s.name })} className="flex-1 min-w-0 text-left cursor-pointer">
                      <span className="block text-sm text-slate-200 truncate">{s.name}</span>
                      <span className="block text-[10px] text-slate-500">{s.kind === 'builtin' ? 'Built-in' : 'Uploaded'} · {Math.max(1, Math.round(s.size / 1024))} KB</span>
                    </button>
                    {cfg.sfx_file === s.name && <span className="text-[10px] font-bold text-rose-300 shrink-0">SELECTED</span>}
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                Volume
                <input type="range" min="0.1" max="1.5" step="0.05" value={cfg.sfx_volume ?? 0.9}
                  onChange={(e) => set({ sfx_volume: Number(e.target.value) })} className="flex-1 accent-rose-500" />
                <span className="font-mono w-10 text-right text-slate-300">{Math.round((cfg.sfx_volume ?? 0.9) * 100)}%</span>
              </label>
            </div>
          )}

          {cfg.audio_mode !== 'off' && (
            <label className="flex items-center gap-2 text-xs text-slate-400 px-1">
              <span className="shrink-0">Original audio during word</span>
              <input type="range" min="0" max="0.5" step="0.01" value={cfg.duck_volume ?? 0.05}
                onChange={(e) => set({ duck_volume: Number(e.target.value) })} className="flex-1 accent-rose-500" />
              <span className="font-mono w-10 text-right text-slate-300">{Math.round((cfg.duck_volume ?? 0.05) * 100)}%</span>
            </label>
          )}
        </section>

        {/* Captions */}
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5" /> Caption masking
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {CAPTION_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => set({ caption_style: s.id })}
                className={`py-2 rounded-xl border font-black text-sm tracking-wide cursor-pointer ${
                  cfg.caption_style === s.id ? 'bg-rose-500/15 border-rose-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
                title={s.id}
              >
                {s.example}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <Toggle checked={cfg.highlight_censored !== false} onChange={(v) => set({ highlight_censored: v })} label="Colour censored words" />
            <input
              type="color"
              value={cfg.censored_color || '#FF3B3B'}
              onChange={(e) => set({ censored_color: e.target.value })}
              className="w-10 h-8 rounded-lg bg-transparent border border-slate-700 cursor-pointer shrink-0"
              aria-label="Censored word colour"
            />
          </div>
        </section>

        {/* Rules */}
        <section className="divide-y divide-slate-800/80">
          <Toggle checked={!!cfg.censor_mild} onChange={(v) => set({ censor_mild: v })}
            label="Also censor mild words" hint="damn, hell, ass, crap, piss…" />
          <Toggle checked={cfg.censor_titles !== false} onChange={(v) => set({ censor_titles: v })}
            label="Clean titles & descriptions" hint="Swears in titles hurt monetisation more than in the video" />
          <Toggle checked={cfg.slur_action !== 'censor'} onChange={(v) => set({ slur_action: v ? 'review' : 'censor' })}
            label="Send clips with slurs to review" hint="Bleeping a slur doesn't fully fix a community-guidelines problem" />
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" /> Always censor
            </h3>
            <WordListInput value={cfg.custom_words || []} onChange={(v) => set({ custom_words: v })} placeholder="e.g. frick, sus" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Never censor</h3>
            <WordListInput value={cfg.allow_words || []} onChange={(v) => set({ allow_words: v })} placeholder="e.g. a streamer's name" />
          </div>
        </div>

        {/* Live tester */}
        <section className="space-y-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Wand2 className="w-3.5 h-3.5" /> Try it
          </h3>
          <input
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500"
          />
          {preview && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1">
                {preview.caption.split(' ').map((w, i) => {
                  const censored = preview.words?.[i]?.censored;
                  return (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 rounded text-sm font-black tracking-wide"
                      style={{ color: censored && cfg.highlight_censored !== false ? (cfg.censored_color || '#FF3B3B') : '#fff', background: 'rgba(0,0,0,0.6)' }}
                    >
                      {w}
                    </span>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500">Title: <span className="text-slate-300">{preview.title}</span></p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
