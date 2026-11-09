import React, { useState, useEffect } from 'react';
import { 
  GitBranch, 
  Cpu, 
  Brain, 
  Sparkles, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  ChevronRight, 
  Activity,
  Layers,
  Terminal,
  FileText,
  RotateCcw,
  Scissors
} from 'lucide-react';
import axios from 'axios';
import { getLiveHypes, forceRenderHype } from '../api';

export default function PipelineMonitor() {
  const [runs, setRuns] = useState([]);
  const [liveHypes, setLiveHypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedHype, setSelectedHype] = useState(null);
  const [activeTab, setActiveTab] = useState('live_hypes');
  const [filterActiveOnly, setFilterActiveOnly] = useState(true);
  const [forcingId, setForcingId] = useState(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, [filterActiveOnly]);

  const fetchData = async () => {
    try {
      const [runsRes, hypesData] = await Promise.all([
        axios.get('/api/pipeline/runs'),
        getLiveHypes().catch(() => [])
      ]);
      const allRuns = runsRes.data || [];
      const displayed = filterActiveOnly 
        ? allRuns.filter(r => r.status === 'running' || r.status === 'processing' || r.status === 'triggered') 
        : allRuns;
      
      setRuns(displayed);
      setLiveHypes(hypesData || []);
      if (displayed.length > 0) {
        setSelectedRun(prev => (prev && displayed.some(r => r.id === prev.id) ? prev : displayed[0]));
      }
    } catch (err) {
      console.error('Failed fetching pipeline data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleForceRender = async (hypeId) => {
    if (!confirm('Force render this highlight ignoring the AI rejection filter?')) return;
    setForcingId(hypeId);
    try {
      const res = await forceRenderHype(hypeId);
      if (res.success) {
        alert(`Clip #${res.clip_id} generated successfully! Check Review Station.`);
        await fetchData();
      } else {
        alert('Force render failed: ' + (res.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Error triggering render: ' + e.message);
    } finally {
      setForcingId(null);
    }
  };

  const PIPELINE_STEPS = [
    {
      step: 1,
      name: 'Transcribe & Word Snapping',
      engine: 'faster-whisper (CTranslate2)',
      input: 'Audio track extracted from source video (16kHz mono WAV)',
      output: 'Word-level timestamps (w, s, e) mapped to strict Sentence objects',
      prompt: null,
      notes: 'Terminal punctuation (. ! ?), segment borders, or pauses >= 0.7s define boundaries.'
    },
    {
      step: 2,
      name: 'Multi-Signal Heat & Fallback',
      engine: 'HeatCurve Engine (SciPy/NumPy / Math)',
      input: 'YouTube retention heatmap, audio dB peaks, live chat velocity',
      output: '1s continuous heat curve H(t) with Gaussian smoothing (sigma=3s) + peak seeds',
      prompt: null,
      notes: 'Fallback 90s overlapping windows (30s overlap) generated if signals are absent.'
    },
    {
      step: 3,
      name: 'Boundary Snapping Search',
      engine: 'BoundarySnapper',
      input: 'Peak seeds + valid sentences within [seed-35s, seed+30s]',
      output: 'Clean [start, end] window aligned to sentence edges + lead-in (0.4s) & tail (0.5s)',
      prompt: null,
      notes: 'Dangling conjunctions ("and", "so", "but") at the start receive a heavy penalty.'
    },
    {
      step: 4,
      name: 'Temporal & Content Dedupe',
      engine: 'Deduplicator',
      input: 'Snapped candidate windows',
      output: 'Deduplicated candidate pool',
      prompt: null,
      notes: 'Intersection over min(len_a, len_b) > 0.25 drops lower-scoring overlaps.'
    },
    {
      step: 5,
      name: 'Stage A: LLM Triage',
      engine: 'Gemini 2.5 Flash',
      input: 'Batch of 15-25 candidate moments with compact transcripts & heat scores',
      output: 'JSON: { id, triage_score (0-10), keep (bool), one_line_reason }',
      prompt: 'Prompt: STAGE_A_TRIAGE_SYSTEM (Rate viral potential, drop monotone chatter)',
      notes: 'Cuts candidate volume by 50% to conserve Stage B detail tokens.'
    },
    {
      step: 6,
      name: 'Stage B: LLM Detail & Hook Verification',
      engine: 'Gemini 2.5 Flash (Structured Outputs)',
      input: 'Survivors with 20s pre-context, 10s post-context, and allowed Sentence IDs',
      output: 'Sentence IDs for start/end, predicted score (0-100), title, hook copy, safety flags',
      prompt: 'Prompt: STAGE_B_DETAIL_SYSTEM (Enforces 2-Second Hook rule, STANDS ALONE completeness)',
      notes: 'Returns start_sentence_id and end_sentence_id. Zero timestamp hallucinations possible.'
    },
    {
      step: 7,
      name: 'Maximal Marginal Relevance (MMR) Selection',
      engine: 'CandidateSelector',
      input: 'Detail-scored candidates',
      output: 'Final diverse clips sent to Review Station / Rendering Queue',
      prompt: null,
      notes: 'Formula: Score - (lambda * MaxSimilarityToSelected). Enforces 60s minimum gap.'
    }
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#3b82f6] to-[#06b6d4] flex items-center justify-center text-white shadow-lg shadow-cyan-500/10">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Pipeline Studio & Step Monitor
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-400">
                  Active
                </span>
              </h1>
              <p className="text-sm text-slate-400">
                Inspect live candidate progression, AI model prompts, inputs, outputs, and boundary decisions.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('live_hypes')}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'live_hypes'
                ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🔥 Live Stream Hypes &amp; Rejections ({liveHypes.length})
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'architecture'
                ? 'bg-slate-800 text-white border border-slate-700'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Step-by-Step Architecture
          </button>
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'overview'
                ? 'bg-slate-800 text-white border border-slate-700'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            VOD Execution Runs
          </button>
        </div>
      </div>

      {activeTab === 'live_hypes' ? (
        <div className="space-y-4">
          <div className="bg-[#0f172a]/60 border border-slate-800 rounded-xl p-5 mb-4">
            <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <Activity className="w-5 h-5 text-amber-400" />
              Live Hype Moments Filter &amp; Rejection Inspector
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Every live audio peak and chat spike captured from your monitored streamers is listed below. Inspect which moments passed into rendering, which were filtered out by the AI Judge rubric, and hit <strong>Force Render</strong> to override any rejection.
            </p>
          </div>

          {liveHypes.length === 0 ? (
            <div className="p-12 text-center text-slate-500 bg-slate-900/40 rounded-xl border border-slate-800 text-sm">
              No live moments recorded yet. They will appear here in real-time as your watched streamers trigger chat or audio spikes!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {liveHypes.map((hype) => {
                const isPassed = hype.status === 'passed' || hype.status === 'force_passed';
                return (
                  <div 
                    key={hype.id} 
                    className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                      isPassed 
                        ? 'bg-emerald-950/20 border-emerald-500/30' 
                        : 'bg-rose-950/20 border-rose-500/30'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-extrabold text-white text-sm">
                          @{hype.channel_id}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          isPassed 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}>
                          {hype.status === 'force_passed' ? 'FORCED RENDER' : isPassed ? 'PASSED TO RENDER' : 'FILTERED OUT'}
                        </span>
                      </div>

                      <div className="text-xs text-slate-300 font-mono mb-2">
                        Trigger: <span className="text-[#8FD3FF] font-bold">{hype.trigger_type}</span> | Score: <span className="font-bold text-amber-400">{hype.virality_score}/100</span> (Min: {hype.threshold_value})
                      </div>

                      {hype.rejection_reason && (
                        <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs mb-2">
                          <span className="font-bold block text-[10px] uppercase text-rose-400 mb-0.5">Rejection Gate: {hype.gate_failed || 'Gate 4'}</span>
                          {hype.rejection_reason}
                        </div>
                      )}

                      {hype.transcript_text && (
                        <div className="text-[11px] text-slate-400 italic bg-black/40 p-2 rounded-lg border border-white/5 line-clamp-3">
                          "{hype.transcript_text}"
                        </div>
                      )}

                      {hype.rubric && Object.keys(hype.rubric).length > 0 && (
                        <div className="grid grid-cols-3 gap-1.5 mt-2.5 text-[10px] font-mono text-slate-300">
                          {Object.entries(hype.rubric).slice(0, 6).map(([k, v]) => (
                            <div key={k} className="p-1 rounded bg-white/5 truncate">
                              {k.replace('_', ' ')}: <strong className="text-white">{v}/5</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[10px] text-slate-400">
                      <span>{new Date(hype.created_at).toLocaleTimeString()}</span>
                      {!isPassed && (
                        <button
                          onClick={() => handleForceRender(hype.id)}
                          disabled={forcingId === hype.id}
                          className="flex items-center gap-1 px-3 py-1 rounded-lg bg-gradient-to-r from-amber-400 to-amber-500 text-black font-extrabold text-xs shadow-md shadow-amber-500/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                        >
                          <Scissors size={11} className={forcingId === hype.id ? 'animate-spin' : ''} />
                          <span>{forcingId === hype.id ? 'Rendering...' : 'Force Render'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : activeTab === 'architecture' ? (
        <div className="space-y-4">
          <div className="bg-[#0f172a]/60 border border-slate-800 rounded-xl p-5 mb-6">
            <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <Brain className="w-5 h-5 text-cyan-400" />
              How AutoClip Selects the Best Moments
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Every video or stream passes through a deterministic 7-stage pipeline. Hallucinations are prevented by constraining the AI to select discrete <strong>Sentence IDs</strong> rather than floating-point seconds.
            </p>
          </div>

          <div className="grid gap-4">
            {PIPELINE_STEPS.map((s) => (
              <div key={s.step} className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 font-bold flex items-center justify-center text-sm">
                      {s.step}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">{s.name}</h3>
                      <p className="text-xs text-cyan-400 flex items-center gap-1 mt-0.5">
                        <Cpu className="w-3.5 h-3.5" /> Engine: {s.engine}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
                    <span className="text-slate-500 font-medium block mb-1">INPUT:</span>
                    <span className="text-slate-300">{s.input}</span>
                  </div>
                  <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
                    <span className="text-slate-500 font-medium block mb-1">OUTPUT:</span>
                    <span className="text-slate-300">{s.output}</span>
                  </div>
                </div>

                {s.prompt && (
                  <div className="mt-3 bg-cyan-950/20 border border-cyan-900/40 p-3 rounded-lg text-xs text-cyan-300 font-mono">
                    <Terminal className="w-3.5 h-3.5 inline mr-1.5" />
                    {s.prompt}
                  </div>
                )}

                <div className="mt-3 text-xs text-slate-400 italic">
                  💡 {s.notes}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Recent Runs */}
          <div className="lg:col-span-1 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                {filterActiveOnly ? 'Active Pipelines' : 'All Runs'} ({runs.length})
              </h2>
              <button
                onClick={() => setFilterActiveOnly(!filterActiveOnly)}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 font-medium underline"
              >
                {filterActiveOnly ? 'Show Completed History' : 'Active Only'}
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center p-8">
                <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : runs.length === 0 ? (
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-sm">
                {filterActiveOnly ? 'No active pipelines currently running. All tasks completed!' : 'No pipeline runs recorded.'}
              </div>
            ) : (
              <div className="space-y-2 max-h-[650px] overflow-y-auto pr-1">
                {runs.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => setSelectedRun(r)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      selectedRun?.id === r.id
                        ? 'bg-cyan-950/30 border-cyan-600/80 text-white shadow-md'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-xs text-cyan-400 font-semibold">{r.id}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400">
                        {r.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-300 font-medium truncate">
                      Source: {r.source_id}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
                      <span>Clips: {r.candidates_count}</span>
                      <span>{r.latency_seconds}s</span>
                      <span>{new Date(r.created_at).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Run Details */}
          <div className="lg:col-span-2">
            {selectedRun ? (
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      Run Details: <span className="font-mono text-cyan-400">{selectedRun.id}</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Target Channel: <span className="text-slate-200">{selectedRun.channel_id}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400 block">Prompt Engine</span>
                    <span className="text-xs font-mono font-medium text-purple-400">{selectedRun.prompt_version || 'v2.0_best_clips'}</span>
                  </div>
                </div>

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg text-center">
                    <span className="text-slate-400 text-xs block mb-1">Clips Generated</span>
                    <span className="text-xl font-bold text-white">{selectedRun.candidates_count}</span>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg text-center">
                    <span className="text-slate-400 text-xs block mb-1">Latency</span>
                    <span className="text-xl font-bold text-cyan-400">{selectedRun.latency_seconds}s</span>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg text-center">
                    <span className="text-slate-400 text-xs block mb-1">Stage Status</span>
                    <span className="text-xl font-bold text-emerald-400 capitalize">{selectedRun.status}</span>
                  </div>
                </div>

                {/* Full Execution Flow Status */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Execution Pipeline Checklist
                    </h3>
                    {selectedRun.stage && (
                      <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/80 px-2.5 py-0.5 rounded-full">
                        {selectedRun.stage}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {[
                      { stepNum: 1, name: 'Word-Level Transcription & Sentence Mapping' },
                      { stepNum: 2, name: 'Multi-Signal Heat Curve & Overlap Windows' },
                      { stepNum: 3, name: 'Sentence Boundary Snapper Search' },
                      { stepNum: 3, name: 'Temporal (25%) & Content Deduplication' },
                      { stepNum: 4, name: 'Stage A: Gemini Flash Triage Evaluation' },
                      { stepNum: 4, name: 'Stage B: 2-Second Hook & Standalone Check' },
                      { stepNum: 5, name: 'Maximal Marginal Relevance (MMR) & Final Rendering' },
                    ].map((step, idx) => {
                      const curStep = selectedRun.step || (selectedRun.status === 'completed' ? 5 : 2);
                      const isCompleted = selectedRun.status === 'completed' || curStep > step.stepNum;
                      const isInProgress = selectedRun.status === 'running' && curStep === step.stepNum;

                      return (
                        <div 
                          key={idx} 
                          className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all ${
                            isInProgress 
                              ? 'bg-cyan-950/40 border-cyan-500/80 shadow-sm shadow-cyan-500/10'
                              : isCompleted 
                              ? 'bg-slate-950/50 border-slate-800/80' 
                              : 'bg-slate-950/20 border-slate-900 opacity-40'
                          }`}
                        >
                          {isInProgress ? (
                            <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin shrink-0" />
                          ) : isCompleted ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <Clock className="w-4 h-4 text-slate-600 shrink-0" />
                          )}
                          <span className={`text-xs font-medium ${isInProgress ? 'text-cyan-300 font-semibold' : isCompleted ? 'text-slate-300' : 'text-slate-500'}`}>
                            {step.name}
                          </span>
                          <span className={`ml-auto text-[10px] font-mono px-2 py-0.5 rounded ${
                            isInProgress 
                              ? 'text-cyan-400 bg-cyan-950 border border-cyan-800 animate-pulse'
                              : isCompleted 
                              ? 'text-emerald-500 bg-emerald-950/40' 
                              : 'text-slate-600'
                          }`}>
                            {isInProgress ? 'IN PROGRESS' : isCompleted ? 'COMPLETE' : 'PENDING'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-sm">
                Select a run from the list to view its complete intelligence trace.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

