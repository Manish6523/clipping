import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Navbar from './components/Navbar';
import ReviewStation from './components/ReviewStation';
import PinLockScreen from './components/PinLockScreen';
import { getStatus, getPipelineStatus, getAuthConfig } from './api';
import { eventStream } from './services/eventStream';
import HypeMomentToasts from './components/HypeMomentToasts';
import MobileTabBar from './components/MobileTabBar';
import SwipeReview from './components/SwipeReview';
import { useLayoutMode } from './hooks/useLayoutMode';
import { notifyClipReady } from './services/pwa';

// Code-split heavy routes with React.lazy
const TemplateStudio = lazy(() => import('./components/TemplateStudio'));
const ChannelManager = lazy(() => import('./components/ChannelManager'));
const AccountsManager = lazy(() => import('./components/AccountsManager'));
const QueueCalendar = lazy(() => import('./components/QueueCalendar'));
const LogStreamer = lazy(() => import('./components/LogStreamer'));
const QuickClip = lazy(() => import('./components/QuickClip'));
const PipelineMonitor = lazy(() => import('./components/PipelineMonitor'));
const Settings = lazy(() => import('./components/Settings'));
const ClipEditorPage = lazy(() => import('./pages/ClipEditorPage'));
const StreamerTelemetryHub = lazy(() => import('./components/StreamerTelemetryHub'));

// Old /clips/:id/edit links -> /clips/:id/editor (Navigate does not substitute params by itself)
function LegacyEditRedirect() {
  const { clipId } = useParams();
  return <Navigate to={`/clips/${clipId}/editor`} replace />;
}

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
      if (event === 'clip_created' || event === 'clip_updated' || event === 'clip_deleted' || event === 'render_complete') {
        queryClient.invalidateQueries({ queryKey: ['clips'] });
        fetchSystemStatus();

        // Push persistent toast notification for created clips
        if (event === 'clip_created' && data) {
          notifyClipReady({ clipId: data.clip_id || data.id, title: data.title, score: data.virality_score });
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

    const statusInterval = setInterval(fetchSystemStatus, 12000);

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
        status={status}
      />

      {/* Nested Route Views (bottom padding leaves room for the phone tab bar) */}
      <main className="flex-1 pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="w-8 h-8 border-2 border-[#8FD3FF] border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <Outlet context={{ onStatusChange: fetchSystemStatus }} />
        </Suspense>
      </main>

      {/* New-clip toasts (pipelines are already shown in the navbar / status pill) */}
      <HypeMomentToasts toasts={toasts} onDismissToast={handleDismissToast} />

      <MobileTabBar pendingCount={status.pending_clips_count || 0} />
    </div>
  );
}

const REVIEW_MODE_KEY = 'autoclip_review_mode';

function ReviewStationWrapper() {
  const { isPhone } = useLayoutMode();
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(REVIEW_MODE_KEY) || 'swipe'; } catch { return 'swipe'; }
  });
  const switchTo = (m) => {
    setMode(m);
    try { localStorage.setItem(REVIEW_MODE_KEY, m); } catch { /* storage unavailable */ }
  };

  if (isPhone && mode === 'swipe') {
    return <SwipeReview onSwitchClassic={() => switchTo('classic')} />;
  }
  return (
    <>
      {isPhone && (
        <div className="px-3 pt-2 flex justify-end">
          <button
            type="button"
            onClick={() => switchTo('swipe')}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold"
          >
            Swipe mode
          </button>
        </div>
      )}
      <ReviewStation />
    </>
  );
}

export default function App() {
  const [authRequired, setAuthRequired] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return Boolean(localStorage.getItem('autoclip_session_token'));
  });

  useEffect(() => {
    // Check with server if auth lock is enabled
    getAuthConfig()
      .then((cfg) => {
        if (cfg && cfg.auth_lock_enabled === false) {
          setAuthRequired(false);
          setIsAuthenticated(true);
        } else {
          setAuthRequired(true);
        }
      })
      .catch(() => {
        // Fallback: if server not reachable or error, default to local state
        setAuthRequired(true);
      })
      .finally(() => {
        setAuthChecked(true);
      });

    const handleAuthRequired = () => {
      localStorage.removeItem('autoclip_session_token');
      localStorage.removeItem('autoclip_session_expires');
      setIsAuthenticated(false);
    };

    window.addEventListener('autoclip_auth_required', handleAuthRequired);
    return () => window.removeEventListener('autoclip_auth_required', handleAuthRequired);
  }, []);

  if (authChecked && authRequired && !isAuthenticated) {
    return <PinLockScreen onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  return (
    <Routes>
      {/* Root Layout for Main Dashboard Navigation */}
      <Route path="/" element={<AppLayout />}>
        <Route index element={<ReviewStationWrapper />} />
        <Route path="templates" element={<TemplateStudio />} />
        <Route path="presets" element={<Navigate to="/templates" replace />} />
        <Route path="channels" element={<ChannelManager />} />
        <Route path="telemetry" element={<StreamerTelemetryHub />} />
        <Route path="accounts" element={<AccountsManager />} />
        <Route path="queue" element={<QueueCalendar />} />
        <Route path="pipelines" element={<PipelineMonitor />} />
        <Route path="settings" element={<Settings />} />
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
      <Route path="/clips/:clipId/edit" element={<LegacyEditRedirect />} />

      {/* Catch-all redirect to Review Station */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
