import React, { useState, useEffect, useMemo } from 'react';
import { 
  Radio, 
  Activity, 
  Volume2, 
  Flame, 
  Clock, 
  Layers, 
  ExternalLink, 
  Zap, 
  TrendingUp, 
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Sliders,
  Filter,
  BarChart2,
  Info,
  Maximize2,
  ShieldCheck,
  Disc,
  ArrowUpRight
} from 'lucide-react';
import axios from 'axios';

// High-precision SVG Waveform with grid lines, gradient, and glow point
function TelemetryWaveform({
  data = [],
  height = 140,
  strokeColor = '#60A5FA',
  gradientFrom = 'rgba(96, 165, 250, 0.28)',
  gradientTo = 'rgba(96, 165, 250, 0.0)',
  minVal = 0,
  unit = '',
  yLabels = [],
  thresholdVal = null,
  thresholdColor = '#F59E0B'
}) {
  const values = data.length > 0 ? data.map(d => (typeof d === 'number' ? d : d.value ?? 0)) : [0, 0];
  const max = Math.max(...values, minVal + 1);
  const min = Math.min(...values, minVal);
  const range = max - min || 1;

  // Build SVG path points
  const points = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * 100 : 50;
    const y = 92 - ((v - min) / range) * 82; // 10% padding top, 8% bottom
    return { x, y, v };
  });

  const polylineStr = points.map(p => `${p.x},${p.y}`).join(' ');
  const areaStr = `0,100 ${polylineStr} 100,100`;

  // Threshold Y coordinate if present
  const thresholdY = thresholdVal !== null 
    ? 92 - ((thresholdVal - min) / range) * 82 
    : null;

  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-[#0A0D14]/90 border border-white/[0.06] p-3">
      {/* Background Subtle Grid Lines */}
      <div className="absolute inset-0 flex flex-col justify-between pointer-events-none p-3 opacity-20">
        <div className="border-b border-dashed border-white/20 w-full h-0" />
        <div className="border-b border-dashed border-white/20 w-full h-0" />
        <div className="border-b border-dashed border-white/20 w-full h-0" />
      </div>

      {/* SVG Canvas */}
      <div style={{ height }} className="relative w-full">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={`grad-${strokeColor.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gradientFrom} />
              <stop offset="100%" stopColor={gradientTo} />
            </linearGradient>
            <filter id={`glow-${strokeColor.replace('#', '')}`} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor={strokeColor} floodOpacity="0.6" />
            </filter>
          </defs>

          {/* Area Fill */}
          <polygon points={areaStr} fill={`url(#grad-${strokeColor.replace('#', '')})`} />

          {/* Optional Threshold Dotted Line */}
          {thresholdY !== null && thresholdY >= 0 && thresholdY <= 100 && (
            <line 
              x1="0" 
              y1={thresholdY} 
              x2="100" 
              y2={thresholdY} 
              stroke={thresholdColor} 
              strokeWidth="0.8" 
              strokeDasharray="2,2" 
              opacity="0.85" 
            />
          )}

          {/* Line Stroke */}
          <polyline
            points={polylineStr}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#glow-${strokeColor.replace('#', '')})`}
          />

          {/* Glowing Head Point */}
          {points.length > 0 && (
            <g>
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].y}
                r="3"
                fill="#FFFFFF"
                stroke={strokeColor}
                strokeWidth="1.5"
              />
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].y}
                r="6"
                fill={strokeColor}
                opacity="0.35"
                className="animate-ping"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Axis Footer */}
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mt-2 pt-1.5 border-t border-white/[0.04]">
        <span>{yLabels[0] || 'Historical'}</span>
        <span className="font-bold text-slate-300">
          Current: {values[values.length - 1] ?? 0} {unit}
        </span>
        <span>{yLabels[1] || 'Real-time'}</span>
      </div>
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
      interval = setInterval(fetchData, 3500);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const channelList = useMemo(() => Object.values(streamers), [streamers]);
  const activeStreamer = selectedChannel ? streamers[selectedChannel.toLowerCase()] : null;

  // Filter session hypes for this streamer
  const channelHypes = useMemo(() => {
    if (!selectedChannel) return [];
    return (liveHypes || []).filter(
      (h) => h.channel_id?.toLowerCase() === selectedChannel.toLowerCase()
    );
  }, [liveHypes, selectedChannel]);

  // Rolling telemetry points
  const telemetry = activeStreamer?.telemetry || [];
  const mpsData = telemetry.map((t) => t.mps);
  const audioData = telemetry.map((t) => (t.audio_db !== null ? t.audio_db : -45));

  const latestPoint = telemetry[telemetry.length - 1] || {};
  const currentMps = activeStreamer?.recent_mps ?? activeStreamer?.current_mps ?? 0;
  const baselineMps = activeStreamer?.current_mps ? Number(activeStreamer.current_mps).toFixed(1) : '1.0';
  const ratio = baselineMps > 0 ? (currentMps / baselineMps).toFixed(1) : '1.0';
  const audioDb = activeStreamer?.audio_peak_db ?? latestPoint.audio_db ?? -45;
  const chunksCount = activeStreamer?.chunks_count || 0;

  // Derived classification
  const isSpike = Number(ratio) >= 1.6 || activeStreamer?.is_spike;
  const isAudioLoud = audioDb > -18;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <Activity className="text-[#8FD3FF] animate-pulse" size={22} />
              <span>Stream Telemetry &amp; Live Pulse</span>
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#8FD3FF]/10 text-[#8FD3FF] border border-[#8FD3FF]/25">
              PRO MONITOR
            </span>
          </div>
          <p className="text-xs text-[#8B90A0] mt-1">
            Real-time chat velocity curves, audio scream detection, ring buffer memory status, and AI candidate scoring.
          </p>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 ${
              autoRefresh
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-white/[0.04] border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`} />
            <span>{autoRefresh ? 'Live Polling 3.5s' : 'Polling Paused'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setRefreshing(true);
              fetchData();
            }}
            disabled={refreshing}
            className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/10 transition-all"
            title="Refresh now"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 2. Streamer Selection Deck (Clean studio tab bar) */}
      <div className="space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
          <span>Active Channels &amp; Monitored Feeds ({channelList.length})</span>
          <span className="text-[10px] text-slate-500">Click a card to switch telemetry feed</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {channelList.map((ch) => {
            const isSelected = selectedChannel?.toLowerCase() === ch.channel_id?.toLowerCase();
            const isLive = Boolean(ch.is_live);
            return (
              <button
                key={ch.channel_id}
                type="button"
                onClick={() => setSelectedChannel(ch.channel_id)}
                className={`relative rounded-xl p-3 text-left transition-all border ${
                  isSelected
                    ? 'bg-[#181C26] border-[#8FD3FF]/60 shadow-lg shadow-[#8FD3FF]/10 ring-1 ring-[#8FD3FF]/30'
                    : 'bg-[#0E1118] border-white/[0.06] hover:border-white/20 hover:bg-[#131722]'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className="font-extrabold text-xs text-white truncate">
                    @{ch.channel_id}
                  </span>
                  {isLive ? (
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" title="Live Now" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-600" title="Offline" />
                  )}
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span className={ch.recent_mps > 5 ? 'text-amber-400 font-bold' : ''}>
                    {ch.recent_mps || 0} MPS
                  </span>
                  <span className="text-slate-500">
                    {ch.chunks_count || 0} cks
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Detail Telemetry Workspace */}
      {activeStreamer ? (
        <div className="space-y-5">
          {/* Channel Banner / Identity Bar */}
          <div className="bg-[#0E1118] border border-white/[0.08] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-violet-600/30 to-indigo-600/20 border border-violet-500/30 flex items-center justify-center text-white font-black text-base shadow-inner">
                {activeStreamer.channel_id.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-lg text-white tracking-tight">@{activeStreamer.channel_id}</span>
                  {activeStreamer.is_live ? (
                    <span className="px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/30 text-rose-300 font-black text-[10px] tracking-wider uppercase flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" /> LIVE
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/10 text-slate-400 font-bold text-[10px]">
                      STANDBY
                    </span>
                  )}
                  {isSpike && (
                    <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 font-black text-[10px] uppercase animate-pulse">
                      ⚡ VELOCITY SPIKE
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                  <span>Template: <strong className="text-indigo-300">{activeStreamer.template_name || 'Default'}</strong></span>
                  <span>•</span>
                  <span>Platform: <strong className="text-slate-300">{activeStreamer.platform || 'Twitch'}</strong></span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={activeStreamer.platform === 'youtube' ? `https://youtube.com/@${activeStreamer.channel_id}` : `https://twitch.tv/${activeStreamer.channel_id}`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/10 text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <span>Watch Feed</span>
                <ArrowUpRight size={13} />
              </a>
            </div>
          </div>

          {/* 4 Quick Stat Metric Meters */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Card 1: Chat Speed */}
            <div className="bg-[#0E1118] border border-white/[0.06] rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs font-bold">
                <span className="flex items-center gap-1.5">
                  <Activity size={14} className="text-[#8FD3FF]" /> Chat Velocity
                </span>
                <span className="text-[10px] font-mono text-[#8FD3FF]">MPS</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono">{currentMps}</span>
                <span className="text-xs text-slate-500 font-mono">/ base {baselineMps}</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                  Number(ratio) >= 1.6 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-white/[0.04] text-slate-400'
                }`}>
                  {ratio}x
                </span>
                <span className="text-slate-400">{Number(ratio) >= 1.6 ? 'High excitement' : 'Normal chatter'}</span>
              </div>
            </div>

            {/* Card 2: Audio Loudness */}
            <div className="bg-[#0E1118] border border-white/[0.06] rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs font-bold">
                <span className="flex items-center gap-1.5">
                  <Volume2 size={14} className="text-cyan-400" /> Peak Loudness
                </span>
                <span className="text-[10px] font-mono text-cyan-400">dBFS</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono">{audioDb}</span>
                <span className="text-xs text-slate-500 font-mono">dB</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                  isAudioLoud ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-white/[0.04] text-slate-400'
                }`}>
                  {isAudioLoud ? 'SCREAM / ACTION' : 'NORMAL LEVEL'}
                </span>
                <span className="text-slate-500 text-[10px]">Gate: -15 dB</span>
              </div>
            </div>

            {/* Card 3: Ring Buffer */}
            <div className="bg-[#0E1118] border border-white/[0.06] rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs font-bold">
                <span className="flex items-center gap-1.5">
                  <Layers size={14} className="text-emerald-400" /> Ring Buffer
                </span>
                <span className="text-[10px] font-mono text-emerald-400">TS Chunks</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono">{chunksCount}</span>
                <span className="text-xs text-slate-500 font-mono">/ 24 (~4m)</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
                <CheckCircle2 size={12} className={chunksCount >= 5 ? 'text-emerald-400' : 'text-slate-500'} />
                <span>{chunksCount >= 5 ? 'Ready for 75s slice' : 'Buffering segments...'}</span>
              </div>
            </div>

            {/* Card 4: Viral Triggers */}
            <div className="bg-[#0E1118] border border-white/[0.06] rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs font-bold">
                <span className="flex items-center gap-1.5">
                  <Flame size={14} className="text-rose-400" /> Hype Moments
                </span>
                <span className="text-[10px] font-mono text-rose-400">Today</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono">{channelHypes.length}</span>
                <span className="text-xs text-slate-500 font-mono">captured</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-2">
                <span className="text-emerald-400 font-bold">
                  {channelHypes.filter(h => h.status === 'passed' || h.status === 'force_passed').length} rendered
                </span>
                <span>•</span>
                <span className="text-slate-500">
                  {channelHypes.filter(h => h.status === 'rejected').length} filtered
                </span>
              </div>
            </div>
          </div>

          {/* 2 Real-Time Waveform Displays (Dual Grid) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Waveform A: Chat Velocity History */}
            <div className="bg-[#0E1118] border border-white/[0.08] rounded-2xl p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Activity size={16} className="text-[#8FD3FF]" />
                    <span>Live Chat Velocity Curve</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Rolling 60-datapoint sample (Messages Per Second)
                  </p>
                </div>
                <span className="text-[10px] font-mono text-[#8FD3FF] bg-[#8FD3FF]/10 border border-[#8FD3FF]/20 px-2 py-0.5 rounded-full">
                  Chat Spike Detector
                </span>
              </div>

              <TelemetryWaveform
                data={mpsData.length > 0 ? mpsData : [0, 0]}
                height={150}
                strokeColor="#8FD3FF"
                gradientFrom="rgba(143, 211, 255, 0.3)"
                gradientTo="rgba(143, 211, 255, 0.0)"
                unit="MPS"
                minVal={0}
                thresholdVal={baselineMps * 1.6}
                thresholdColor="#F59E0B"
                yLabels={['Historical (5m ago)', 'Latest']}
              />
            </div>

            {/* Waveform B: Audio Peak & Screams */}
            <div className="bg-[#0E1118] border border-white/[0.08] rounded-2xl p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Volume2 size={16} className="text-cyan-400" />
                    <span>Stream Audio Peak Level (dBFS)</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Audio loudness telemetry normalized from -50 dBFS to 0 dBFS
                  </p>
                </div>
                <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full">
                  Scream Detection
                </span>
              </div>

              <TelemetryWaveform
                data={audioData.length > 0 ? audioData : [-45, -45]}
                height={150}
                strokeColor="#22D3EE"
                gradientFrom="rgba(34, 211, 238, 0.3)"
                gradientTo="rgba(34, 211, 238, 0.0)"
                unit="dBFS"
                minVal={-50}
                thresholdVal={-15}
                thresholdColor="#EF4444"
                yLabels={['-50 dBFS', '0 dBFS (Max)']}
              />
            </div>
          </div>

          {/* Session Triggered Highlights Table */}
          <div className="bg-[#0E1118] border border-white/[0.08] rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Flame size={16} className="text-amber-400" />
                  <span>Session Hype Candidates &amp; Decisions</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Moments captured by chat spikes, keyword triggers, or audio screams for @{activeStreamer.channel_id}
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {channelHypes.length} events logged
              </span>
            </div>

            {channelHypes.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500 font-mono border border-dashed border-white/[0.06] rounded-xl">
                No trigger events recorded for this session yet. Waiting for chat acceleration or volume spike...
              </div>
            ) : (
              <div className="overflow-x-auto border border-white/[0.06] rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#12151E] text-slate-400 text-[10px] uppercase font-bold border-b border-white/[0.06]">
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Trigger Type</th>
                      <th className="py-2.5 px-3">Velocity / Peak</th>
                      <th className="py-2.5 px-3">Gemini AI Score</th>
                      <th className="py-2.5 px-3">Pipeline Decision</th>
                      <th className="py-2.5 px-3">Context / Transcript</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] font-mono">
                    {channelHypes.slice(0, 15).map((h) => {
                      const isPassed = h.status === 'passed' || h.status === 'force_passed';
                      return (
                        <tr key={h.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                            {h.created_at ? new Date(h.created_at).toLocaleTimeString() : 'Just now'}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/[0.05] border border-white/10 text-slate-200">
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
                                isPassed
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              {h.status?.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 font-sans truncate max-w-[280px]">
                            {h.transcript_text || h.rejection_reason || 'Evaluating audio...'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="py-16 text-center text-slate-500 text-sm border border-dashed border-white/10 rounded-2xl">
          Select a channel above to inspect live telemetry.
        </div>
      )}
    </div>
  );
}
