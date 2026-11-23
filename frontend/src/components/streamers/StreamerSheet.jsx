import React, { useEffect, useMemo, useState } from 'react';
import { Save, RefreshCw, Trash2, CheckCircle2 } from 'lucide-react';
import { Sheet, Segmented, Button, Field, Input, Select, Textarea, Confirm, Pill } from '../ui';
import { Avatar } from '../distribution/parts';
import { routeKey } from '../distribution/model';
import PostingPicker from './PostingPicker';
import { errText } from './useHub';

const TABS = [
  { value: 'posting', label: 'Posting' },
  { value: 'rules', label: 'Clip rules' },
  { value: 'ai', label: 'AI persona' },
  { value: 'profile', label: 'Profile' },
];

function formFor(c) {
  const s = c.settings || {};
  return {
    display_name: c.display_name || c.channel_id_or_handle,
    template_name: c.template_name || '',
    group_tag: c.group_tag || 'General',
    avatar_url: c.avatar_url || '',
    notes: c.notes || '',
    clip_rules: {
      min_length: s.clip_rules?.min_length ?? 15,
      max_length: s.clip_rules?.max_length ?? 60,
      min_score: s.clip_rules?.min_score ?? 65,
      cooldown: s.clip_rules?.cooldown ?? 90,
    },
    detection: { chat_spikes: s.detection?.chat_spikes ?? true, audio_peaks: s.detection?.audio_peaks ?? true, gemini_scoring: s.detection?.gemini_scoring ?? true },
    ai: {
      whisper_model: s.ai?.whisper_model || 'base',
      gemini_context: s.ai?.gemini_context || '',
      persona: s.ai?.persona || '', good_clip_notes: s.ai?.good_clip_notes || '', avoid_notes: s.ai?.avoid_notes || '', inside_jokes: s.ai?.inside_jokes || '',
    },
    publishing: { auto_approve_score: s.publishing?.auto_approve_score ?? 95, telegram_alerts: s.publishing?.telegram_alerts ?? true },
  };
}

/** Everything about one streamer in one place: where clips post (instant), clip rules, AI persona, profile. */
export default function StreamerSheet({ hub, channel, tab, onTab, onClose, onConnect, info = {} }) {
  const [form, setForm] = useState(null);
  const [base, setBase] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const handle = channel?.channel_id_or_handle;

  useEffect(() => {
    if (!channel) return;
    const f = formFor(channel);
    setForm(f);
    setBase(JSON.stringify(f));
    setSaved(false);
  }, [handle]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => form && JSON.stringify(form) !== base, [form, base]);
  if (!channel || !form) return null;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setRules = (patch) => setForm((f) => ({ ...f, clip_rules: { ...f.clip_rules, ...patch } }));
  const setAi = (patch) => setForm((f) => ({ ...f, ai: { ...f.ai, ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      await hub.saveStreamer(handle, {
        template_name: form.template_name, display_name: form.display_name, group_tag: form.group_tag,
        avatar_url: form.avatar_url, notes: form.notes,
        settings: { clip_rules: form.clip_rules, detection: form.detection, ai: form.ai, publishing: form.publishing },
      });
      setBase(JSON.stringify(form));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      hub.say(`Save failed: ${errText(e)}`, 'bad');
    } finally {
      setSaving(false);
    }
  };

  const refreshAvatar = async () => {
    setAvatarBusy(true);
    try {
      // the server replaces settings with whatever is sent, so always send the saved ones along
      const res = await hub.saveStreamer(handle, { refresh_avatar: true, settings: channel.settings || {} });
      if (res?.avatar_url) set({ avatar_url: res.avatar_url });
    } catch (e) {
      hub.say(`Couldn't fetch the avatar: ${errText(e)}`, 'bad');
    } finally {
      setAvatarBusy(false);
    }
  };

  const close = () => (dirty ? setConfirmClose(true) : onClose());
  const enabled = channel.enabled === 1;
  const name = channel.display_name || handle;
  const postsCount = hub.postsTo(handle).length;

  return (
    <Sheet open onClose={close} wide title={(
      <span className="flex items-center gap-2.5 min-w-0">
        <Avatar src={form.avatar_url || channel.avatar_url} name={name} platform={(channel.platform || 'twitch').toLowerCase()} size={30} />
        <span className="truncate">{name}</span>
        {!enabled ? <Pill tone="warn">Paused</Pill> : info.is_live ? <Pill tone="bad">LIVE</Pill> : null}
      </span>
    )}
      footer={tab !== 'posting' ? (
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-good font-semibold flex items-center gap-1.5"><CheckCircle2 size={15} />Saved</span>}
          {dirty && !saved && <span className="text-xs text-warn font-semibold">Unsaved changes</span>}
          <Button className="ml-auto" onClick={close}>Close</Button>
          <Button variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={save} data-testid="streamer-save">Save</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-muted">Switches save instantly.</span>
          <Button className="ml-auto" onClick={close}>Done</Button>
        </div>
      )}>
      <div className="space-y-4" data-testid="streamer-sheet">
        <Segmented value={tab} onChange={onTab} ariaLabel="Streamer settings" size="sm" className="w-full [&>button]:flex-1"
          options={TABS.map((t) => (t.value === 'posting' ? { ...t, label: `Posting · ${postsCount}` } : t))} />

        {tab === 'posting' && (
          <section className="space-y-2">
            <p className="text-[12px] text-muted">Clips from <b className="text-ink">{name}</b> go to every account switched on here.</p>
            <PostingPicker destinations={hub.destinations}
              isOn={(d) => hub.routes.has(routeKey(d, handle))}
              busy={(d) => hub.pending.has(routeKey(d, handle))}
              onChange={(d, v) => hub.toggle(d, handle, v)}
              onConnect={onConnect} />
          </section>
        )}

        {tab === 'rules' && (
          <section className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Min length (s)"><Input type="number" inputMode="numeric" min={5} value={form.clip_rules.min_length} onChange={(e) => setRules({ min_length: Number(e.target.value) })} /></Field>
              <Field label="Max length (s)"><Input type="number" inputMode="numeric" min={10} max={90} value={form.clip_rules.max_length} onChange={(e) => setRules({ max_length: Number(e.target.value) })} /></Field>
              <Field label="Min score"><Input type="number" inputMode="numeric" min={0} max={100} value={form.clip_rules.min_score} onChange={(e) => setRules({ min_score: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Layout template" hint="The layout new clips from this streamer use.">
              <Select value={form.template_name} onChange={(e) => set({ template_name: e.target.value })}>
                {!hub.templates.some((t) => t.name === form.template_name) && form.template_name && <option value={form.template_name}>{form.template_name}</option>}
                {hub.templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </Select>
            </Field>
            <p className="text-[11.5px] text-muted">Only moments scoring at least {form.clip_rules.min_score} and {form.clip_rules.min_length}-{form.clip_rules.max_length}s long become clips.</p>
          </section>
        )}

        {tab === 'ai' && (
          <section className="space-y-3">
            <Field label="Creator persona & niche">
              <Textarea rows={2} value={form.ai.persona} onChange={(e) => setAi({ persona: e.target.value })} placeholder="e.g. High-energy streamer who screams at rare drops and talks fast." />
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={<span className="text-good">What makes a good clip</span>}>
                <Textarea rows={3} value={form.ai.good_clip_notes} onChange={(e) => setAi({ good_clip_notes: e.target.value })} placeholder="e.g. Rage quits, voice cracks, big wins." />
              </Field>
              <Field label={<span className="text-bad">What to avoid</span>}>
                <Textarea rows={3} value={form.ai.avoid_notes} onChange={(e) => setAi({ avoid_notes: e.target.value })} placeholder="e.g. Menus, AFK, reading chat." />
              </Field>
            </div>
            <Field label={<span className="text-warn">Inside jokes & catchphrases</span>}>
              <Input value={form.ai.inside_jokes} onChange={(e) => setAi({ inside_jokes: e.target.value })} placeholder="e.g. gold gold gold, L, W, Cooked" />
            </Field>
          </section>
        )}

        {tab === 'profile' && (
          <section className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Display name"><Input value={form.display_name} onChange={(e) => set({ display_name: e.target.value })} /></Field>
              <Field label="Group"><Input value={form.group_tag} onChange={(e) => set({ group_tag: e.target.value })} placeholder="e.g. GTA RP, IRL" /></Field>
            </div>
            <Field label="Avatar image URL" right={(
              <button type="button" onClick={refreshAvatar} disabled={avatarBusy} className="text-[11px] text-accent flex items-center gap-1 font-semibold disabled:opacity-50 min-h-[32px]">
                <RefreshCw size={11} className={avatarBusy ? 'animate-spin' : ''} />{avatarBusy ? 'Fetching…' : 'Auto-fetch'}
              </button>
            )}>
              <Input mono value={form.avatar_url} onChange={(e) => set({ avatar_url: e.target.value })} placeholder="https://…" />
            </Field>
            <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Anything to remember about this streamer" /></Field>
            <div className="pt-3 border-t border-line">
              <Button variant="danger" icon={Trash2} onClick={() => setConfirmRemove(true)}>Stop watching {name}</Button>
              <p className="text-[11px] text-muted mt-1.5">Recording stops and the streamer leaves this list. Clips already made are kept.</p>
            </div>
          </section>
        )}
      </div>

      <Confirm open={confirmClose} title="Discard your changes?" confirmLabel="Discard" danger
        text="You changed this streamer's settings without saving." onCancel={() => setConfirmClose(false)}
        onConfirm={() => { setConfirmClose(false); onClose(); }} />
      <Confirm open={confirmRemove} title={`Stop watching ${name}?`} confirmLabel="Remove" danger
        text="Recording stops and the streamer disappears from this list. Clips already made are kept."
        onCancel={() => setConfirmRemove(false)} onConfirm={async () => { setConfirmRemove(false); await hub.remove(handle); onClose(); }} />
    </Sheet>
  );
}
