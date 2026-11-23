import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Sheet, Button, Field, Input, Select, Notice } from '../ui';
import { routeKey } from '../distribution/model';
import PostingPicker from './PostingPicker';
import { errText } from './useHub';

export const DEFAULT_GROUPS = ['Casual Gaming', 'GTA RP', 'Valorant', 'IRL', 'Shooters', 'Reaction', 'General'];

/** Accounts most current streamers post to - the likely choice for a new one. */
function usualDestinations(hub) {
  const n = hub.channels.length;
  if (!n) return [];
  return hub.destinations
    .filter((d) => hub.channels.filter((c) => hub.routes.has(routeKey(d, c.channel_id_or_handle))).length >= Math.max(1, n / 2))
    .map((d) => d.id);
}

/** Two steps: who (handle, platform, template, group) -> where their clips post. */
export default function AddStreamerSheet({ hub, open, onClose, onAdded, onConnect }) {
  const [step, setStep] = useState(1);
  const [handle, setHandle] = useState('');
  const [platform, setPlatform] = useState('twitch');
  const [template, setTemplate] = useState('');
  const [group, setGroup] = useState('General');
  const [customGroup, setCustomGroup] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const groups = useMemo(() => {
    const s = new Set(DEFAULT_GROUPS);
    hub.channels.forEach((c) => c.group_tag && s.add(c.group_tag));
    return [...s];
  }, [hub.channels]);

  useEffect(() => {
    if (!open) return;
    setStep(1); setHandle(''); setCustomGroup(''); setError(''); setBusy(false);
    setTemplate((t) => t || hub.templates[0]?.name || '');
    setPicked(usualDestinations(hub));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // a pasted link picks the platform for you
  useEffect(() => {
    const m = handle.match(/(twitch\.tv|youtube\.com|kick\.com)\//i);
    if (m) setPlatform({ 'twitch.tv': 'twitch', 'youtube.com': 'youtube', 'kick.com': 'kick' }[m[1].toLowerCase()]);
  }, [handle]);

  const clean = handle.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(twitch\.tv|youtube\.com|kick\.com)\/@?/i, '').split(/[/?#]/)[0];
  const exists = hub.channels.some((c) => c.channel_id_or_handle.toLowerCase() === clean.toLowerCase());
  const canNext = clean && !exists;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await hub.addStreamer({ platform, channel: clean, template, group: customGroup.trim() || group });
      if (picked.length) await hub.setPosting(clean, picked);
      onAdded?.(clean);
      onClose();
      hub.say(`Watching ${clean}${picked.length ? ` - clips post to ${picked.length} account${picked.length === 1 ? '' : 's'}` : ''}.`);
    } catch (e) {
      setError(`Could not add the streamer: ${errText(e)}`);
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={step === 1 ? 'Add a streamer' : `Where should ${clean}'s clips go?`}
      footer={step === 1 ? (
        <div className="flex gap-2">
          <Button block onClick={onClose}>Cancel</Button>
          <Button block variant="primary" icon={ArrowRight} disabled={!canNext} onClick={() => setStep(2)} data-testid="add-next">Next</Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button icon={ArrowLeft} onClick={() => setStep(1)}>Back</Button>
          <Button block variant="primary" icon={Check} loading={busy} onClick={submit} data-testid="add-submit">
            {picked.length ? `Add & post to ${picked.length}` : 'Add without posting'}
          </Button>
        </div>
      )}>
      {error && <Notice tone="bad" className="mb-3">{error}</Notice>}
      {step === 1 ? (
        <form className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (canNext) setStep(2); }} data-testid="add-step1">
          <Field label="Channel handle or link" error={exists ? 'Already watching this streamer' : undefined}>
            <Input autoFocus required placeholder="e.g. ishowspeed, twitch.tv/… or kick.com/…" value={handle} onChange={(e) => setHandle(e.target.value)}
              autoCapitalize="none" autoCorrect="off" aria-label="Channel handle" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Platform">
              <Select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
                <option value="twitch">Twitch</option><option value="youtube">YouTube</option><option value="kick">Kick</option>
              </Select>
            </Field>
            <Field label="Layout template">
              <Select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Layout template">
                {hub.templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Group">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {groups.map((g) => {
                const on = group === g && !customGroup;
                return (
                  <button key={g} type="button" aria-pressed={on} onClick={() => { setGroup(g); setCustomGroup(''); }}
                    className={`h-8 px-3 rounded-lg text-xs font-semibold ${on ? 'bg-accent-strong text-white' : 'bg-white/[0.06] text-muted hover:text-ink'}`}>{g}</button>
                );
              })}
            </div>
            <Input placeholder="Or a new group (e.g. Minecraft)" value={customGroup} onChange={(e) => setCustomGroup(e.target.value)} />
          </Field>
          <p className="text-[11.5px] text-muted">Their avatar is fetched automatically and watching starts right away.</p>
        </form>
      ) : (
        <div className="space-y-2" data-testid="add-step2">
          <p className="text-[12px] text-muted">
            {picked.length ? 'Pre-selected: the accounts most of your streamers post to.' : 'Pick the accounts that should get this streamer\'s clips.'} You can change this any time.
          </p>
          <PostingPicker destinations={hub.destinations} compact
            isOn={(d) => picked.includes(d.id)}
            onChange={(d, v) => setPicked((p) => (v ? [...new Set([...p, d.id])] : p.filter((x) => x !== d.id)))}
            onConnect={onConnect} />
        </div>
      )}
    </Sheet>
  );
}
