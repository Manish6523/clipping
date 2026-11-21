import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Key,
  Cpu,
  Sliders,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Zap,
  Copy,
  Upload,
  Check,
  HardDrive,
  Download,
  VolumeX,
  Sparkles,
  Server,
  Layers,
  ArrowRight,
  BookOpen,
} from 'lucide-react';
import axios from 'axios';
import CensorSettings from './CensorSettings';
import StorageAlerts from './StorageAlerts';
import YouTubeDownloads from './YouTubeDownloads';
import {
  Page,
  Panel,
  Button,
  IconButton,
  Input,
  Select,
  Textarea,
  Field,
  Pill,
  Badge,
  Sheet,
  EmptyState,
  Notice,
} from './ui';

const WHISPER_MODELS = [
  { id: 'tiny', label: 'tiny — fastest, misses many swears', badge: 'Ultra Fast' },
  { id: 'base', label: 'base — fast, default for live clips', badge: 'Standard' },
  { id: 'small', label: 'small — recommended balance (Best for 4-core VPS)', badge: 'Recommended' },
  { id: 'medium', label: 'medium — highly accurate, slang aware', badge: 'High Quality' },
  { id: 'large-v3-turbo', label: 'large-v3-turbo — maximum accuracy', badge: 'Studio Max' },
];

const SETTINGS_TABS = [
  { id: 'ai', label: 'AI & Scoring', icon: Sparkles, desc: 'Gemini API keys, models & virality thresholds' },
  { id: 'story', label: 'Narrative Storylines', icon: BookOpen, desc: 'Same-stream setup seed staging & stitch settings' },
  { id: 'autoedit', label: 'Auto Edit & Pacing', icon: Zap, desc: 'Jump cuts, punch zooms, sound effects & hook cards' },
  { id: 'transcription', label: 'Whisper Models', icon: Cpu, desc: 'Speech-to-text models for VODs and live clips' },
  { id: 'downloads', label: 'YouTube & Engine', icon: Download, desc: 'yt-dlp health, cookies.txt & bot bypass' },
  { id: 'censor', label: 'Profanity Censor', icon: VolumeX, desc: 'Word lists, bleep audio & asterisks' },
  { id: 'storage', label: 'Storage & Alerts', icon: HardDrive, desc: 'Disk usage, Telegram alerts & retention' },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState('ai');
  const [keys, setKeys] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [model, setModel] = useState('gemini-flash-lite-latest');
  const [minScore, setMinScore] = useState(70);
  const [testingKey, setTestingKey] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copiedPool, setCopiedPool] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [censor, setCensor] = useState(null);
  const [whisperModel, setWhisperModel] = useState('small');
  const [liveWhisperModel, setLiveWhisperModel] = useState('base');
  const [storyEnabled, setStoryEnabled] = useState(false);
  const [storyMode, setStoryMode] = useState('shadow');
  const [storyCpuBudget, setStoryCpuBudget] = useState(0.35);
  const [storyGraceMinutes, setStoryGraceMinutes] = useState(35);
  const [autoEditEnabled, setAutoEditEnabled] = useState(false);
  const [videoJudge, setVideoJudge] = useState(true);
  const [videoJudgeTopK, setVideoJudgeTopK] = useState(3);
  const [autoEditStyle, setAutoEditStyle] = useState('punchy');
  const [autoEditHookCard, setAutoEditHookCard] = useState(true);
  const [autoEditAi, setAutoEditAi] = useState(true);
  const [enableBackgroundVod, setEnableBackgroundVod] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await axios.get('/api/settings');
      setKeys(res.data.gemini_api_keys || []);
      setModel(res.data.gemini_model || 'gemini-flash-lite-latest');
      setMinScore(res.data.min_virality_score || 70);
      setCensor(res.data.censor || null);
      setWhisperModel(res.data.whisper_model || 'small');
      setLiveWhisperModel(res.data.live_whisper_model || 'base');
      setStoryEnabled(Boolean(res.data.story_engine_enabled));
      setStoryMode(res.data.story_mode || 'shadow');
      setStoryCpuBudget(res.data.story_seed_cpu_budget ?? 0.35);
      setStoryGraceMinutes(res.data.story_session_grace_minutes ?? 35);
      setAutoEditEnabled(Boolean(res.data.auto_edit_enabled));
      setVideoJudge(res.data.video_judge_enabled !== false);
      setVideoJudgeTopK(res.data.video_judge_top_k || 3);
      setAutoEditStyle(res.data.auto_edit_style || 'punchy');
      setAutoEditHookCard(res.data.auto_edit_hook_card ?? true);
      setAutoEditAi(res.data.auto_edit_ai_director ?? true);
      setEnableBackgroundVod(Boolean(res.data.enable_background_vod));
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const handleAddKey = async () => {
    const trimmedKey = newKey.trim();
    if (!trimmedKey) return;
    const label = newLabel.trim() || `Account ${keys.length + 1}`;
    if (keys.some((item) => (typeof item === 'object' ? item.key : item) === trimmedKey)) return;

    const newItem = { key: trimmedKey, label: label };
    const updated = [...keys, newItem];
    setKeys(updated);
    setNewKey('');
    setNewLabel('');

    try {
      await axios.post('/api/settings', {
        gemini_api_keys: updated,
        gemini_model: model,
        min_virality_score: minScore,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Auto-save key failed:', err);
    }
  };

  const handleRemoveKey = async (idx) => {
    const updated = keys.filter((_, i) => i !== idx);
    setKeys(updated);
    setConfirmDeleteIdx(null);
    try {
      await axios.post('/api/settings', {
        gemini_api_keys: updated,
        gemini_model: model,
        min_virality_score: minScore,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Auto-save key removal failed:', err);
    }
  };

  const handleTestKey = async (keyString, idx) => {
    setTestingKey(idx);
    try {
      const res = await axios.post('/api/settings/test-key', {
        api_key: keyString,
        model: model,
      });
      setTestResults((prev) => ({
        ...prev,
        [keyString]: res.data.valid ? { ok: true, msg: 'Active & Verified' } : { ok: false, msg: res.data.error || 'Failed' }
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [keyString]: { ok: false, msg: err.response?.data?.error || 'Connection Failed' }
      }));
    } finally {
      setTestingKey(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      await axios.post('/api/settings', {
        gemini_api_keys: keys,
        gemini_model: model,
        min_virality_score: minScore,
        whisper_model: whisperModel,
        live_whisper_model: liveWhisperModel,
        story_engine_enabled: storyEnabled,
        story_mode: storyMode,
        story_seed_cpu_budget: storyCpuBudget,
        story_session_grace_minutes: storyGraceMinutes,
        auto_edit_enabled: autoEditEnabled,
        auto_edit_style: autoEditStyle,
        auto_edit_hook_card: autoEditHookCard,
        auto_edit_ai_director: autoEditAi,
        enable_background_vod: enableBackgroundVod,
        video_judge_enabled: videoJudge,
        video_judge_top_k: videoJudgeTopK,
        ...(censor ? { censor } : {}),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setBanner({ tone: 'bad', text: `Could not save settings: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyAllKeys = () => {
    const jsonStr = JSON.stringify(keys, null, 2);
    navigator.clipboard.writeText(jsonStr);
    setCopiedPool(true);
    setTimeout(() => setCopiedPool(false), 2500);
  };

  const handleImportBulkKeys = async () => {
    if (!bulkInput.trim()) return;
    let parsedList = [];
    try {
      const parsed = JSON.parse(bulkInput.trim());
      if (Array.isArray(parsed)) {
        parsedList = parsed.map((item, idx) => {
          if (typeof item === 'object' && item.key) {
            return { key: item.key.trim(), label: item.label || `Account ${idx + 1}` };
          }
          return { key: String(item).trim(), label: `Account ${idx + 1}` };
        });
      }
    } catch (e) {
      const lines = bulkInput.split(/[\n,]+/);
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed) {
          if (trimmed.includes(':') || trimmed.includes('=')) {
            const [lbl, k] = trimmed.split(/[:=]/);
            parsedList.push({ key: k.trim(), label: lbl.trim() });
          } else {
            parsedList.push({ key: trimmed, label: `Account ${idx + 1}` });
          }
        }
      });
    }

    if (parsedList.length === 0) {
      setBanner({ tone: 'bad', text: 'Could not find any valid keys to import.' });
      return;
    }

    const existingKeyStrings = new Set(keys.map((k) => (typeof k === 'object' ? k.key : k)));
    const merged = [...keys];
    parsedList.forEach((item) => {
      if (!existingKeyStrings.has(item.key)) {
        merged.push(item);
        existingKeyStrings.add(item.key);
      }
    });

    setKeys(merged);
    setBulkInput('');
    setBulkModalOpen(false);

    try {
      await axios.post('/api/settings', {
        gemini_api_keys: merged,
        gemini_model: model,
        min_virality_score: minScore,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      console.error('Failed to auto-save imported keys:', err);
    }
  };

  const saveButton = (
    <Button variant="primary" icon={saveSuccess ? Check : ShieldCheck} loading={saving} onClick={handleSave} className="shadow-lg shadow-accent/20">
      {saveSuccess ? 'Saved & Applied' : 'Save Changes'}
    </Button>
  );

  return (
    <Page
      title="Settings & System Configuration"
      icon={SettingsIcon}
      subtitle="Manage AI intelligence models, Gemini API pools, Whisper transcription, YouTube downloads, and profanity handling."
      actions={<div className="hidden md:block">{saveButton}</div>}
      className="pb-28 md:pb-12 !max-w-4xl"
    >
      {banner && <Notice tone={banner.tone} icon={AlertCircle}>{banner.text}</Notice>}

      {/* Modern Studio Category Tabs */}
      <div className="flex flex-wrap gap-2 pb-1 border-b border-line mb-6">
        {SETTINGS_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition-all border ${
                isActive
                  ? 'bg-[#181C26] text-accent border-accent/40 shadow-sm shadow-accent/10'
                  : 'text-muted hover:text-ink hover:bg-white/[0.03] border-transparent'
              }`}
            >
              <Icon size={14} className={isActive ? 'text-accent' : 'text-faint'} />
              <span>{tab.label}</span>
              {tab.id === 'ai' && keys.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-accent/15 text-accent border border-accent/30 font-bold">
                  {keys.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: AI & SCORING */}
      {activeTab === 'ai' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Gemini Key Pool Panel */}
          <Panel
            title="Gemini API Key Pool"
            icon={Key}
            right={(
              <div className="flex items-center gap-1.5">
                <Pill tone={keys.length ? 'good' : 'warn'}>
                  {keys.length} {keys.length === 1 ? 'Key Configured' : 'Keys in Pool'}
                </Pill>
                <Button size="sm" icon={copiedPool ? Check : Copy} onClick={handleCopyAllKeys} title="Copy the whole pool to move it to another server">
                  {copiedPool ? 'Copied' : 'Export'}
                </Button>
                <Button size="sm" icon={Upload} onClick={() => setBulkModalOpen(true)}>
                  Import
                </Button>
              </div>
            )}
          >
            <div className="bg-canvas border border-line rounded-xl p-3.5 mb-4 text-xs text-muted leading-relaxed flex items-start gap-3">
              <Zap size={16} className="text-accent shrink-0 mt-0.5" />
              <div>
                AutoClip automatically rotates across keys when hitting a <strong className="text-slate-200">429 rate limit</strong>. Add keys from multiple Google Cloud / AI Studio projects to achieve 100% uninterrupted autonomous evaluation.
              </div>
            </div>

            {/* Input Row */}
            <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2.5 mb-4">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Account Label (e.g. Work, Personal 1)"
                aria-label="Key label"
              />
              <Input
                mono
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
                placeholder="AIzaSy... (Paste Gemini API key)"
                aria-label="API key"
                autoComplete="off"
                spellCheck={false}
              />
              <Button icon={Plus} onClick={handleAddKey} disabled={!newKey.trim()} variant="primary">
                Add Key
              </Button>
            </div>

            {/* Key List */}
            <div className="space-y-2">
              {keys.length === 0 ? (
                <EmptyState
                  icon={Key}
                  title="No API keys registered"
                  text="Add at least one Gemini key above or in config/.env to activate AI moment scoring and auto title generation."
                  className="!py-8 border border-dashed border-line rounded-xl"
                />
              ) : (
                keys.map((item, idx) => {
                  const kStr = typeof item === 'object' ? item.key : item;
                  const kLabel = typeof item === 'object' ? item.label : `Account ${idx + 1}`;
                  const kStatus = typeof item === 'object' ? item.status : null;
                  const result = testResults[kStr];
                  return (
                    <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3.5 rounded-xl bg-[#0E1118] border border-line hover:border-white/10 transition-colors">
                      <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                        <Badge tone="accent">{kLabel}</Badge>
                        <span className="font-mono text-xs text-slate-300">
                          {kStr.slice(0, 8)}••••••••{kStr.slice(-6)}
                        </span>
                        {result ? (
                          <Pill tone={result.ok ? 'good' : 'bad'}>
                            {result.ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                            {result.msg}
                          </Pill>
                        ) : kStatus === 'Quota Exhausted' ? (
                          <Pill tone="warn">429 Rate Limited</Pill>
                        ) : (
                          <Pill tone="good">Ready</Pill>
                        )}
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        {confirmDeleteIdx === idx ? (
                          <>
                            <span className="text-xs text-bad font-bold">Confirm delete?</span>
                            <Button size="sm" variant="danger" onClick={() => handleRemoveKey(idx)}>
                              Delete
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteIdx(null)}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" icon={Zap} loading={testingKey === idx} onClick={() => handleTestKey(kStr, idx)}>
                              Test
                            </Button>
                            <IconButton icon={Trash2} label="Delete key" size="sm" onClick={() => setConfirmDeleteIdx(idx)} className="hover:!text-bad" />
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          {/* Model and Virality Threshold Grid */}
          <div className="grid md:grid-cols-2 gap-5">
            <Panel title="Scoring Model" icon={Cpu} className="space-y-4">
              <Field label="Gemini Evaluation Model" hint="Powers the CalibratedJudge prompt engine, hook cards, and virality scoring.">
                <Select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="gemini-flash-lite-latest">Flash Lite - fast, saves quota (recommended)</option>
                  <option value="gemini-flash-latest">Flash - deeper reasoning</option>
                  <option value="gemini-2.5-flash">2.5 Flash - newest</option>
                </Select>
              </Field>
              <div className="p-3 bg-canvas border border-line rounded-xl text-xs text-muted">
                <span className="text-slate-200 font-bold">Recommended:</span> <code>gemini-flash-lite-latest</code> evaluates moments in under 1.2s and uses 4x less quota.
              </div>
              <Field label="Video AI judge" hint="Gemini also watches the best candidates (low-res preview) and re-ranks them by what happens on screen. Costs a little extra quota.">
                <div className="grid grid-cols-2 gap-2">
                  <Select value={videoJudge ? 'true' : 'false'} onChange={(e) => setVideoJudge(e.target.value === 'true')} aria-label="Video AI judge">
                    <option value="true">On</option>
                    <option value="false">Off (transcript only)</option>
                  </Select>
                  <Select value={String(videoJudgeTopK)} onChange={(e) => setVideoJudgeTopK(Number(e.target.value))} disabled={!videoJudge} aria-label="Candidates watched">
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Watch top {n}</option>)}
                  </Select>
                </div>
              </Field>
            </Panel>

            <Panel title="Minimum Virality Gate" icon={Sliders} right={<Badge tone="good">{minScore}/100</Badge>}>
              <p className="text-xs text-muted mb-4">
                Moments scored below this gate are automatically rejected and discarded, keeping your review station filled with viral hits only.
              </p>
              <input
                type="range"
                min="50"
                max="95"
                step="5"
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                aria-label="Minimum virality score"
                className="w-full accent-accent cursor-pointer h-6 mb-2"
              />
              <div className="grid grid-cols-3 text-xs text-faint">
                <span className="flex flex-col"><span className="font-mono">50</span>Relaxed</span>
                <span className="flex flex-col items-center font-bold text-slate-300"><span className="font-mono">70</span>Balanced</span>
                <span className="flex flex-col items-end"><span className="font-mono">95</span>Strict</span>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* TAB: NARRATIVE STORYLINES */}
      {activeTab === 'story' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <Panel title="Same-Stream Narrative Storylines" icon={BookOpen} className="space-y-5">
            <div className="bg-canvas border border-line rounded-xl p-4 text-xs text-muted flex items-start gap-3">
              <BookOpen size={18} className="text-accent shrink-0 mt-0.5" />
              <div>
                <span className="text-slate-200 font-bold block mb-1">Session Setup Capture & Multi-Source Auto-Edit Stitching</span>
                Automatically detects when streamers make promises, bets, challenges, or running jokes (e.g. <em>"Every time I die I'll do 10 pushups"</em>), stages the snippet from the ring buffer, and stitches it when the payoff happens later in the same stream.
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Story Engine Master Switch"
                hint="Enable background seed detection and payoff matching for active streams."
              >
                <Select value={storyEnabled ? 'true' : 'false'} onChange={(e) => setStoryEnabled(e.target.value === 'true')}>
                  <option value="false">Disabled (Off)</option>
                  <option value="true">Enabled (Active)</option>
                </Select>
              </Field>

              <Field
                label="Operational Mode"
                hint="Shadow logs matches without altering video; Live stitches setup snippets into final clips."
              >
                <Select value={storyMode} onChange={(e) => setStoryMode(e.target.value)}>
                  <option value="shadow">Shadow Mode (Log & Record Only)</option>
                  <option value="live">Live Mode (Multi-Source Stitched Clips)</option>
                </Select>
              </Field>
            </div>

            <div className="grid md:grid-cols-2 gap-5 pt-2 border-t border-line">
              <Field
                label="Seed Detection CPU Budget (Max 1.0)"
                hint="Hard cap for background seed transcription (Default 0.35 = 35% of 1 CPU core)."
              >
                <Input
                  type="number"
                  step="0.05"
                  min="0.10"
                  max="1.0"
                  value={storyCpuBudget}
                  onChange={(e) => setStoryCpuBudget(parseFloat(e.target.value) || 0.35)}
                />
              </Field>

              <Field
                label="Session Disconnect Grace Period (Minutes)"
                hint="Keeps active stream seeds alive during stream drops or OBS restarts (Default: 35 min)."
              >
                <Input
                  type="number"
                  step="5"
                  min="5"
                  max="120"
                  value={storyGraceMinutes}
                  onChange={(e) => setStoryGraceMinutes(parseInt(e.target.value, 10) || 35)}
                />
              </Field>
            </div>
          </Panel>
        </div>
      )}

      {/* TAB: AUTO EDIT & PACING */}
      {activeTab === 'autoedit' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <Panel title="Auto Edit & Video Pacing" icon={Zap} className="space-y-5">
            <div className="bg-canvas border border-line rounded-xl p-4 text-xs text-muted flex items-start gap-3">
              <Zap size={18} className="text-accent shrink-0 mt-0.5" />
              <div>
                <span className="text-slate-200 font-bold block mb-1">Autonomous TikTok / Reels Style Video Pacing</span>
                When enabled, AutoClip analyzes word timestamps and measured audio loudness to jump-cut silent pauses, trim filler words (<em>"um"</em>, <em>"uh"</em>), punch-in camera zooms on shout words, and add pop-in hook title cards with sound effects.
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Auto-edit stream clips"
                hint="Default for live moments, auto-processed VODs and manual clips. Quick Clip can override it per clip."
              >
                <Select value={autoEditEnabled ? 'true' : 'false'} onChange={(e) => setAutoEditEnabled(e.target.value === 'true')}>
                  <option value="false">Disabled (Standard Render)</option>
                  <option value="true">Enabled (Apply Cuts, Zooms & SFX)</option>
                </Select>
              </Field>

              <Field
                label="Editing Pace & Style"
                hint="Punchy (fast cuts & hype zooms), Clean (subtle zooms, no loud SFX), Minimal (trims dead air only)."
              >
                <Select value={autoEditStyle} onChange={(e) => setAutoEditStyle(e.target.value)}>
                  <option value="punchy">Punchy — Fast jump cuts, frequent zooms & SFX</option>
                  <option value="clean">Clean — Polished cuts, gentle zooms, no SFX</option>
                  <option value="minimal">Minimal — Trims silent dead air only</option>
                </Select>
              </Field>
            </div>

            <div className="pt-2 border-t border-line">
              <Field
                label="Pop-in Hook Title Card"
                hint="Displays a bold animated title card in the first 2.5s with the punchiest word highlighted."
              >
                <Select value={autoEditHookCard ? 'true' : 'false'} onChange={(e) => setAutoEditHookCard(e.target.value === 'true')}>
                  <option value="true">Enabled (Show Title Card)</option>
                  <option value="false">Disabled (No Title Card)</option>
                </Select>
              </Field>
            </div>

            <div className="pt-2 border-t border-line">
              <Field
                label="AI Edit Director"
                hint="Gemini reads each clip's transcript and decides where to zoom, which words to pop, extra sounds, the cold open and the hook. Off = the built-in rules. Uses one AI call per clip; falls back to the rules if the AI is unavailable."
              >
                <Select value={autoEditAi ? 'true' : 'false'} onChange={(e) => setAutoEditAi(e.target.value === 'true')}>
                  <option value="true">On (AI decides the edit)</option>
                  <option value="false">Off (built-in rules)</option>
                </Select>
              </Field>
            </div>
          </Panel>
        </div>
      )}

      {/* TAB 2: TRANSCRIPTION & WHISPER */}
      {activeTab === 'transcription' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <Panel title="Whisper Speech-to-Text Engines" icon={Cpu} className="space-y-5">
            <div className="bg-canvas border border-line rounded-xl p-4 text-xs text-muted flex items-start gap-3">
              <Server size={18} className="text-accent shrink-0 mt-0.5" />
              <div>
                <span className="text-slate-200 font-bold block mb-1">Running on Oracle Ampere ARM (4 Cores / 24 GB RAM)</span>
                Because you now have 24 GB of RAM and 4 physical cores, you can comfortably run <code>small</code> or <code>medium</code> Whisper models for near-perfect syllable snapping without running out of memory.
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Quick Clip & Full VOD Model"
                hint="Used when manually clipping from YouTube or processing entire livestream VODs."
              >
                <Select value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)}>
                  {WHISPER_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Real-Time Live Stream Model"
                hint="Used for rolling 75-second hype moments sliced during live Twitch/YouTube streams."
              >
                <Select value={liveWhisperModel} onChange={(e) => setLiveWhisperModel(e.target.value)}>
                  {WHISPER_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="pt-4 border-t border-line">
              <Field
                label="Background Offline VOD Ingestion"
                hint="When disabled (recommended), AutoClip skips downloading & transcribing multi-hour past stream archives, reserving full CPU power for real-time live hype moments and Quick Clips."
              >
                <Select
                  value={enableBackgroundVod ? 'true' : 'false'}
                  onChange={(e) => setEnableBackgroundVod(e.target.value === 'true')}
                >
                  <option value="false">Disabled (Recommended — Focus on Live Streams & Quick Clips)</option>
                  <option value="true">Enabled (Auto-download full offline VOD archives)</option>
                </Select>
              </Field>
            </div>
          </Panel>
        </div>
      )}

      {/* TAB 3: YOUTUBE & ENGINE */}
      {activeTab === 'downloads' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <YouTubeDownloads />
        </div>
      )}

      {/* TAB 4: PROFANITY CENSOR */}
      {activeTab === 'censor' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <CensorSettings value={censor} onChange={setCensor} />
        </div>
      )}

      {/* TAB 5: STORAGE & ALERTS */}
      {activeTab === 'storage' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <StorageAlerts />
        </div>
      )}

      {/* Mobile Sticky Save Bar */}
      <div className="md:hidden fixed inset-x-3 z-40" style={{ bottom: 'calc(68px + var(--safe-bottom))' }}>
        <Button
          block
          size="lg"
          variant="primary"
          icon={saveSuccess ? Check : ShieldCheck}
          loading={saving}
          onClick={handleSave}
          className="shadow-2xl shadow-black/80"
        >
          {saveSuccess ? 'Saved & Applied' : 'Save Changes'}
        </Button>
      </div>

      {/* Bulk Import Sheet */}
      <Sheet
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        title="Import Gemini API Keys"
        footer={(
          <div className="flex gap-2">
            <Button block onClick={() => setBulkModalOpen(false)}>Cancel</Button>
            <Button block variant="primary" onClick={handleImportBulkKeys} disabled={!bulkInput.trim()}>
              Import &amp; Save
            </Button>
          </div>
        )}
      >
        <p className="text-xs text-muted mb-3">
          Paste exported JSON from another AutoClip instance, or keys line-by-line / comma-separated (<span className="font-mono">Label: Key</span> format supported).
        </p>
        <Textarea
          rows={7}
          value={bulkInput}
          onChange={(e) => setBulkInput(e.target.value)}
          className="font-mono !text-xs"
          placeholder={'[\n  { "key": "AIzaSy...", "label": "Account 1" }\n]'}
          aria-label="Keys to import"
        />
      </Sheet>
    </Page>
  );
}
