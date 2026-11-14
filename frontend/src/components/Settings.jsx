import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon, Key, Cpu, Sliders, Plus, Trash2, CheckCircle2, AlertCircle, ShieldCheck, Zap, Copy, Upload, Check,
} from 'lucide-react';
import axios from 'axios';
import CensorSettings from './CensorSettings';
import StorageAlerts from './StorageAlerts';
import YouTubeDownloads from './YouTubeDownloads';
import {
  Page, Panel, Button, IconButton, Input, Select, Textarea, Field, Pill, Badge, Sheet, EmptyState, Notice,
} from './ui';

const WHISPER_MODELS = [
  { id: 'tiny', label: 'tiny — fastest, misses many swears' },
  { id: 'base', label: 'base — fast' },
  { id: 'small', label: 'small — recommended balance' },
  { id: 'medium', label: 'medium — accurate, slower' },
  { id: 'large-v3-turbo', label: 'large-v3-turbo — most accurate' },
];

export default function Settings() {
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

    // Auto-save to DB immediately
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
        [keyString]: res.data.valid ? { ok: true, msg: 'Valid & Active' } : { ok: false, msg: res.data.error || 'Failed' }
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
      // 1. Try parsing JSON format
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
      // 2. Fallback to line-by-line or comma-separated
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

    // Merge without duplicates by key
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

    // Auto-save merged pool to DB immediately
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
    <Button variant="primary" icon={saveSuccess ? Check : ShieldCheck} loading={saving} onClick={handleSave}>
      {saveSuccess ? 'Saved & applied' : 'Save changes'}
    </Button>
  );

  return (
    <Page title="Settings" icon={SettingsIcon} subtitle="AI keys and models, downloads, storage, alerts and profanity handling."
      actions={<div className="hidden md:block">{saveButton}</div>} className="pb-28 md:pb-8">
      {banner && <Notice tone={banner.tone} icon={AlertCircle}>{banner.text}</Notice>}

      <Panel title="Gemini API key pool" icon={Key}
        right={(
          <>
            <Pill tone={keys.length ? 'good' : 'warn'}>{keys.length} {keys.length === 1 ? 'key' : 'keys'}</Pill>
            <Button size="sm" icon={copiedPool ? Check : Copy} onClick={handleCopyAllKeys} title="Copy the whole pool to move it to another server">{copiedPool ? 'Copied' : 'Copy all'}</Button>
            <Button size="sm" icon={Upload} onClick={() => setBulkModalOpen(true)}>Import</Button>
          </>
        )}>
        <p className="text-xs text-muted mb-3 leading-relaxed">
          If a key hits a <b className="text-slate-300">429 quota</b> error, AutoClip rotates to the next one. For truly independent quotas, create each key from a different Google account.
        </p>
        <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2">
          <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label (optional)" aria-label="Key label" />
          <Input mono value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
            placeholder="Paste a Gemini API key" aria-label="API key" autoComplete="off" spellCheck={false} />
          <Button icon={Plus} onClick={handleAddKey} disabled={!newKey.trim()}>Add key</Button>
        </div>

        <div className="space-y-2 mt-3">
          {keys.length === 0 ? (
            <EmptyState icon={Key} title="No keys yet" text="Add at least one key to enable AI clip scoring." className="!py-6 border border-dashed border-line rounded-xl" />
          ) : keys.map((item, idx) => {
            const kStr = typeof item === 'object' ? item.key : item;
            const kLabel = typeof item === 'object' ? item.label : `Account ${idx + 1}`;
            const kStatus = typeof item === 'object' ? item.status : null;
            const result = testResults[kStr];
            return (
              <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-canvas border border-line">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <Badge tone="accent">{kLabel}</Badge>
                  <span className="font-mono text-[11.5px] text-slate-300 truncate">{kStr.slice(0, 8)}••••••••{kStr.slice(-5)}</span>
                  {result ? (
                    <Pill tone={result.ok ? 'good' : 'bad'}>{result.ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}{result.msg}</Pill>
                  ) : kStatus === 'Quota Exhausted' ? (
                    <Pill tone="warn">Quota exhausted (429)</Pill>
                  ) : (
                    <Pill tone="good">Active</Pill>
                  )}
                </div>
                <div className="flex items-center gap-1.5 self-end sm:self-auto">
                  {confirmDeleteIdx === idx ? (
                    <>
                      <span className="text-[11.5px] text-bad">Delete this key?</span>
                      <Button size="sm" variant="danger" onClick={() => handleRemoveKey(idx)}>Delete</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteIdx(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" icon={Zap} loading={testingKey === idx} onClick={() => handleTestKey(kStr, idx)}>Test</Button>
                      <IconButton icon={Trash2} label="Delete key" size="sm" onClick={() => setConfirmDeleteIdx(idx)} className="hover:!text-bad" />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2 items-start">
        <div className="space-y-3 min-w-0">
          <Panel title="AI models" icon={Cpu} className="space-y-3.5">
            <Field label="Scoring model (Gemini)" hint="Used for hook scoring and titles.">
              <Select value={model} onChange={(e) => setModel(e.target.value)} className="font-mono !text-[13px]">
                <option value="gemini-flash-lite-latest">gemini-flash-lite-latest (recommended - saves quota)</option>
                <option value="gemini-flash-latest">gemini-flash-latest</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              </Select>
            </Field>
            <Field label="Transcription - Quick Clip & VODs (Whisper)" hint="Bigger models catch swear words and fast speech far more reliably.">
              <Select value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)}>
                {WHISPER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </Select>
            </Field>
            <Field label="Transcription - live clips (Whisper)" hint="Live moments arrive every few minutes. On a small VPS keep this on base or tiny so it keeps up.">
              <Select value={liveWhisperModel} onChange={(e) => setLiveWhisperModel(e.target.value)}>
                {WHISPER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </Select>
            </Field>
          </Panel>

          <Panel title="Minimum virality score" icon={Sliders} right={<Badge tone="good">{minScore}/100</Badge>}>
            <p className="text-xs text-muted mb-3">Clips scoring below this are discarded automatically so the review queue stays high quality.</p>
            <input type="range" min="50" max="95" step="5" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}
              aria-label="Minimum virality score" className="w-full accent-[#3987e5] cursor-pointer h-6" />
            <div className="flex justify-between text-[10.5px] text-faint tabular-nums"><span>50 · more clips</span><span>95 · only the best</span></div>
          </Panel>
        </div>

        <div className="space-y-3 min-w-0">
          <YouTubeDownloads />
          <StorageAlerts />
        </div>
      </div>

      <CensorSettings value={censor} onChange={setCensor} />

      {/* Phone: save bar floats above the tab bar */}
      <div className="md:hidden fixed inset-x-3 z-40" style={{ bottom: 'calc(68px + var(--safe-bottom))' }}>
        <Button block size="lg" variant="primary" icon={saveSuccess ? Check : ShieldCheck} loading={saving} onClick={handleSave} className="shadow-xl shadow-black/50">
          {saveSuccess ? 'Saved & applied' : 'Save changes'}
        </Button>
      </div>

      <Sheet open={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Import API keys"
        footer={(
          <div className="flex gap-2">
            <Button block onClick={() => setBulkModalOpen(false)}>Cancel</Button>
            <Button block variant="primary" onClick={handleImportBulkKeys} disabled={!bulkInput.trim()}>Import &amp; save</Button>
          </div>
        )}>
        <p className="text-xs text-muted mb-3">Paste the JSON exported from another AutoClip, or keys one per line / comma-separated (<span className="font-mono">label: key</span> works too).</p>
        <Textarea rows={7} value={bulkInput} onChange={(e) => setBulkInput(e.target.value)} className="font-mono !text-xs"
          placeholder={'[\n  { "key": "AIzaSy...", "label": "Account 1" }\n]'} aria-label="Keys to import" />
      </Sheet>
    </Page>
  );
}
