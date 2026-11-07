import axios from 'axios';

const api = axios.create({
  baseURL: '',
  timeout: 30000,
});

export const getStatus = () => api.get('/api/status').then(r => r.data);
export const getHealth = () => api.get('/api/health').then(r => r.data);
export const getPipelineStatus = () => api.get('/api/pipeline/status').then(r => r.data);
export const getStreamers = () => api.get('/api/streamers').then(r => r.data);
export const getLogs = (sinceId = 0) => api.get(`/api/logs?since_id=${sinceId}`).then(r => r.data);

export const getClips = (status = '', limit = 50, cursor = '') => 
  api.get(`/api/clips?${new URLSearchParams({ ...(status && { status }), limit, ...(cursor && { cursor }) })}`)
     .then(r => r.data);

export const getClip = (id) => api.get(`/api/clips/${id}`).then(r => r.data);
export const getClipWords = (id) => api.get(`/api/clips/${id}/words`).then(r => r.data);
export const getClipWaveform = (id) => api.get(`/api/clips/${id}/waveform`).then(r => r.data);
export const trimClip = (id, deltaStart, deltaEnd) => 
  api.post(`/api/clips/${id}/trim`, { delta_start: deltaStart, delta_end: deltaEnd }, { timeout: 180000 }).then(r => r.data);
export const toggleTeaser = (id) => 
  api.post(`/api/clips/${id}/toggle-teaser`, {}, { timeout: 180000 }).then(r => r.data);
export const updateClip = (id, data) => api.post(`/api/clips/${id}/update`, data).then(r => r.data);
export const postClipNow = (id) => api.post(`/api/clips/${id}/post-now`).then(r => r.data);
export const queueClip = (id) => api.post(`/api/clips/${id}/queue`).then(r => r.data);
export const discardClip = (id) => api.post(`/api/clips/${id}/discard`).then(r => r.data);
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
export const deleteTemplate = (name) => api.delete(`/api/templates/${encodeURIComponent(name)}`).then(r => r.data);
export const testTemplateSample = (data) => api.post('/api/templates/test-sample', data).then(r => r.data);

export const getQueue = () => api.get('/api/queue').then(r => r.data);
export const clipManual = (data) => api.post('/api/clip-manual', data).then(r => r.data);

// YouTube Accounts & Streamer Mappings
export const getYouTubeAppConfig = () => api.get('/api/youtube/app-config').then(r => r.data);
export const saveYouTubeAppConfig = (data) => api.post('/api/youtube/app-config', data).then(r => r.data);
export const getYouTubeAuthUrl = (accountKey) => api.get(`/api/youtube/auth-url?account_key=${encodeURIComponent(accountKey)}`).then(r => r.data);
export const getYouTubeAccounts = () => api.get('/api/youtube/accounts').then(r => r.data);
export const deleteYouTubeAccount = (key) => api.delete(`/api/youtube/accounts/${encodeURIComponent(key)}`).then(r => r.data);
export const importYouTubeAccount = (data) => api.post('/api/youtube/accounts/import', data).then(r => r.data);
export const getYouTubeMappings = () => api.get('/api/youtube/mappings').then(r => r.data);
export const setYouTubeMappings = (data) => api.post('/api/youtube/mappings', data).then(r => r.data);

export default api;

