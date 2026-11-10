import React, { useState, useEffect } from 'react';
import { Calendar, Clock, CheckCircle2, AlertCircle, Send } from 'lucide-react';
import { getQueue, postClipNow } from '../api';

export default function QueueCalendar() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchQueue = async () => {
    try {
      const data = await getQueue();
      setQueue(data);
    } catch (err) {
      console.error('Failed to load queue:', err);
    }
  };

  const handlePublishNow = async (clipId) => {
    if (!confirm(`Force publish scheduled clip #${clipId} right now?`)) return;
    setLoading(true);
    try {
      const res = await postClipNow(clipId);
      if (res?.success) {
        alert(`Clip #${clipId} published successfully!`);
      } else {
        const errMsg = res?.error || 'Publishing failed. Check channel quota or account configuration.';
        alert(`❌ Publishing Failed for Clip #${clipId}:\n\n${errMsg}`);
      }
      fetchQueue();
    } catch (err) {
      alert('Publish failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-black text-white flex items-center gap-2">
          <Calendar className="text-amber-500" /> Drip-Feed Queue Calendar
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Automated interval publishing distribution to YouTube Shorts and Instagram Reels.
        </p>
      </div>

      <div className="bg-slate-900/60 border border-white/10 rounded-xl overflow-x-auto shadow-2xl custom-scrollbar">
        <table className="w-full text-left text-xs min-w-[650px]">
          <thead className="bg-slate-950/80 text-slate-400 font-bold uppercase tracking-wider border-b border-white/10">
            <tr>
              <th className="py-3 px-4">Clip ID</th>
              <th className="py-3 px-4">Title</th>
              <th className="py-3 px-4">Scheduled Slot</th>
              <th className="py-3 px-4">YouTube Status</th>
              <th className="py-3 px-4">Instagram Status</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {queue.length === 0 ? (
              <tr>
                <td colSpan="6" className="py-12 text-center text-slate-500">
                  No upcoming clips scheduled in the drip queue. Approve clips in the Review Station to enqueue them.
                </td>
              </tr>
            ) : (
              queue.map((item) => (
                <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-white">
                    #{item.clip_id}
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-slate-200">
                    {item.title || 'Untitled Clip'}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-amber-400 flex items-center gap-1.5">
                    <Clock size={13} /> {item.scheduled_time}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      item.yt_status === 'published' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-slate-400'
                    }`}>
                      {item.yt_status}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      item.ig_status === 'published' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-slate-400'
                    }`}>
                      {item.ig_status}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => handlePublishNow(item.clip_id)}
                      disabled={loading}
                      className="inline-flex items-center gap-1 bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-300 hover:text-white px-2.5 py-1 rounded text-xs font-semibold transition-all"
                    >
                      <Send size={12} /> Force Post
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

