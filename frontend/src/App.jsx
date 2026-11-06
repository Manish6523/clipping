import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Navbar from './components/Navbar';
import ReviewStation from './components/ReviewStation';
import { getStatus, getPipelineStatus } from './api';
import { eventStream } from './services/eventStream';
import HypeMomentToasts from './components/HypeMomentToasts';

// Code-split heavy routes with React.lazy
const TemplateStudio = lazy(() => import('./components/TemplateStudio'));
const ChannelManager = lazy(() => import('./components/ChannelManager'));
const QueueCalendar = lazy(() => import('./components/QueueCalendar'));
const LogStreamer = lazy(() => import('./components/LogStreamer'));
const QuickClip = lazy(() => import('./components/QuickClip'));
const ClipEditorPage = lazy(() => import('./pages/ClipEditorPage'));

function AppLayout() {
  const [status, setStatus] = useState({});
  const [pipelineAlert, setPipelineAlert] = useState(null);
  const [toasts, setToasts] = useState([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    fetchSystemStatus();

    // Subscribe to live WebSocket events to invalidate queries instead of rapid polling
    const unsubscribe = eventStream.subscribe((payload) => {
      const { event, data } = payload;
      if (event === 'clip_created' || event === 'clip_updated' || event === 'render_complete') {
        queryClient.invalidateQueries({ queryKey: ['clips'] });
        fetchSystemStatus();

        // Push persistent toast notification for created clips
        if (event === 'clip_created' && data) {
          setToasts((prev) => {
            const toastId = `toast-${data.clip_id || data.id || Date.now()}`;
            if (prev.some((t) => t.toast_id === toastId)) return prev;
            return [
              {
                toast_id: toastId,
                clip_id: data.clip_id || data.id,
                channel_id: data.channel_id,
                title: data.title || 'New Stream Highlight Ready',
                virality_score: data.virality_score || 85,
                time: new Date().toLocaleTimeString(),
              },
              ...prev,
            ];
          });
        }
      } else if (event === 'channel_status' || event === 'channel_settings_changed') {
        queryClient.invalidateQueries({ queryKey: ['channels'] });
      } else if (event === 'job_progress') {
        setPipelineAlert({
          status: data.status === 'completed' ? 'completed' : 'processing',
          channel_id: data.channel_id,
          step_name: `Stage ${data.stage}: ${data.status}`,
          current_step: data.stage === 'render' ? 4 : data.stage === 'transcribe' ? 2 : 3,
        });
      }
    });

    return () => unsubscribe();
  }, [queryClient]);

  const handleDismissToast = (toastId) => {
    setToasts((prev) => prev.filter((t) => t.toast_id !== toastId));
  };

  const fetchSystemStatus = async () => {
    try {
      const [sData, pData] = await Promise.all([
        getStatus(),
        getPipelineStatus()
      ]);
      setStatus(sData);
      setPipelineAlert(pData);
    } catch (err) {
      console.error('Status fetch error:', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#080B11] text-slate-100 flex flex-col font-sans">
      <Navbar pendingCount={status.pending_clips_count || 0} />

      {/* Real-Time Live Pipeline Progress Banner */}
      {pipelineAlert && (pipelineAlert.status === 'triggered' || pipelineAlert.status === 'processing') && (
        <div className="max-w-7xl mx-auto w-full px-4 mt-4">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl shadow-amber-500/5 animate-pulse">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔥</span>
              <div>
                <div className="font-extrabold text-sm text-amber-300">
                  HYPE MOMENT DETECTED ON #{pipelineAlert.channel_id?.toUpperCase()}
                </div>
                <div className="text-xs text-slate-400">
                  {pipelineAlert.step_name}
                </div>
              </div>
            </div>

            {/* Visual 5-Step Stepper */}
            <div className="flex items-center gap-4 text-xs font-bold">
              {[
                { step: 1, label: 'Buffer Sliced' },
                { step: 2, label: 'Transcribing' },
                { step: 3, label: 'Gemini Scoring' },
                { step: 4, label: '9:16 Render' },
                { step: 5, label: 'Ready' },
              ].map((s) => (
                <div key={s.step} className="flex items-center gap-1.5">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                    s.step < pipelineAlert.current_step
                      ? 'bg-emerald-500 text-black'
                      : s.step === pipelineAlert.current_step
                      ? 'bg-amber-500 text-black ring-4 ring-amber-500/30'
                      : 'bg-white/10 text-slate-500'
                  }`}>
                    {s.step}
                  </span>
                  <span className={s.step === pipelineAlert.current_step ? 'text-amber-300' : 'text-slate-500'}>
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Nested Route Views */}
      <main className="flex-1">
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="w-8 h-8 border-2 border-[#8FD3FF] border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <Outlet context={{ onStatusChange: fetchSystemStatus }} />
        </Suspense>
      </main>

      {/* Persistent Bottom-Left Hype Moment Toasts */}
      <HypeMomentToasts toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
}

function ReviewStationWrapper() {
  return <ReviewStation />;
}

export default function App() {
  return (
    <Routes>
      {/* Root Layout for Main Dashboard Navigation */}
      <Route path="/" element={<AppLayout />}>
        <Route index element={<ReviewStationWrapper />} />
        <Route path="templates" element={<TemplateStudio />} />
        <Route path="channels" element={<ChannelManager />} />
        <Route path="queue" element={<QueueCalendar />} />
        <Route path="logs" element={<LogStreamer />} />
        <Route path="quickclip" element={<QuickClip />} />
      </Route>

      {/* Dedicated Full-Screen Clip Editor Route */}
      <Route path="/clips/:clipId/editor" element={
        <Suspense fallback={
          <div className="min-h-screen bg-[#0A0B0E] flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[#8FD3FF] border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <ClipEditorPage />
        </Suspense>
      } />
      <Route path="/clips/:clipId/edit" element={<Navigate to="/clips/:clipId/editor" replace />} />

      {/* Catch-all redirect to Review Station */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
