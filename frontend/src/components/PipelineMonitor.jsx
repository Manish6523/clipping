import React, { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, Cpu, Brain, CheckCircle2, Clock, Activity, Terminal, Scissors, Flame, XCircle, Layers,
} from 'lucide-react';
import axios from 'axios';
import { getLiveHypes, forceRenderHype } from '../api';
import {
  Page, Panel, Segmented, Pill, Badge, Button, EmptyState, Skeleton, Stat, Confirm, Notice, Spinner,
} from './ui';

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

const TABS = [
  { value: 'live_hypes', label: 'Live moments', icon: Flame },
  { value: 'overview', label: 'VOD runs', icon: Layers },
  { value: 'architecture', label: 'How it works', icon: Brain },
];

const RUN_STEPS = [
  { stepNum: 1, name: 'Word-level transcription & sentence mapping' },
  { stepNum: 2, name: 'Multi-signal heat curve & overlap windows' },
  { stepNum: 3, name: 'Sentence boundary snapper' },
  { stepNum: 3, name: 'Temporal (25%) & content dedupe' },
  { stepNum: 4, name: 'Stage A: Gemini triage' },
  { stepNum: 4, name: 'Stage B: 2-second hook & standalone check' },
  { stepNum: 5, name: 'MMR selection & final render' },
];

function HypeCard({ hype, forcing, onForce }) {
  const passed = hype.status === 'passed' || hype.status === 'force_passed';
  return (
    <Panel tone={passed ? undefined : undefined} className="flex flex-col gap-3 !p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-ink text-[13.5px] truncate">@{hype.channel_id}</span>
        <Pill tone={passed ? 'good' : 'idle'}>
          {hype.status === 'force_passed' ? 'Forced render' : passed ? 'Became a clip' : 'Filtered out'}
        </Pill>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <Badge tone="accent">{String(hype.trigger_type || 'hype').replace('_', ' ')}</Badge>
        <Badge tone={passed ? 'good' : 'warn'}>score {hype.virality_score}/100</Badge>
        {hype.threshold_value ? <span className="text-muted">min {Math.round(hype.threshold_value)}</span> : null}
      </div>
      {hype.rejection_reason && (
        <Notice tone="bad" icon={XCircle}>
          <b className="block text-[10.5px] uppercase tracking-wide opacity-80">{(hype.gate_failed || 'AI judge').replace(/_/g, ' ')}</b>
          {hype.rejection_reason}
        </Notice>
      )}
      {hype.transcript_text && (
        <blockquote className="text-[11.5px] text-muted italic bg-white/[0.03] rounded-lg px-2.5 py-2 line-clamp-3 leading-relaxed">“{hype.transcript_text}”</blockquote>
      )}
      {hype.rubric && Object.keys(hype.rubric).length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
          {Object.entries(hype.rubric).slice(0, 6).map(([k, v]) => (
            <div key={k} className="rounded-md bg-white/[0.04] px-1.5 py-1 truncate text-muted">{k.replace('_', ' ')} <b className="text-ink tabular-nums">{v}/5</b></div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-2 border-t border-line text-[11px] text-muted mt-auto">
        <span className="tabular-nums">{new Date(hype.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
        {!passed && <Button size="sm" variant="warn" icon={Scissors} loading={forcing} onClick={onForce}>Force render</Button>}
      </div>
    </Panel>
  );
}

export default function PipelineMonitor() {
  const [runs, setRuns] = useState([]);
  const [liveHypes, setLiveHypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState(null);
  const [activeTab, setActiveTab] = useState('live_hypes');
  const [filterActiveOnly, setFilterActiveOnly] = useState(true);
  const [forcingId, setForcingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [result, setResult] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [runsRes, hypesData] = await Promise.all([axios.get('/api/pipeline/runs'), getLiveHypes().catch(() => [])]);
      const allRuns = runsRes.data || [];
      const displayed = filterActiveOnly ? allRuns.filter((r) => ['running', 'processing', 'triggered'].includes(r.status)) : allRuns;
      setRuns(displayed);
      setLiveHypes(hypesData || []);
      if (displayed.length > 0) setSelectedRun((prev) => (prev && displayed.some((r) => r.id === prev.id) ? prev : displayed[0]));
      else setSelectedRun(null);
    } catch (err) {
      console.error('Failed fetching pipeline data:', err);
    } finally {
      setLoading(false);
    }
  }, [filterActiveOnly]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const forceRender = async (hypeId) => {
    setConfirmId(null);
    setForcingId(hypeId);
    setResult(null);
    try {
      const res = await forceRenderHype(hypeId);
      setResult(res.success ? { tone: 'good', text: `Clip #${res.clip_id} created - find it in Review.` } : { tone: 'bad', text: `Force render failed: ${res.error || 'unknown error'}` });
      if (res.success) await fetchData();
    } catch (e) {
      setResult({ tone: 'bad', text: `Could not start the render: ${e.message}` });
    } finally {
      setForcingId(null);
    }
  };

  const passedCount = liveHypes.filter((h) => h.status === 'passed' || h.status === 'force_passed').length;

  return (
    <Page title="Pipelines" icon={GitBranch} subtitle="Every live moment the AI judged, every VOD run, and how the clip picker works."
      actions={<Segmented value={activeTab} onChange={setActiveTab} options={TABS.map((t) => ({ ...t, count: t.value === 'live_hypes' ? liveHypes.length : undefined }))} ariaLabel="View" />}>
      {result && <Notice tone={result.tone}>{result.text}</Notice>}

      {activeTab === 'live_hypes' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Moments judged" value={liveHypes.length} icon={Flame} />
            <Stat label="Became clips" value={passedCount} tone="good" icon={CheckCircle2} />
            <Stat label="Filtered out" value={liveHypes.length - passedCount} icon={XCircle} />
          </div>
          {liveHypes.length === 0 ? (
            <Panel><EmptyState icon={Flame} title="No live moments yet" text="When a watched streamer's chat or audio spikes, the moment appears here with the AI's verdict. See it happen in real time on Live Pulse." /></Panel>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {liveHypes.map((h) => <HypeCard key={h.id} hype={h} forcing={forcingId === h.id} onForce={() => setConfirmId(h.id)} />)}
            </div>
          )}
        </>
      )}

      {activeTab === 'architecture' && (
        <>
          <Notice tone="accent" icon={Brain}>
            Every video or stream passes through a fixed 7-stage pipeline. The AI picks <b>sentence IDs</b>, never raw seconds, so it can't invent timestamps.
          </Notice>
          <div className="grid gap-3 lg:grid-cols-2">
            {PIPELINE_STEPS.map((s) => (
              <Panel key={s.step} className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent font-semibold flex items-center justify-center text-sm shrink-0 tabular-nums">{s.step}</div>
                  <div className="min-w-0">
                    <h3 className="text-[13.5px] font-semibold text-ink leading-snug">{s.name}</h3>
                    <p className="text-[11.5px] text-muted flex items-center gap-1 mt-0.5"><Cpu size={12} className="shrink-0" /> {s.engine}</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-2 text-xs">
                  <div className="bg-canvas rounded-xl p-2.5 border border-line"><span className="text-faint font-semibold block text-[10.5px] mb-0.5">INPUT</span><span className="text-slate-300">{s.input}</span></div>
                  <div className="bg-canvas rounded-xl p-2.5 border border-line"><span className="text-faint font-semibold block text-[10.5px] mb-0.5">OUTPUT</span><span className="text-slate-300">{s.output}</span></div>
                </div>
                {s.prompt && <p className="text-[11px] text-accent font-mono bg-accent/10 rounded-lg px-2.5 py-2 flex gap-1.5"><Terminal size={12} className="shrink-0 mt-0.5" />{s.prompt}</p>}
                <p className="text-[11.5px] text-muted">💡 {s.notes}</p>
              </Panel>
            ))}
          </div>
        </>
      )}

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)] gap-3 items-start">
          <Panel title={`${filterActiveOnly ? 'Active runs' : 'All runs'} (${runs.length})`} icon={Activity}
            right={<button type="button" onClick={() => setFilterActiveOnly((v) => !v)} className="text-[11.5px] text-accent font-medium">{filterActiveOnly ? 'Show history' : 'Active only'}</button>}>
            {loading ? <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
              : runs.length === 0 ? <EmptyState icon={Layers} title={filterActiveOnly ? 'Nothing running' : 'No runs yet'} text={filterActiveOnly ? 'All VOD and Quick Clip jobs are finished.' : 'Runs appear after a VOD or Quick Clip is processed.'} className="!py-6" />
                : (
                  <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                    {runs.map((r) => (
                      <button key={r.id} type="button" onClick={() => setSelectedRun(r)} aria-pressed={selectedRun?.id === r.id}
                        className={`w-full text-left p-3 rounded-xl border transition-colors ${selectedRun?.id === r.id ? 'bg-accent/10 border-accent/40' : 'bg-white/[0.02] border-line hover:bg-white/[0.05]'}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-mono text-[11.5px] text-accent font-semibold truncate">{r.id}</span>
                          <Pill tone={r.status === 'completed' ? 'good' : r.status === 'failed' ? 'bad' : 'warn'}>{r.status}</Pill>
                        </div>
                        <div className="text-xs text-ink truncate">{r.source_id}</div>
                        <div className="flex items-center justify-between text-[11px] text-muted mt-1.5 tabular-nums">
                          <span>{r.candidates_count} clip{r.candidates_count === 1 ? '' : 's'}</span><span>{r.latency_seconds}s</span>
                          <span>{new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
          </Panel>

          {selectedRun ? (
            <Panel title={<span className="font-mono text-accent">{selectedRun.id}</span>} icon={Layers}
              right={<span className="text-[11px] text-muted font-mono">{selectedRun.prompt_version || 'v2.0_best_clips'}</span>} className="space-y-4">
              <p className="text-xs text-muted -mt-1">Channel <b className="text-ink">{selectedRun.channel_id}</b></p>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Clips" value={selectedRun.candidates_count} />
                <Stat label="Latency" value={`${selectedRun.latency_seconds}s`} />
                <Stat label="Status" value={<span className="capitalize">{selectedRun.status}</span>} tone={selectedRun.status === 'failed' ? 'bad' : selectedRun.status === 'completed' ? 'good' : 'warn'} />
              </div>
              {selectedRun.error_message && <Notice tone="bad">{selectedRun.error_message}</Notice>}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted">Execution checklist</h3>
                  {selectedRun.stage && <Badge tone="accent">{selectedRun.stage}</Badge>}
                </div>
                <ol className="space-y-1.5">
                  {RUN_STEPS.map((step, idx) => {
                    const cur = selectedRun.step || (selectedRun.status === 'completed' ? 5 : 2);
                    const done = selectedRun.status === 'completed' || cur > step.stepNum;
                    const active = selectedRun.status === 'running' && cur === step.stepNum;
                    return (
                      <li key={idx} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${active ? 'bg-accent/10' : 'bg-white/[0.02]'} ${!done && !active ? 'opacity-45' : ''}`}>
                        {active ? <Spinner size={15} className="!text-accent shrink-0" /> : done ? <CheckCircle2 size={15} className="text-good shrink-0" /> : <Clock size={15} className="text-faint shrink-0" />}
                        <span className={`text-xs ${active ? 'text-ink font-semibold' : 'text-slate-300'}`}>{step.name}</span>
                        <span className="ml-auto text-[10px] text-muted uppercase">{active ? 'running' : done ? 'done' : 'pending'}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </Panel>
          ) : (
            <Panel><EmptyState icon={Layers} title="Pick a run" text="Select a run on the left to see its trace." /></Panel>
          )}
        </div>
      )}

      <Confirm open={confirmId != null} title="Force render this moment?"
        text="The AI judge rejected it. This renders it anyway and adds it to Review."
        confirmLabel="Force render" onCancel={() => setConfirmId(null)} onConfirm={() => forceRender(confirmId)} />
    </Page>
  );
}
