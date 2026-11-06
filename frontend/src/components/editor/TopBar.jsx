import React, { useState } from 'react';
import { 
  ArrowLeft, 
  Scissors, 
  CheckCircle2,
  BookmarkPlus,
  RotateCcw,
  RotateCw,
  Sparkles
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEditorStore } from '../../store/editorStore';
import axios from 'axios';

export default function TopBar() {
  const navigate = useNavigate();
  const { 
    clip, 
    clipId, 
    hasUnsavedChanges, 
    saving, 
    lastSaved, 
    edl,
    saveEDL,
    undo,
    redo
  } = useEditorStore();

  const [rendering, setRendering] = useState(false);
  const [renderedResultUrl, setRenderedResultUrl] = useState(null);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetScope, setPresetScope] = useState('global');
  const [savingPreset, setSavingPreset] = useState(false);

  const handleBack = () => {
    if (hasUnsavedChanges) {
      if (!confirm('You have unsaved changes. Return to dashboard?')) return;
    }
    navigate('/');
  };

  const handleRender = async () => {
    setRendering(true);
    setRenderedResultUrl(null);
    try {
      await saveEDL();
      const res = await fetch(`/api/clips/${clipId}/render-edl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edl),
      });
      const data = await res.json();
      if (data.success && data.clip?.rendered_video_path) {
        const v = data.clip.render_version || Date.now();
        const filename = data.clip.rendered_video_path.split(/[\\/]/).pop();
        setRenderedResultUrl(`/renders/${filename}?v=${v}`);
      } else {
        alert('Render failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Render request failed: ' + err.message);
    } finally {
      setRendering(false);
    }
  };

  const handleSavePreset = async () => {
    if (!presetName.trim()) {
      alert('Please enter a preset name');
      return;
    }
    setSavingPreset(true);
    try {
      const presetPayload = {
        name: presetName.trim(),
        scope: presetScope,
        channel_id: presetScope === 'channel' ? clip?.channel_id : null,
        data: {
          layout: edl?.layout,
          captions: edl?.captions,
          subtitles: edl?.captions,
        },
      };
      await axios.post('/api/presets', presetPayload);
      setShowPresetModal(false);
      setPresetName('');
      alert('Preset saved successfully!');
    } catch (err) {
      alert('Failed saving preset: ' + err.message);
    } finally {
      setSavingPreset(false);
    }
  };

  return (
    <>
      <header className="h-11 bg-[#0A0B0E] border-b border-white/[0.06] px-4 flex items-center justify-between select-none shrink-0 z-30 text-xs">
        {/* Left: Back & Clip Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-1.5 rounded-lg text-[#8B90A0] hover:text-white hover:bg-white/[0.04] transition-all"
            title="Return to Review Station"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="flex items-center gap-2">
            <span className="font-bold text-white max-w-sm truncate">
              {clip?.title || 'Editing Clip'}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 font-extrabold text-[10px]">
              🔥 {clip?.virality_score || 85}/100
            </span>
          </div>

          <div className="text-[11px] font-mono ml-2">
            {saving ? (
              <span className="text-[#8FD3FF] animate-pulse">Saving...</span>
            ) : hasUnsavedChanges ? (
              <span className="text-amber-400">Unsaved edits</span>
            ) : lastSaved ? (
              <span className="text-emerald-400">Saved</span>
            ) : null}
          </div>
        </div>

        {/* Center: Undo / Redo */}
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            className="p-1.5 rounded-lg text-[#8B90A0] hover:text-white hover:bg-white/5"
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={redo}
            className="p-1.5 rounded-lg text-[#8B90A0] hover:text-white hover:bg-white/5"
            title="Redo (Ctrl+Shift+Z)"
          >
            <RotateCw size={14} />
          </button>
        </div>

        {/* Right: Save Preset & Render 9:16 Action */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowPresetModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1A1D24] hover:bg-[#1A1D24]/80 text-[#8FD3FF] font-bold border border-white/10 transition-all"
          >
            <BookmarkPlus size={13} />
            <span>Save Preset</span>
          </button>

          <button
            onClick={handleRender}
            disabled={rendering}
            className="flex items-center gap-1.5 bg-gradient-to-r from-[#8FD3FF] to-[#A9B8FF] hover:from-[#A9B8FF] hover:to-[#8FD3FF] text-[#0A0B0E] font-black px-4 py-1.5 rounded-xl shadow-lg shadow-[#8FD3FF]/20 hover:scale-[1.02] transition-all"
          >
            <Scissors size={14} className={rendering ? "animate-spin" : ""} />
            <span>{rendering ? 'RENDERING...' : 'RENDER 9:16'}</span>
          </button>
        </div>
      </header>

      {/* Save Preset Modal */}
      {showPresetModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#13151A] border border-white/10 rounded-2xl p-5 max-w-sm w-full flex flex-col gap-4 shadow-2xl">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <BookmarkPlus size={16} className="text-[#8FD3FF]" /> Save as Visual Preset
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[#8B90A0] block mb-1">Preset Name</label>
                <input
                  type="text"
                  placeholder="e.g. Gaming Facecam Bottom Seam"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className="w-full bg-[#1A1D24] border border-white/10 rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="text-[#8B90A0] block mb-1">Scope</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPresetScope('global')}
                    className={`py-1.5 rounded-lg border font-bold ${
                      presetScope === 'global' ? 'border-[#8FD3FF] text-white bg-[#1A1D24]' : 'border-white/5 text-[#8B90A0]'
                    }`}
                  >
                    Global (All channels)
                  </button>
                  <button
                    onClick={() => setPresetScope('channel')}
                    className={`py-1.5 rounded-lg border font-bold ${
                      presetScope === 'channel' ? 'border-[#8FD3FF] text-white bg-[#1A1D24]' : 'border-white/5 text-[#8B90A0]'
                    }`}
                  >
                    This Streamer Only
                  </button>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#0A0B0E] border border-white/5 text-[10px] text-slate-400 space-y-1">
                <span className="font-bold text-white block">Preset Will Include:</span>
                <div>• Facecam / Gameplay layout crops</div>
                <div>• Subtitle placement position &amp; font styling</div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleSavePreset}
                disabled={savingPreset}
                className="flex-1 py-2 bg-[#8FD3FF] text-black font-bold rounded-xl text-xs hover:bg-[#8FD3FF]/90 transition-all"
              >
                {savingPreset ? 'Saving...' : 'Save Preset'}
              </button>
              <button
                onClick={() => setShowPresetModal(false)}
                className="px-4 py-2 bg-white/10 text-white rounded-xl text-xs hover:bg-white/20"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Final Render Modal */}
      {renderedResultUrl && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#13151A] border border-white/10 rounded-2xl p-5 max-w-sm w-full flex flex-col items-center gap-4 shadow-2xl">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-400" /> Final Render Complete!
            </h3>
            <div className="w-full aspect-[9/16] bg-black rounded-xl overflow-hidden border border-white/10">
              <video src={renderedResultUrl} controls autoPlay loop className="w-full h-full object-contain" />
            </div>
            <div className="flex items-center gap-3 w-full">
              <a
                href={renderedResultUrl}
                download
                className="flex-1 py-2 text-center bg-[#8FD3FF] text-black font-bold rounded-xl text-xs"
              >
                Download MP4
              </a>
              <button
                onClick={() => setRenderedResultUrl(null)}
                className="px-4 py-2 bg-white/10 text-white rounded-xl text-xs hover:bg-white/20"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
