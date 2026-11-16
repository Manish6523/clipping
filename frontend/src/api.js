import axios from 'axios';

const api = axios.create({
  baseURL: '',
  timeout: 30000,
});

// Attach Authorization Bearer token to all outgoing API requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('autoclip_session_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Intercept 401 Unauthorized responses to trigger lock screen
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Trigger auth required event
      window.dispatchEvent(new CustomEvent('autoclip_auth_required'));
    }
    return Promise.reject(error);
  }
);

export const verifyPin = (pin) => api.post('/api/auth/verify', { pin }).then(r => r.data);
export const getAuthConfig = () => api.get('/api/auth/config').then(r => r.data);

export const getStatus = () => api.get('/api/status').then(r => r.data);
export const getHealth = () => api.get('/api/health').then(r => r.data);
export const getPipelineStatus = () => api.get('/api/pipeline/status').then(r => r.data);
export const getStreamers = () => api.get('/api/streamers').then(r => r.data);
export const getLogs = (sinceId = 0) => api.get(`/api/logs?since_id=${sinceId}`).then(r => r.data);

export const getClips = (status = '', limit = 50, cursor = '') => 
  api.get(`/api/clips?${new URLSearchParams({ ...(status && { status }), limit, ...(cursor && { cursor }) })}`)
     .then(r => r.data);

export const getClip = (id) => api.get(`/api/clips/${id}`).then(r => r.data);
export const getClipExplain = (id) => api.get(`/api/clips/${id}/explain`).then(r => r.data);
export const getClipWords = (id) => api.get(`/api/clips/${id}/words`).then(r => r.data);
export const getClipWaveform = (id) => api.get(`/api/clips/${id}/waveform`).then(r => r.data);
export const trimClip = (id, deltaStart, deltaEnd) => 
  api.post(`/api/clips/${id}/trim`, { delta_start: deltaStart, delta_end: deltaEnd }, { timeout: 180000 }).then(r => r.data);
export const toggleTeaser = (id) => 
  api.post(`/api/clips/${id}/toggle-teaser`, {}, { timeout: 180000 }).then(r => r.data);
export const updateClip = (id, data) => api.post(`/api/clips/${id}/update`, data).then(r => r.data);
export const postClipNow = (id) => api.post(`/api/clips/${id}/post-now`).then(r => r.data);
export const queueClip = (id) => api.post(`/api/clips/${id}/queue`).then(r => r.data);
export const discardClip = (id, reason = null) => api.post(`/api/clips/${id}/discard`, { reason }).then(r => r.data);
export const sendClipFeedback = (id, event, payload = {}) => api.post(`/api/clips/${id}/feedback`, { event, payload }).then(r => r.data);
export const getFeedbackAnalytics = (channel = '') => api.get(`/api/analytics/feedback${channel ? `?channel=${encodeURIComponent(channel)}` : ''}`).then(r => r.data);
export const bulkRetemplate = (clipIds, template) => api.post('/api/clips/bulk-retemplate', { clip_ids: clipIds, template }).then(r => r.data);
export const getBulkRetemplate = (batchId) => api.get(`/api/clips/bulk-retemplate/${batchId}`).then(r => r.data);
export const cancelBulkRetemplate = (batchId) => api.post(`/api/clips/bulk-retemplate/${batchId}/cancel`).then(r => r.data);
export const batchDiscardClips = (clipIds) => api.post('/api/clips/batch-discard', { clip_ids: clipIds }).then(r => r.data);

export const getChannels = () => api.get('/api/channels').then(r => r.data);
export const addChannel = (data) => api.post('/api/channels', data).then(r => r.data);
export const removeChannel = (handle) => api.delete(`/api/channels/${handle}`).then(r => r.data);
export const patchChannelSettings = (id, data) => api.patch(`/api/channels/${id}`, data).then(r => r.data);
export const pauseChannel = (id, reason = '', stopImmediate = false) => 
  api.post(`/api/channels/${id}/pause`, { reason, stop_immediate: stopImmediate }).then(r => r.data);
export const resumeChannel = (id) => api.post(`/api/channels/${id}/resume`).then(r => r.data);
export const pauseDaemon = (reason = '') => api.post('/api/daemon/pause', { reason }).then(r => r.data);
export const resumeDaemon = () => api.post('/api/daemon/resume').then(r => r.data);

export const getTemplates = () => api.get('/api/templates').then(r => r.data);
export const saveTemplate = (data) => api.post('/api/templates', data).then(r => r.data);
export const migrateTemplate = (data) => api.post('/api/templates/migrate', data).then(r => r.data);
export const deleteTemplate = (name) => api.delete(`/api/templates/${encodeURIComponent(name)}`).then(r => r.data);
export const testTemplateSample = (data) => api.post('/api/templates/test-sample', data).then(r => r.data);
export const uploadWatermark = (formData) => api.post('/api/templates/watermark/upload', formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
}).then(r => r.data);

export const getQueue = () => api.get('/api/queue').then(r => r.data);
export const clipManual = (data) => api.post('/api/clip-manual', data).then(r => r.data);

export const getLiveHypes = () => api.get('/api/pipeline/live-hypes').then(r => r.data);
export const forceRenderHype = (id) => api.post(`/api/pipeline/live-hypes/${id}/force-render`).then(r => r.data);

// Presets API
export const getPresets = (channelId = '') => 
  api.get(`/api/presets${channelId ? `?channel_id=${encodeURIComponent(channelId)}` : ''}`).then(r => r.data);
export const createPreset = (data) => api.post('/api/presets', data).then(r => r.data);
export const updatePreset = (id, data) => api.patch(`/api/presets/${id}`, data).then(r => r.data);
export const deletePreset = (id) => api.delete(`/api/presets/${id}`).then(r => r.data);
export const applyPreset = (id, clipId = null) => 
  api.post(`/api/presets/${id}/apply`, { clip_id: clipId }).then(r => r.data);

// YouTube Accounts & Streamer Mappings
export const getPublishTargets = (clipId) => api.get(`/api/publish/targets?clip_id=${clipId}`).then(r => r.data);
export const publishClip = (id, platforms, when = 'slot') => api.post(`/api/clips/${id}/publish`, { platforms, when }).then(r => r.data);
export const getPublishStatus = (id) => api.get(`/api/clips/${id}/publish-status`).then(r => r.data);
export const getTikTokAppConfig = () => api.get('/api/tiktok/app-config').then(r => r.data);
export const saveTikTokAppConfig = (data) => api.post('/api/tiktok/app-config', data).then(r => r.data);
export const getTikTokAuthUrl = (mode = 'inbox') => api.get(`/api/tiktok/auth-url?mode=${mode}`).then(r => r.data);
export const getTikTokAccounts = () => api.get('/api/tiktok/accounts').then(r => r.data);
export const patchTikTokAccount = (key, data) => api.patch(`/api/tiktok/accounts/${encodeURIComponent(key)}`, data).then(r => r.data);
export const deleteTikTokAccount = (key) => api.delete(`/api/tiktok/accounts/${encodeURIComponent(key)}`).then(r => r.data);
// Clip Lab (sandbox: never creates clips)
export const labStartUpload = (name, size) => api.post('/api/lab/upload', { name, size }).then(r => r.data);
export const labUploadChunk = (id, offset, blob) => api.put(`/api/lab/${id}/chunk?offset=${offset}`, blob, { headers: { 'Content-Type': 'application/octet-stream' }, timeout: 0 }).then(r => r.data);
export const labFinishUpload = (id) => api.post(`/api/lab/${id}/finish`, null, { timeout: 120000 }).then(r => r.data);
export const labSessions = () => api.get('/api/lab/sessions').then(r => r.data);
export const labSession = (id) => api.get(`/api/lab/${id}`).then(r => r.data);
export const labDelete = (id) => api.delete(`/api/lab/${id}`).then(r => r.data);
export const labRun = (id, step, params) => api.post(`/api/lab/${id}/run/${step}`, params || {}).then(r => r.data);
export const labJob = (jobId) => api.get(`/api/lab/jobs/${jobId}`).then(r => r.data);
export const labTemplates = () => api.get('/api/lab/templates').then(r => r.data);
export const withToken = (url) => {
  const t = localStorage.getItem('autoclip_session_token');
  return t && url ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}` : url;
};
export const getYouTubeAppConfig = () => api.get('/api/youtube/app-config').then(r => r.data);
export const saveYouTubeAppConfig = (data) => api.post('/api/youtube/app-config', data).then(r => r.data);
export const getYouTubeAuthUrl = (accountKey) => api.get(`/api/youtube/auth-url?account_key=${encodeURIComponent(accountKey)}`).then(r => r.data);
export const getYouTubeAccounts = () => api.get('/api/youtube/accounts').then(r => r.data);
export const patchYouTubeAccountConfig = (key, data) => api.patch(`/api/youtube/accounts/${encodeURIComponent(key)}`, data).then(r => r.data);
export const deleteYouTubeAccount = (key) => api.delete(`/api/youtube/accounts/${encodeURIComponent(key)}`).then(r => r.data);
export const importYouTubeAccount = (data) => api.post('/api/youtube/accounts/import', data).then(r => r.data);
export const getYouTubeMappings = () => api.get('/api/youtube/mappings').then(r => r.data);
export const setYouTubeMappings = (data) => api.post('/api/youtube/mappings', data).then(r => r.data);

export default api;

