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
const AccountsManager = lazy(() => import('./components/AccountsManager'));
const QueueCalendar = lazy(() => import('./components/QueueCalendar'));
const LogStreamer = lazy(() => import('./components/LogStreamer'));
const QuickClip = lazy(() => import('./components/QuickClip'));
const PipelineMonitor = lazy(() => import('./components/PipelineMonitor'));
const ClipEditorPage = lazy(() => import('./pages/ClipEditorPage'));

function AppLayout() {
  const [status, setStatus] = useState({});
  const [pipelineAlert, setPipelineAlert] = useState(null);
  const [activePipelines, setActivePipelines] = useState([]);
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
        fetchSystemStatus();
      }
    });

    const statusInterval = setInterval(fetchSystemStatus, 4000);

    return () => {
      unsubscribe();
      clearInterval(statusInterval);
    };
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
      if (pData?.active_pipelines) {
        setActivePipelines(pData.active_pipelines);
      } else if (pData && (pData.status === 'triggered' || pData.status === 'processing')) {
        setActivePipelines([pData]);
      } else {
        setActivePipelines([]);
      }
    } catch (err) {
      console.error('Status fetch error:', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#080B11] text-slate-100 flex flex-col font-sans">
      <Navbar 
        pendingCount={status.pending_clips_count || 0} 
        activePipelines={activePipelines} 
        toasts={toasts} 
        onDismissToast={handleDismissToast} 
      />

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
        <Route path="accounts" element={<AccountsManager />} />
        <Route path="queue" element={<QueueCalendar />} />
        <Route path="pipelines" element={<PipelineMonitor />} />
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
