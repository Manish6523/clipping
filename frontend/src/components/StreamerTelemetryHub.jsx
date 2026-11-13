import React, { useState, useEffect, useMemo } from 'react';
import { 
  Radio, 
  Activity, 
  Volume2, 
  MessageSquare, 
  Flame, 
  Clock, 
  Layers, 
  ExternalLink, 
  Zap, 
  TrendingUp, 
  AlertCircle,
  RefreshCw,
  Tv,
  CheckCircle2,
  Sliders,
  ChevronRight
} from 'lucide-react';
import axios from 'axios';

// SVG Sparkline component (zero extra dependencies, buttery smooth GPU rendered)
function Sparkline({ data, height = 48, color = '#6366F1', fillColor = 'rgba(99, 102, 241, 0.15)', minVal = 0 }) {
  if (!data || data.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-[10px] text-slate-600 font-mono">
        Awaiting telemetry...
      </div>
    );
  }

  const values = data.map((d) => (typeof d === 'number' ? d : d.value ?? 0));
  const max = Math.max(...values, minVal + 1);
  const min = Math.min(...values, minVal);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 100 - ((v - min) / range) * 88 - 6; // leave 6% margin top & bottom
    return `${x},${y}`;
  });

  const polylinePoints = points.join(' ');
  const areaPoints = `0,100 ${polylinePoints} 100,100`;

  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
        <polygon points={areaPoints} fill={fillColor} />
        <polyline
          points={polylinePoints}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Highlight latest point */}
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].split(',')[0]}
            cy={points[points.length - 1].split(',')[1]}
            r="3"
            fill="#FFFFFF"
            stroke={color}
            strokeWidth="1.5"
          />
        )}
      </svg>
    </div>
  );
}

export default function StreamerTelemetryHub() {
  const [streamers, setStreamers] = useState({});
  const [liveHypes, setLiveHypes] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = async () => {
    try {
      const [resStreamers, resHypes] = await Promise.all([
        axios.get('/api/streamers'),
        axios.get('/api/pipeline/live-hypes').catch(() => ({ data: [] })),
      ]);
      const data = resStreamers.data || {};
      setStreamers(data);
      setLiveHypes(resHypes.data || []);

      // Auto select first live streamer, or first streamer available
      setSelectedChannel((curr) => {
        if (curr && data[curr]) return curr;
        const keys = Object.keys(data);
        const liveKey = keys.find((k) => data[k]?.is_live);
        return liveKey || keys[0] || null;
      });
    } catch (err) {
      console.error('Failed to load telemetry:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    let interval = null;
    if (autoRefresh) {
      interval = setInterval(fetchData, 4000); // 4-second real-time heartbeat
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const channelList = useMemo(() => Object.values(streamers), [streamers]);
  const activeStreamer = selectedChannel ? streamers[selectedChannel.toLowerCase()] : null;

  // Filter recent hypes for active streamer
  const channelHypes = useMemo(() => {
    if (!selectedChannel) return [];
    return (liveHypes || []).filter(
      (h) => h.channel_id?.toLowerCase() === selectedChannel.toLowerCase()
    );
  }, [liveHypes, selectedChannel]);

  // Telemetry rolling metrics
  const telemetry = activeStreamer?.telemetry || [];
  const mpsData = telemetry.map((t) => t.mps);
  const baselineData = telemetry.map((t) => t.baseline_mps);
  const audioData = telemetry.map((t) => Math.max(0, (t.audio_db || -45) + 50)); // Normalize -50dB to 0dB range

  const latestPoint = telemetry[telemetry.length - 1] || {};
  const currentMps = activeStreamer?.recent_mps || activeStreamer?.current_mps || 0;
  const baselineMps = activeStreamer?.current_mps || 1.0;
  const currentRatio = baselineMps > 0 ? (currentMps / baselineMps).toFixed(1) : '1.0';
  const audioDb = activeStreamer?.audio_peak_db ?? latestPoint.audio_db ?? -45;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* 1. Header Bar with Real-Time Pulse & Stream Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 border border-white/10 rounded-2xl p-5 shadow-xl backdrop-blur-sm">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-gradient-to-br from-indigo-500/20 to-purple-500/10 border border-indigo-500/30 rounded-2xl text-indigo-400 shadow-inner">
            <Activity size={24} className="animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">Stream Pulse & Live Telemetry</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> Real-Time 4s
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
              Live chat velocity waves, scream/volume peaks, ring-buffer health, and AI trigger logs.
            </p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
              autoRefresh
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            <Activity size={13} /> {autoRefresh ? 'Live Stream: ON' : 'Paused'}
          </button>

          <button
            type="button"
            onClick={() => {
              setRefreshing(true);
              fetchData();
            }}
            disabled={refreshing}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-white/5 transition-all"
            title="Refresh now"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 2. Streamer Switcher Strip (Horizontal Cards with Status) */}
      <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 no-scrollbar snap-x">
        {channelList.length === 0 && !loading && (
          <div className="p-4 rounded-xl border border-dashed border-white/10 text-xs text-slate-500 w-full text-center">
            No active streamers configured. Add streamers in the "Channels & Live" tab.
          </div>
        )}

        {channelList.map((ch) => {
          const isSelected = selectedChannel?.toLowerCase() === ch.channel_id?.toLowerCase();
          return (
            <button
              key={ch.channel_id}
              type="button"
              onClick={() => setSelectedChannel(ch.channel_id)}
              className={`snap-start shrink-0 min-w-[200px] sm:min-w-[220px] rounded-2xl border p-3.5 text-left transition-all ${
                isSelected
                  ? 'bg-gradient-to-br from-indigo-900/40 to-slate-900/80 border-indigo-500 shadow-lg shadow-indigo-500/15 ring-1 ring-indigo-500/30'
                  : 'bg-slate-900/40 border-white/10 hover:border-white/20 hover:bg-slate-900/70'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm text-white truncate max-w-[120px]">
                  @{ch.channel_id}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                    ch.is_live
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'bg-white/5 text-slate-500 border border-white/5'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${ch.is_live ? 'bg-rose-400 animate-pulse' : 'bg-slate-600'}`}
                  />
                  {ch.is_live ? 'LIVE' : 'OFFLINE'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono mt-1 pt-2 border-t border-white/5">
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">Chat MPS</span>
                  <span className="font-bold text-indigo-300">{ch.recent_mps || ch.current_mps || 0}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">Ring Buffer</span>
                  <span className="font-bold text-slate-300">{ch.chunks_count || 0} chunks</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 3. Main Streamer Detail Workspace */}
      {activeStreamer ? (
        <div className="space-y-6">
          {/* Top Live Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            {/* Stat 1: Current Chat Velocity */}
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 shadow-xl backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-indigo-400" /> Chat Velocity
                </span>
                <span className="text-[10px] font-mono text-indigo-400/80">MPS</span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono">{currentMps}</span>
                <span className="text-xs text-slate-500 font-mono">/ baseline {baselineMps}</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
                <TrendingUp size={12} className={Number(currentRatio) >= 2.0 ? 'text-amber-400' : 'text-slate-500'} />
                <span className={Number(currentRatio) >= 2.0 ? 'font-bold text-amber-300' : ''}>
                  {currentRatio}x baseline spike
                </span>
              </div>
            </div>

            {/* Stat 2: Audio Volume Peak */}
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 shadow-xl backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Volume2 size={14} className="text-cyan-400" /> Audio Level
                </span>
                <span className="text-[10px] font-mono text-cyan-400/80">dBFS</span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono">
                  {audioDb !== null ? `${audioDb}` : '-45'}
                </span>
                <span className="text-xs text-slate-500 font-mono">dB</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <span>Threshold: -15.0 dB</span>
              </div>
            </div>

            {/* Stat 3: 4-Min Ring Buffer Health */}
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 shadow-xl backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Layers size={14} className="text-emerald-400" /> Ring Buffer
                </span>
                <span className="text-[10px] font-mono text-emerald-400/80">.TS</span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono">
                  {activeStreamer.chunks_count || 0}
                </span>
                <span className="text-xs text-slate-500 font-mono">/ 24 max</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
                <CheckCircle2 size={12} className="text-emerald-400" />
                <span>Ready for instant 75s slice</span>
              </div>
            </div>

            {/* Stat 4: Total Moments Triggered */}
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 shadow-xl backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Flame size={14} className="text-rose-400" /> Viral Moments
                </span>
                <span className="text-[10px] font-mono text-rose-400/80">Session</span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono">{channelHypes.length}</span>
                <span className="text-xs text-slate-500 font-mono">triggers</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
                <span className="text-emerald-400 font-bold">
                  {channelHypes.filter((h) => h.status === 'passed').length} passed
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-500">
                  {channelHypes.filter((h) => h.status === 'rejected').length} rejected
                </span>
              </div>
            </div>
          </div>

          {/* 4. Real-Time Telemetry Graphs (2-Column Grid) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Graph A: Live Chat Velocity Spikes */}
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 shadow-xl backdrop-blur-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-indigo-400" />
                  <h3 className="text-sm font-bold text-white">Chat Speed Waveform (MPS)</h3>
                </div>
                <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                  Recent 5-10 Mins
                </span>
              </div>

              <div className="bg-slate-950/70 border border-white/5 rounded-xl p-3 pt-5">
                <Sparkline
                  data={mpsData.length > 0 ? mpsData : [0, 0]}
                  height={130}
                  color="#818CF8"
                  fillColor="rgba(129, 140, 248, 0.12)"
                />
                <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 mt-2 pt-2 border-t border-white/5">
                  <span>Oldest</span>
                  <span className="text-indigo-300 font-bold">Latest: {currentMps} msg/sec</span>
                  <span>Now</span>
                </div>
              </div>
            </div>

            {/* Graph B: Stream Audio Scream/Peak Level Waveform */}
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 shadow-xl backdrop-blur-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 size={16} className="text-cyan-400" />
                  <h3 className="text-sm font-bold text-white">Audio Loudness & Scream Peaks</h3>
                </div>
                <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full">
                  Dynamic Volume
                </span>
              </div>

              <div className="bg-slate-950/70 border border-white/5 rounded-xl p-3 pt-5">
                <Sparkline
                  data={audioData.length > 0 ? audioData : [0, 0]}
                  height={130}
                  color="#22D3EE"
                  fillColor="rgba(34, 211, 238, 0.12)"
                />
                <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 mt-2 pt-2 border-t border-white/5">
                  <span>-50 dBFS</span>
                  <span className="text-cyan-300 font-bold">Peak: {audioDb} dBFS</span>
                  <span>0 dBFS</span>
                </div>
              </div>
            </div>
          </div>

          {/* 5. Trigger History Table for Active Streamer */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 shadow-xl backdrop-blur-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame size={16} className="text-amber-400" />
                <h3 className="text-sm font-bold text-white">Session Triggered Moments & Decisions</h3>
              </div>
              <span className="text-xs text-slate-400">@{activeStreamer.channel_id}</span>
            </div>

            {channelHypes.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 font-mono">
                No spike triggers recorded yet for this session. Listening to live chat...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 text-[10px] uppercase font-bold">
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Trigger Type</th>
                      <th className="py-2.5 px-3">Velocity / Peak</th>
                      <th className="py-2.5 px-3">AI Score</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Transcript Snippet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono">
                    {channelHypes.slice(0, 10).map((h) => (
                      <tr key={h.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                          {h.created_at ? new Date(h.created_at).toLocaleTimeString() : 'Just now'}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 border border-white/10 text-slate-300">
                            {h.trigger_type || 'chat_spike'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-white font-bold whitespace-nowrap">
                          {h.trigger_value ? `${h.trigger_value} MPS` : '--'}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {h.virality_score != null ? (
                            <span
                              className={`font-bold ${
                                h.virality_score >= (h.threshold_value || 65)
                                  ? 'text-emerald-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {h.virality_score}/100
                            </span>
                          ) : (
                            <span className="text-slate-600">--</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              h.status === 'passed'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : h.status === 'force_passed'
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {h.status?.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 font-sans truncate max-w-[260px]">
                          {h.transcript_text || h.rejection_reason || 'Evaluating audio...'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-12 text-center text-slate-500 text-sm">
          Select a streamer above to inspect live waveform telemetry.
        </div>
      )}
    </div>
  );
}
