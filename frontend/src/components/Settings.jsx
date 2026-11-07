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
  RotateCw, 
  ShieldCheck,
  Zap,
  Info
} from 'lucide-react';
import axios from 'axios';

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

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await axios.get('/api/settings');
      setKeys(res.data.gemini_api_keys || []);
      setModel(res.data.gemini_model || 'gemini-flash-lite-latest');
      setMinScore(res.data.min_virality_score || 70);
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
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      alert('Failed to save settings: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-500 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/10">
            <SettingsIcon className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">System Settings</h1>
            <p className="text-sm text-slate-400">
              Manage multi-key failover pools, AI models, and detection thresholds without editing files.
            </p>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-sm shadow-lg shadow-cyan-500/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {saving ? <RotateCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          {saveSuccess ? 'Saved & Applied!' : 'Save Changes'}
        </button>
      </div>

      {/* Multi-Key Pool Card */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-white">Google Gemini API Key Pool</h2>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-400 font-mono">
            {keys.length} Active {keys.length === 1 ? 'Key' : 'Keys'}
          </span>
        </div>

        <p className="text-xs text-slate-400">
          AutoClip will automatically rotate to the next key if any key hits a <strong>429 Quota Exceeded</strong> error.
          <span className="text-amber-400 block mt-1">
            ⚠️ Tip: For true independent quotas, generate each key from a different Google account.
          </span>
        </p>

        {/* Key Add Bar */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (e.g. Account 1, Backup Account...)"
            className="sm:w-1/3 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
          />
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
            placeholder="Paste Google Gemini API Key (e.g. AIzaSy... or AQ.Ab8...)"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
          />
          <button
            onClick={handleAddKey}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" /> Add Key
          </button>
        </div>

        {/* Keys List */}
        <div className="space-y-2 mt-3">
          {keys.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
              No keys added yet. Add at least one key to enable AI clip scoring.
            </div>
          ) : (
            keys.map((item, idx) => {
              const kStr = typeof item === 'object' ? item.key : item;
              const kLabel = typeof item === 'object' ? item.label : `Account ${idx + 1}`;
              const kStatus = typeof item === 'object' ? item.status : null;
              const result = testResults[kStr];

              return (
                <div
                  key={idx}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-sm gap-2"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-cyan-950/70 border border-cyan-800/80 text-cyan-400">
                      {kLabel}
                    </span>
                    <span className="font-mono text-xs text-slate-300">
                      {kStr.slice(0, 10)}••••••••••••••••••••{kStr.slice(-6)}
                    </span>
                    {result ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        result.ok ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400 border border-red-800'
                      }`}>
                        {result.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        {result.msg}
                      </span>
                    ) : kStatus === 'Quota Exhausted' ? (
                      <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1 bg-amber-950 text-amber-400 border border-amber-800 animate-pulse">
                        <AlertCircle className="w-3 h-3" />
                        Quota Exhausted (429)
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1 bg-emerald-950/40 text-emerald-400 border border-emerald-900/50">
                        <CheckCircle2 className="w-3 h-3" />
                        Active
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    {confirmDeleteIdx === idx ? (
                      <div className="flex items-center gap-1.5 bg-red-950/60 border border-red-800/80 px-2 py-1 rounded-lg">
                        <span className="text-[11px] text-red-300 font-medium">Delete?</span>
                        <button
                          onClick={() => handleRemoveKey(idx)}
                          className="px-2 py-0.5 text-[11px] font-bold bg-red-600 hover:bg-red-500 text-white rounded transition-colors cursor-pointer"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDeleteIdx(null)}
                          className="px-2 py-0.5 text-[11px] text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleTestKey(kStr, idx)}
                          disabled={testingKey === idx}
                          className="px-2.5 py-1 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/50 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <Zap className={`w-3.5 h-3.5 ${testingKey === idx ? 'animate-pulse' : ''}`} />
                          {testingKey === idx ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteIdx(idx)}
                          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors cursor-pointer"
                          title="Delete Key"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Model & Virality Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Model Selector */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-purple-400" />
            <h2 className="text-base font-semibold text-white">AI Scoring Model</h2>
          </div>
          <p className="text-xs text-slate-400">
            Select the primary Google Gemini model used for hook scoring and titles.
          </p>

          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500 font-mono"
          >
            <option value="gemini-flash-lite-latest">gemini-flash-lite-latest (Recommended - 70% Quota Savings)</option>
            <option value="gemini-flash-latest">gemini-flash-latest</option>
            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
          </select>
        </div>

        {/* Min Virality Score */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sliders className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-semibold text-white">Min Virality Score</h2>
            </div>
            <span className="text-sm font-bold text-emerald-400 font-mono bg-emerald-950/60 px-2.5 py-0.5 rounded-lg border border-emerald-800">
              {minScore}/100
            </span>
          </div>

          <p className="text-xs text-slate-400">
            Clips below this threshold are automatically discarded to keep your queue high quality.
          </p>

          <input
            type="range"
            min="50"
            max="95"
            step="5"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}

