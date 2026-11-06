import React, { useState } from 'react';
import { Zap, Link as LinkIcon, Sparkles } from 'lucide-react';
import { clipManual } from '../api';

export default function QuickClip({ templates = [] }) {
  const [url, setUrl] = useState('');
  const [template, setTemplate] = useState('ishowspeed_gaming');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    try {
      const payload = {
        url: url.trim(),
        template,
        time_range: startTime && endTime ? [parseFloat(startTime), parseFloat(endTime)] : null,
      };
      await clipManual(payload);
      alert('⚡ Quick clip pipeline launched in the background! Check Live Logs or Review Station.');
      setUrl('');
      setStartTime('');
      setEndTime('');
    } catch (err) {
      alert('Failed to launch quick clip: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
            <Zap size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">Manual Quick Clip Ingestion</h2>
            <p className="text-xs text-slate-400">Download, transcribe, score, and render any YouTube or Twitch VOD URL.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-xs">
          <div>
            <label className="block text-slate-300 font-bold mb-1.5 flex items-center gap-1.5">
              <LinkIcon size={14} /> Video Stream / VOD URL
            </label>
            <input
              type="text"
              required
              placeholder="https://www.youtube.com/watch?v=... or Twitch VOD"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-bold mb-1.5">
              Rendering Layout Template
            </label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-lg p-3 text-white text-sm"
            >
              <option value="ishowspeed_gaming">ishowspeed_gaming (Facecam Top + Game Bottom)</option>
              <option value="irl_streamer">irl_streamer (Blurred Background)</option>
              <option value="podcast_split">podcast_split (Split Screen)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-bold mb-1">Optional Start (Sec)</label>
              <input
                type="number"
                placeholder="e.g. 120"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-bold mb-1">Optional End (Sec)</label>
              <input
                type="number"
                placeholder="e.g. 180"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-white"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-4 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-xl text-sm transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
          >
            <Sparkles size={16} /> {loading ? 'Launching Ingestion...' : 'Generate 9:16 Short Clip'}
          </button>
        </form>
      </div>
    </div>
  );
}

