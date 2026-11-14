import React, { useState } from 'react';
import { Share2, Send, Calendar, Check, ExternalLink } from 'lucide-react';
import { useEditorStore } from '../../../store/editorStore';
import { postClipNow, queueClip, updateClip } from '../../../api';

export default function PublishPanel({ isCompact = false }) {
  const { clip, clipId, edl, saveEDL } = useEditorStore();
  const [title, setTitle] = useState(clip?.title || '');
  const [tags, setTags] = useState(clip?.hashtags || '#Shorts #Reels #Gaming');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  const handleSaveMeta = async () => {
    try {
      await updateClip(clipId, { title, hashtags: tags });
      setStatusMsg('Title & tags saved!');
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  };

  const handlePost = async () => {
    if (!confirm('Post clip immediately to all mapped channels?')) return;
    setLoading(true);
    try {
      await saveEDL();
      await postClipNow(clipId);
      setStatusMsg('Posted successfully!');
    } catch (e) {
      alert('Posting failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQueue = async () => {
    setLoading(true);
    try {
      await saveEDL();
      await queueClip(clipId);
      setStatusMsg('Queued in Drip Calendar!');
    } catch (e) {
      alert('Queue failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-xs select-none">
      <div>
        <label className="text-[11px] uppercase font-bold text-muted tracking-wider block mb-1">
          Clip Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-raised border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="text-[11px] uppercase font-bold text-muted tracking-wider block mb-1">
          Hashtags
        </label>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="w-full bg-raised border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-accent"
        />
      </div>

      {statusMsg && (
        <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-xs text-center animate-in fade-in">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={handlePost}
          disabled={loading}
          className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 disabled:opacity-50"
        >
          <Send size={13} />
          <span>Post Now</span>
        </button>

        <button
          onClick={handleQueue}
          disabled={loading}
          className="py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold flex items-center justify-center gap-1.5 shadow-md shadow-amber-600/20 disabled:opacity-50"
        >
          <Calendar size={13} />
          <span>Queue Clip</span>
        </button>
      </div>

      <button
        onClick={handleSaveMeta}
        className="w-full py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/[0.08] font-bold"
      >
        Save Metadata
      </button>
    </div>
  );
}

