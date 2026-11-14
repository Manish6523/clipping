import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Radio, Plus, Trash2, CheckCircle2, ExternalLink, Pause, Play, Settings, Save, AlertTriangle, Tag, Layers, RefreshCw, Search, Activity, Eye, Zap,
} from 'lucide-react';
import { getChannels, addChannel, removeChannel, getStreamers, getTemplates, pauseChannel, resumeChannel, patchChannelSettings } from '../api';
import {
  Page, Panel, Button, IconButton, Input, Select, Textarea, Field, Pill, Badge, Segmented, Sheet, Confirm, Checkbox, EmptyState, Notice, Stat, Dot,
} from './ui';

const DEFAULT_GROUPS = ['Casual Gaming', 'GTA RP', 'Valorant', 'IRL', 'Shooters', 'Reaction', 'General'];

export default function ChannelManager() {
  const [channels, setChannels] = useState([]);
  const [streamers, setStreamers] = useState({});
  const [templates, setTemplates] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newChannel, setNewChannel] = useState('');
  const [newPlatform, setNewPlatform] = useState('twitch');
  const [newTemplate, setNewTemplate] = useState('');
  const [newGroupTag, setNewGroupTag] = useState('Casual Gaming');
  const [customGroupInput, setCustomGroupInput] = useState('');
  const [isAddingLoading, setIsAddingLoading] = useState(false);

  // Group filter & search state
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Pause Modal
  const [pauseModalChannel, setPauseModalChannel] = useState(null);
  const [pauseImmediate, setPauseImmediate] = useState(false);
  const [pauseReason, setPauseReason] = useState('Manual maintenance');

  // Settings Drawer
  const [drawerChannel, setDrawerChannel] = useState(null);
  const [drawerForm, setDrawerForm] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isRefreshingAvatar, setIsRefreshingAvatar] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 20000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [chanData, streamData, templData] = await Promise.all([
        getChannels(),
        getStreamers(),
        getTemplates()
      ]);
      setChannels(chanData);
      setStreamers(streamData);
      setTemplates(templData);
      if (templData && templData.length > 0 && !newTemplate) {
        setNewTemplate(templData[0].name);
      }
    } catch (err) {
      console.error('Failed to load channel data:', err);
    }
  };

  // Collect distinct groups from existing channels + defaults
  const availableGroups = useMemo(() => {
    const s = new Set(DEFAULT_GROUPS);
    channels.forEach(c => {
      if (c.group_tag && c.group_tag.trim()) {
        s.add(c.group_tag.trim());
      }
    });
    return Array.from(s);
  }, [channels]);

  // Filter channels by selected group and search
  const filteredChannels = useMemo(() => {
    return channels.filter(c => {
      const matchesGroup = selectedGroup === 'all' || (c.group_tag || 'General').toLowerCase() === selectedGroup.toLowerCase();
      const name = (c.display_name || c.channel_id_or_handle || '').toLowerCase();
      const handle = (c.channel_id_or_handle || '').toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || name.includes(q) || handle.includes(q);
      return matchesGroup && matchesSearch;
    });
  }, [channels, selectedGroup, searchQuery]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newChannel.trim()) return;

    const group = (customGroupInput.trim() || newGroupTag.trim() || 'General');
    setIsAddingLoading(true);

    try {
      await addChannel({
        platform: newPlatform,
        channel: newChannel.trim(),
        template: newTemplate,
        group_tag: group,
      });
      setNewChannel('');
      setCustomGroupInput('');
      setShowAddModal(false);
      await fetchData();
    } catch (err) {
      setError(`Could not add the streamer: ${err.response?.data?.error?.message || err.message}`);
    } finally {
      setIsAddingLoading(false);
    }
  };

  const handleTogglePause = async (c) => {
    if (c.enabled === 1) {
      setPauseModalChannel(c);
      setPauseReason('Manual pause');
      setPauseImmediate(false);
    } else {
      try {
        await resumeChannel(c.channel_id_or_handle);
        fetchData();
      } catch (err) {
        setError(`Could not resume: ${err.message}`);
      }
    }
  };

  const confirmPause = async () => {
    if (!pauseModalChannel) return;
    try {
      await pauseChannel(pauseModalChannel.channel_id_or_handle, pauseReason, pauseImmediate);
      setPauseModalChannel(null);
      fetchData();
    } catch (err) {
      setError(`Could not pause: ${err.message}`);
    }
  };

  const openSettings = (c) => {
    setDrawerChannel(c);
    const existing = c.settings || {};
    setDrawerForm({
      display_name: c.display_name || c.channel_id_or_handle,
      template_name: c.template_name || 'custom_gaming_split',
      group_tag: c.group_tag || 'General',
      avatar_url: c.avatar_url || '',
      notes: c.notes || '',
      clip_rules: {
        min_length: existing.clip_rules?.min_length || 15,
        max_length: existing.clip_rules?.max_length || 60,
        min_score: existing.clip_rules?.min_score || 65,
        cooldown: existing.clip_rules?.cooldown || 90,
      },
      detection: {
        chat_spikes: existing.detection?.chat_spikes ?? true,
        audio_peaks: existing.detection?.audio_peaks ?? true,
        gemini_scoring: existing.detection?.gemini_scoring ?? true,
      },
      ai: {
        whisper_model: existing.ai?.whisper_model || 'base',
        gemini_context: existing.ai?.gemini_context || 'Gaming streamer, prioritize funny clips and energetic reactions.',
        persona: existing.ai?.persona || '',
        good_clip_notes: existing.ai?.good_clip_notes || '',
        avoid_notes: existing.ai?.avoid_notes || '',
        inside_jokes: existing.ai?.inside_jokes || '',
      },
      publishing: {
        auto_approve_score: existing.publishing?.auto_approve_score || 95,
        telegram_alerts: existing.publishing?.telegram_alerts ?? true,
      }
    });
    setSaveSuccess(false);
  };

  const saveSettings = async () => {
    if (!drawerChannel || !drawerForm) return;
    const handle = drawerChannel.channel_id_or_handle;
    const updatedTemplate = drawerForm.template_name;
    const updatedDisplay = drawerForm.display_name;
    try {
      await patchChannelSettings(handle, {
        template_name: updatedTemplate,
        display_name: updatedDisplay,
        group_tag: drawerForm.group_tag,
        avatar_url: drawerForm.avatar_url,
        notes: drawerForm.notes,
        settings: {
          clip_rules: drawerForm.clip_rules,
          detection: drawerForm.detection,
          ai: drawerForm.ai,
          publishing: drawerForm.publishing,
        }
      });
      // Optimistically update local channel state
      setChannels((prev) =>
        prev.map((c) =>
          c.channel_id_or_handle === handle
            ? { ...c, template_name: updatedTemplate, display_name: updatedDisplay, group_tag: drawerForm.group_tag, avatar_url: drawerForm.avatar_url }
            : c
        )
      );
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      await fetchData();
    } catch (err) {
      setError(`Save failed: ${err.response?.data?.error?.message || err.message}`);
    }
  };

  const handleRefreshAvatar = async () => {
    if (!drawerChannel || !drawerForm) return;
    setIsRefreshingAvatar(true);
    try {
      const res = await patchChannelSettings(drawerChannel.channel_id_or_handle, {
        refresh_avatar: true,
        settings: drawerForm,
      });
      if (res?.avatar_url) {
        setDrawerForm(prev => ({ ...prev, avatar_url: res.avatar_url }));
      }
      await fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsRefreshingAvatar(false);
    }
  };

  const handleRemove = async (handle) => {
    setConfirmRemove(null);
    try {
      await removeChannel(handle);
      fetchData();
    } catch (err) {
      setError(`Could not remove the streamer: ${err.message}`);
    }
  };

  const setRules = (patch) => setDrawerForm({ ...drawerForm, clip_rules: { ...drawerForm.clip_rules, ...patch } });
  const setAi = (patch) => setDrawerForm({ ...drawerForm, ai: { ...drawerForm.ai, ...patch } });
  const liveCount = channels.filter((c) => c.enabled === 1 && (streamers[c.channel_id_or_handle] || {}).is_live).length;
  const pausedCount = channels.filter((c) => c.enabled !== 1).length;

  const groupOptions = [
    { value: 'all', label: 'All', count: channels.length },
    ...availableGroups
      .map((g) => ({ value: g, label: g, count: channels.filter((c) => (c.group_tag || 'General').toLowerCase() === g.toLowerCase()).length }))
      .filter((o) => o.count > 0 || o.value.toLowerCase() === selectedGroup.toLowerCase()),
  ];

  const sorted = [...filteredChannels].sort((a, b) => {
    const rank = (c) => ((streamers[c.channel_id_or_handle] || {}).is_live && c.enabled === 1 ? 0 : c.enabled === 1 ? 1 : 2);
    return rank(a) - rank(b);
  });

  return (
    <Page title="Streamers" icon={Radio} subtitle="Who the clipper watches. Group creators by niche, tune clip rules and teach the AI each streamer's style."
      actions={(
        <>
          <Link to="/telemetry"><Button icon={Activity}>Live Pulse</Button></Link>
          <Button variant="primary" icon={Plus} onClick={() => setShowAddModal(true)}>Add streamer</Button>
        </>
      )}>
      {error && <Notice tone="bad" icon={AlertTriangle}>{error}</Notice>}

      {channels.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Watching" value={channels.length - pausedCount} icon={Eye} />
          <Stat label="Live now" value={liveCount} tone={liveCount ? 'bad' : 'idle'} icon={Radio} />
          <Stat label="Paused" value={pausedCount} tone={pausedCount ? 'warn' : 'idle'} icon={Pause} />
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center gap-2">
        <div className="min-w-0 flex-1"><Segmented value={selectedGroup} onChange={setSelectedGroup} options={groupOptions} size="sm" ariaLabel="Group" /></div>
        <div className="relative lg:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search streamer or handle…" aria-label="Search streamers" className="!pl-8" />
        </div>
      </div>

      {sorted.length === 0 ? (
        <Panel>
          <EmptyState icon={Radio} title="No streamers found"
            text={selectedGroup !== 'all' ? `Nobody is in the "${selectedGroup}" group yet.` : 'Add your first streamer to start watching for live moments.'}
            action={<Button variant="primary" icon={Plus} onClick={() => setShowAddModal(true)}>Add streamer</Button>} />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {sorted.map((c) => {
            const info = streamers[c.channel_id_or_handle] || {};
            const isLive = info.is_live;
            const isEnabled = c.enabled === 1;
            const platform = (c.platform || 'twitch').toLowerCase();
            const name = c.display_name || c.channel_id_or_handle;
            return (
              <Panel key={c.id} tone={!isEnabled ? 'warn' : isLive ? 'bad' : undefined} className={`!p-3.5 flex flex-col gap-3 ${!isEnabled ? 'opacity-75' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      {c.avatar_url ? (
                        <img src={c.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover border border-line-strong" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-raised border border-line-strong flex items-center justify-center font-semibold text-accent text-sm">{name.substring(0, 2).toUpperCase()}</div>
                      )}
                      <span className={`absolute -bottom-1 -right-1 text-[9px] font-bold px-1.5 rounded-full text-white border border-surface ${platform === 'twitch' ? 'bg-[#9146FF]' : 'bg-[#e11d48]'}`}>{platform === 'twitch' ? 'TW' : 'YT'}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-[14px] text-ink truncate">{name}</div>
                      <div className="text-[11px] text-muted font-mono truncate">@{c.channel_id_or_handle}</div>
                      <Badge tone="accent" className="mt-1"><Tag size={10} className="mr-1" />{c.group_tag || 'General'}</Badge>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {!isEnabled ? <Pill tone="warn">Paused</Pill> : isLive ? <Pill tone="bad"><span className="font-semibold">LIVE</span></Pill> : <Pill tone="idle">Offline</Pill>}
                  </div>
                </div>

                {isLive && info.title ? (
                  <p className="text-xs text-slate-300 line-clamp-1 bg-white/[0.03] rounded-lg px-2.5 py-1.5">{info.title}</p>
                ) : c.notes ? <p className="text-xs text-muted line-clamp-1">{c.notes}</p> : null}

                <dl className="grid grid-cols-3 gap-2 text-xs">
                  {[
                    ['Layout', c.template_name, 'text-accent'],
                    ['Chat speed', info.current_mps ? `${info.current_mps.toFixed(1)} /s` : '0.0 /s', 'text-ink'],
                    ['Clips today', c.clips_today || 0, 'text-good'],
                  ].map(([k, v, cls]) => (
                    <div key={k} className="rounded-lg bg-canvas px-2 py-1.5 min-w-0">
                      <dt className="text-[10px] text-faint">{k}</dt>
                      <dd className={`font-semibold tabular-nums truncate ${cls}`} title={String(v)}>{v}</dd>
                    </div>
                  ))}
                </dl>

                <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-line mt-auto">
                  <a href={platform === 'twitch' ? `https://twitch.tv/${c.channel_id_or_handle}` : `https://youtube.com/@${c.channel_id_or_handle}`}
                    target="_blank" rel="noreferrer" className="text-[12px] font-medium text-muted hover:text-ink flex items-center gap-1 py-2">
                    Open stream <ExternalLink size={11} />
                  </a>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant={isEnabled ? 'warn' : 'good'} icon={isEnabled ? Pause : Play} onClick={() => handleTogglePause(c)}>{isEnabled ? 'Pause' : 'Resume'}</Button>
                    <IconButton icon={Settings} label="Settings and AI persona" size="sm" variant="secondary" onClick={() => openSettings(c)} />
                    <IconButton icon={Trash2} label="Remove streamer" size="sm" className="hover:!text-bad" onClick={() => setConfirmRemove(c.channel_id_or_handle)} />
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {/* Pause */}
      <Sheet open={!!pauseModalChannel} onClose={() => setPauseModalChannel(null)} title={`Pause ${pauseModalChannel?.channel_id_or_handle || ''}`}
        footer={<div className="flex gap-2"><Button block onClick={() => setPauseModalChannel(null)}>Cancel</Button><Button block variant="warn" onClick={confirmPause}>Pause monitoring</Button></div>}>
        <p className="text-xs text-muted mb-3">While paused, recording stops and no clips or jobs are processed for this streamer.</p>
        <div className="space-y-3">
          <Field label="Reason"><Input value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} /></Field>
          <Checkbox checked={pauseImmediate} onChange={setPauseImmediate} label="Cancel renders that are in progress right now" />
        </div>
      </Sheet>

      {/* Settings + AI persona */}
      <Sheet open={!!(drawerChannel && drawerForm)} onClose={() => setDrawerChannel(null)} wide
        title={drawerForm ? `${drawerForm.display_name || drawerChannel?.channel_id_or_handle} · ${drawerChannel?.platform}` : ''}
        footer={drawerForm && (
          <div className="flex items-center gap-2">
            {saveSuccess && <span className="text-xs text-good font-semibold flex items-center gap-1.5 mr-auto"><CheckCircle2 size={15} /> Saved &amp; applied</span>}
            <Button className="ml-auto" onClick={() => setDrawerChannel(null)}>Close</Button>
            <Button variant="primary" icon={Save} onClick={saveSettings}>Save</Button>
          </div>
        )}>
        {drawerForm && (
          <div className="space-y-6">
            <section className="space-y-3">
              <h4 className="text-[11px] uppercase tracking-wider font-semibold text-muted flex items-center gap-1.5"><Tag size={12} /> Identity &amp; group</h4>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Display name"><Input value={drawerForm.display_name} onChange={(e) => setDrawerForm({ ...drawerForm, display_name: e.target.value })} /></Field>
                <Field label="Group / label"><Input value={drawerForm.group_tag || ''} onChange={(e) => setDrawerForm({ ...drawerForm, group_tag: e.target.value })} placeholder="e.g. GTA RP, IRL" /></Field>
              </div>
              <Field label="Avatar image URL" right={(
                <button type="button" onClick={handleRefreshAvatar} disabled={isRefreshingAvatar} className="text-[11px] text-accent flex items-center gap-1 font-semibold disabled:opacity-50">
                  <RefreshCw size={11} className={isRefreshingAvatar ? 'animate-spin' : ''} />{isRefreshingAvatar ? 'Fetching…' : 'Auto-fetch'}
                </button>
              )}>
                <Input mono value={drawerForm.avatar_url || ''} onChange={(e) => setDrawerForm({ ...drawerForm, avatar_url: e.target.value })} placeholder="https://static-cdn.jtvnw.net/…" />
              </Field>
              <Field label="Layout template">
                <Select value={drawerForm.template_name} onChange={(e) => setDrawerForm({ ...drawerForm, template_name: e.target.value })}>
                  {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </Select>
              </Field>
            </section>

            <section className="space-y-3">
              <h4 className="text-[11px] uppercase tracking-wider font-semibold text-muted flex items-center gap-1.5"><Zap size={12} /> Clip rules</h4>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Min length (s)"><Input type="number" inputMode="numeric" value={drawerForm.clip_rules.min_length} onChange={(e) => setRules({ min_length: Number(e.target.value) })} /></Field>
                <Field label="Max length (s)"><Input type="number" inputMode="numeric" value={drawerForm.clip_rules.max_length} onChange={(e) => setRules({ max_length: Number(e.target.value) })} /></Field>
                <Field label="Min score"><Input type="number" inputMode="numeric" value={drawerForm.clip_rules.min_score} onChange={(e) => setRules({ min_score: Number(e.target.value) })} /></Field>
              </div>
            </section>

            <section className="space-y-3">
              <h4 className="text-[11px] uppercase tracking-wider font-semibold text-muted">AI context &amp; persona</h4>
              <Field label="Creator persona & niche"><Textarea rows={2} value={drawerForm.ai.persona || ''} onChange={(e) => setAi({ persona: e.target.value })}
                placeholder="e.g. High-energy streamer who unboxes CS cases, screams at rare knives and talks fast." /></Field>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label={<span className="text-good">What makes a good clip</span>}><Textarea rows={3} value={drawerForm.ai.good_clip_notes || ''} onChange={(e) => setAi({ good_clip_notes: e.target.value })}
                  placeholder="e.g. Unboxing gold knives, sudden rage quits, hilarious voice cracks." /></Field>
                <Field label={<span className="text-bad">What to avoid / reject</span>}><Textarea rows={3} value={drawerForm.ai.avoid_notes || ''} onChange={(e) => setAi({ avoid_notes: e.target.value })}
                  placeholder="e.g. Inventory sorting, quiet AFK moments, reading off-topic chat." /></Field>
              </div>
              <Field label={<span className="text-warn">Inside jokes & catchphrases</span>}><Input value={drawerForm.ai.inside_jokes || ''} onChange={(e) => setAi({ inside_jokes: e.target.value })} placeholder="e.g. gold gold gold, L, W, Cooked" /></Field>
            </section>
          </div>
        )}
      </Sheet>

      {/* Add streamer */}
      <Sheet open={showAddModal} onClose={() => setShowAddModal(false)} title="Add a streamer"
        footer={<div className="flex gap-2"><Button block onClick={() => setShowAddModal(false)}>Cancel</Button><Button block variant="primary" type="submit" form="add-streamer" loading={isAddingLoading}>{isAddingLoading ? 'Fetching avatar…' : 'Add streamer'}</Button></div>}>
        <p className="text-xs text-muted mb-3">We fetch their avatar automatically and start watching for moments.</p>
        <form id="add-streamer" onSubmit={handleAdd} className="space-y-3.5">
          <Field label="Channel handle / username"><Input required placeholder="e.g. ishowspeed" value={newChannel} onChange={(e) => setNewChannel(e.target.value)} autoCapitalize="none" autoCorrect="off" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Platform"><Select value={newPlatform} onChange={(e) => setNewPlatform(e.target.value)}><option value="twitch">Twitch</option><option value="youtube">YouTube</option></Select></Field>
            <Field label="Layout template"><Select value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>{templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}</Select></Field>
          </div>
          <Field label="Group / niche">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {DEFAULT_GROUPS.map((grp) => {
                const on = newGroupTag === grp && !customGroupInput;
                return (
                  <button key={grp} type="button" aria-pressed={on} onClick={() => { setNewGroupTag(grp); setCustomGroupInput(''); }}
                    className={`h-8 px-3 rounded-lg text-xs font-semibold ${on ? 'bg-accent-strong text-white' : 'bg-white/[0.06] text-muted hover:text-ink'}`}>{grp}</button>
                );
              })}
            </div>
            <Input placeholder="Or type your own (e.g. Minecraft)…" value={customGroupInput} onChange={(e) => setCustomGroupInput(e.target.value)} />
          </Field>
        </form>
      </Sheet>

      <Confirm open={!!confirmRemove} danger title={`Stop watching ${confirmRemove}?`} confirmLabel="Remove"
        text="Recording stops and the streamer disappears from this list. Clips already made are kept."
        onCancel={() => setConfirmRemove(null)} onConfirm={() => handleRemove(confirmRemove)} />
    </Page>
  );
}
