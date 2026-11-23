import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, RefreshCw, Eye, Film, Percent, Brain, Clock, Trophy, FlaskConical, Languages, Sparkles,
  MonitorPlay, Camera, AlertTriangle, Check, Square,
} from 'lucide-react';
import {
  Page, Panel, Stat, Segmented, Button, Toggle, Chip, Select, Field, Notice, Skeleton, EmptyState, Pill, Badge,
} from './ui';
import {
  getPerformance, refreshPerformance, saveGrowthSettings, stopTitleTest, patchYouTubeAccountConfig, getYouTubeAccounts,
  withToken,
} from '../api';

const fmt = (n) => (n == null ? '–' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);
const errText = (e) => e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || String(e);
const GROUPS = [['streamer', 'Streamer'], ['trigger', 'Trigger'], ['length', 'Length'], ['layout', 'Layout'], ['mood', 'Chat mood'], ['style', 'Edit style']];
const TRIGGER_LABEL = { chat_spike: 'Chat spike', keyword_hit: 'Chat keywords', emote_burst: 'Emote wall', audio_peak: 'Loud moment', community_clip: 'Viewer clip', vod_heatmap: 'VOD replay peak' };
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

/** Hover readout shared by the small charts (a mark's title is the accessible fallback). */
function useHover() {
  const [tip, setTip] = useState(null);
  return { tip, on: (text) => () => setTip(text), off: () => setTip(null) };
}

function DailyViews({ daily }) {
  const { tip, on, off } = useHover();
  if (!daily?.length) return <p className="text-xs text-muted py-6 text-center">Views appear here 24 hours after the first post.</p>;
  const max = Math.max(1, ...daily.map((d) => d.views));
  const H = 120;
  return (
    <div>
      <div className="h-5 text-[11.5px] text-muted tabular-nums" aria-live="polite">{tip || `Peak day: ${fmt(max)} views`}</div>
      <div className="flex items-end gap-[2px] h-[120px]" role="img" aria-label="Views per posting day">
        {daily.map((d) => {
          const h = Math.max(3, Math.round((d.views / max) * H));
          const label = `${new Date(d.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${d.views.toLocaleString()} views from ${d.posts} post${d.posts === 1 ? '' : 's'}`;
          return (
            <div key={d.date} className="flex-1 min-w-[3px] h-full flex items-end cursor-default" onMouseEnter={on(label)} onMouseLeave={off} onFocus={on(label)} onBlur={off} tabIndex={0} title={label}>
              <div className="w-full rounded-t-[4px] bg-accent/80 hover:bg-accent transition-colors" style={{ height: h }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-faint mt-1 tabular-nums">
        <span>{new Date(daily[0].date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        <span>{new Date(daily[daily.length - 1].date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
      </div>
    </div>
  );
}

/** 24 cells, one hue light->dark by how well that hour did; grey = nothing posted then. */
function HourStrip({ hours, best }) {
  const { tip, on, off } = useHover();
  const by = Object.fromEntries((hours || []).map((h) => [h.hour, h]));
  const lifts = (hours || []).map((h) => h.lift);
  const lo = Math.min(0, ...lifts);
  const hi = Math.max(0.0001, ...lifts);
  return (
    <div>
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }} role="img" aria-label="Views by posting hour">
        {Array.from({ length: 24 }, (_, h) => {
          const d = by[h];
          const t = d ? (d.lift - lo) / (hi - lo || 1) : null;
          const label = d ? `${hourLabel(h)}: ${d.n} post${d.n === 1 ? '' : 's'}, median ${d.median_views.toLocaleString()} views` : `${hourLabel(h)}: nothing posted yet`;
          return (
            <div key={h} tabIndex={0} title={label} onMouseEnter={on(label)} onMouseLeave={off} onFocus={on(label)} onBlur={off}
              className={`h-7 rounded-[4px] relative ${best?.includes(h) ? 'ring-2 ring-ink/80 ring-offset-1 ring-offset-surface' : ''}`}
              style={{ background: d ? `color-mix(in srgb, var(--color-accent) ${Math.round(20 + 75 * t)}%, var(--color-surface))` : 'rgba(255,255,255,0.04)' }} />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-faint mt-1 tabular-nums"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
      <div className="h-4 text-[11px] text-muted tabular-nums">{tip || (best?.length ? `Best: ${best.map(hourLabel).join(', ')} (outlined)` : 'Darker = more views. Best hours appear after ~8 posts at different times.')}</div>
    </div>
  );
}

function LearnedTable({ groups, feature }) {
  const rows = Object.entries(groups?.[feature] || {}).sort((a, b) => b[1].lift - a[1].lift);
  if (!rows.length) return <p className="text-xs text-muted py-4">No posted clips with this detail yet.</p>;
  const maxAbs = Math.max(0.5, ...rows.map(([, g]) => Math.abs(g.points)));
  return (
    <table className="w-full text-[12px]">
      <thead><tr className="text-muted text-[11px] text-left"><th className="font-medium py-1">{GROUPS.find((g) => g[0] === feature)?.[1]}</th><th className="font-medium text-right">Clips</th><th className="font-medium text-right">Median views</th><th className="font-medium text-right pl-3 w-[38%]">Effect on new scores</th></tr></thead>
      <tbody>
        {rows.map(([value, g]) => (
          <tr key={value} className="border-t border-line">
            <td className="py-1.5 pr-2 text-ink truncate max-w-[140px]">{feature === 'trigger' ? TRIGGER_LABEL[value] || value : value}</td>
            <td className="text-right tabular-nums text-muted">{g.n}{g.n < 2 && <span className="text-faint" title="Needs 2+ clips before it counts">*</span>}</td>
            <td className="text-right tabular-nums text-ink">{fmt(g.median_views)}</td>
            <td className="pl-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] relative overflow-hidden">
                  <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/20" />
                  <div className={`absolute top-0 bottom-0 rounded-full ${g.points >= 0 ? 'bg-accent' : 'bg-white/35'}`}
                    style={g.points >= 0 ? { left: '50%', width: `${(g.points / maxAbs) * 50}%` } : { right: '50%', width: `${(-g.points / maxAbs) * 50}%` }} />
                </div>
                <span className="tabular-nums text-muted w-12 text-right">{g.points > 0 ? '+' : ''}{g.points.toFixed(1)}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TitleTest({ t, onKeep, busy }) {
  const max = Math.max(1, ...t.variants.map((v) => v.views_per_hour || 0));
  const running = t.status === 'running';
  return (
    <div className="rounded-xl border border-line bg-canvas p-3 space-y-2" data-testid="title-test">
      <div className="flex items-center gap-2 text-[11.5px]">
        {t.has_thumb && <img src={withToken(`/api/clips/${t.clip_id}/thumbnail`)} alt="" className="w-7 h-12 rounded object-cover bg-black" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Pill tone={running ? 'warn' : t.status === 'done' ? 'good' : t.status === 'failed' ? 'bad' : 'idle'}>
              {running ? `Testing · window ${t.rounds_done + 1}/${t.rounds_total}` : t.status === 'done' ? 'Finished' : t.status === 'failed' ? 'Failed' : 'Stopped'}
            </Pill>
            <a href={`https://youtube.com/shorts/${t.video_id}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open Short</a>
          </div>
          {t.note && <p className="text-muted mt-0.5 truncate" title={t.note}>{t.note}</p>}
        </div>
      </div>
      {t.variants.map((v, i) => {
        const live = i === t.current_idx;
        return (
          <div key={i} className="flex items-center gap-2">
            <Badge tone={live ? 'accent' : 'idle'}>{String.fromCharCode(65 + i)}</Badge>
            <div className="min-w-0 flex-1">
              <div className={`text-[12.5px] truncate ${live ? 'text-ink font-semibold' : 'text-slate-300'}`} title={v.title}>{v.title}{i === 0 && <span className="text-faint font-normal"> · original</span>}</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${((v.views_per_hour || 0) / max) * 100}%` }} />
                </div>
                <span className="text-[10.5px] text-muted tabular-nums w-20 text-right">{v.views_per_hour == null ? 'not yet' : `${v.views_per_hour} views/h`}</span>
              </div>
            </div>
            {running && !live && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onKeep(t, i)}>Use</Button>}
            {live && <span className="text-[10.5px] text-accent font-semibold w-10 text-right">{running ? 'live' : 'kept'}</span>}
          </div>
        );
      })}
      {running && (
        <div className="flex justify-between items-center pt-1">
          <span className="text-[10.5px] text-faint">Next switch {t.next_switch_at ? new Date(t.next_switch_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–'}</span>
          <Button size="sm" icon={Square} disabled={busy} onClick={() => onKeep(t, null)}>Stop, keep live title</Button>
        </div>
      )}
    </div>
  );
}

export default function PerformancePage() {
  const [days, setDays] = useState('30');
  const [data, setData] = useState(null);
  const [ytAccounts, setYtAccounts] = useState([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [group, setGroup] = useState('streamer');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.allSettled([getPerformance(Number(days)), getYouTubeAccounts()]);
      if (p.status === 'fulfilled') { setData(p.value); setError(''); } else setError(errText(p.reason));
      if (a.status === 'fulfilled') setYtAccounts(Array.isArray(a.value) ? a.value : a.value?.accounts || []);
    } catch (e) { setError(errText(e)); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const say = (t) => { setToast(t); setTimeout(() => setToast(''), 3500); };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await refreshPerformance();
      say(`Updated: ${r.new_snapshots} new view snapshot${r.new_snapshots === 1 ? '' : 's'}, learning from ${r.clips_learned_from} clips.`);
      await load();
    } catch (e) { setError(errText(e)); } finally { setRefreshing(false); }
  };
  const setGrowth = async (patch) => {
    setData((d) => ({ ...d, growth_settings: { ...d.growth_settings, ...patch } }));
    try { const s = await saveGrowthSettings(patch); setData((d) => ({ ...d, growth_settings: s })); } catch (e) { setError(errText(e)); load(); }
  };
  const setSmart = async (key, on) => {
    setData((d) => ({ ...d, accounts: d.accounts.map((a) => (a.account_key === key ? { ...a, smart_slots: on } : a)) }));
    try { await patchYouTubeAccountConfig(key, { smart_slots: on }); say(on ? 'Smart post times on.' : 'Back to your own posting slots.'); } catch (e) { setError(errText(e)); load(); }
  };
  const keep = async (t, idx) => {
    setBusy(true);
    try { await stopTitleTest(t.id, idx); say(idx == null ? 'Test stopped.' : `Title ${String.fromCharCode(65 + idx)} is live now.`); await load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const needsReconnect = useMemo(() => ytAccounts.filter((a) => a.has_token_file !== false && a.can_edit_videos === false), [ytAccounts]);
  const g = data?.growth_settings;
  const learning = data?.learning;

  return (
    <Page title="Performance" icon={TrendingUp} subtitle="What actually got watched, what the AI learned from it, and the tests running on your Shorts."
      actions={(
        <>
          <Segmented size="sm" pill value={days} onChange={setDays} ariaLabel="Time range"
            options={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} />
          <Button size="sm" icon={RefreshCw} loading={refreshing} onClick={refresh}>Update now</Button>
        </>
      )}>
      {error && <Notice tone="bad" icon={AlertTriangle}>{error}</Notice>}
      {toast && <Notice tone="good" icon={Check}>{toast}</Notice>}
      {!data && !error && <div className="grid gap-3"><Skeleton className="h-20" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5" data-testid="perf-stats">
            <Stat label="Posted clips" value={data.totals.posts} icon={Film} sub={`last ${data.days} days`} />
            <Stat label="Views" value={fmt(data.totals.views)} icon={Eye}
              sub={Object.entries(data.platforms).map(([p, v]) => `${p === 'youtube' ? 'YT' : p === 'instagram' ? 'IG' : p} ${fmt(v.views)}`).join(' · ') || '—'} />
            <Stat label="Typical clip" value={fmt(data.totals.median_views)} icon={TrendingUp} sub="median views" />
            <Stat label="Avg. % viewed" value={data.totals.avg_retention == null ? '–' : `${data.totals.avg_retention}%`} icon={Percent} sub="YouTube retention" />
            <Stat label="Learning from" value={learning.n} icon={Brain} sub="clips with real numbers" className="col-span-2 md:col-span-1" />
          </div>

          <div className="grid lg:grid-cols-[1.3fr_1fr] gap-3">
            <Panel title="Views by posting day" icon={Eye}><DailyViews daily={data.daily} /></Panel>
            <Panel title="What the AI learned" icon={Brain} right={learning.updated_at && <span className="text-[10.5px] text-faint">updated {new Date(learning.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}>
              <ul className="space-y-1.5" data-testid="insights">
                {(learning.insights.length ? learning.insights : ['Nothing to learn yet - views are collected 24 h, 72 h and 7 days after each post.']).map((s) => (
                  <li key={s} className="text-[12.5px] text-slate-300 flex gap-2"><Sparkles size={13} className="text-accent shrink-0 mt-0.5" />{s}</li>
                ))}
              </ul>
              <p className="text-[11px] text-muted mt-3 leading-snug">
                New clips get a small nudge (at most ±8 points) toward what got views here. Viewer-made Twitch clips add up to +10.
                Small groups barely count until they have more posts.
              </p>
            </Panel>
          </div>

          <Panel title="What works" icon={Trophy} right={<span className="text-[10.5px] text-faint hidden sm:inline">Effect = points added to a new clip's score</span>}>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-2 -mx-1 px-1">
              {GROUPS.map(([k, l]) => <Chip key={k} active={group === k} onClick={() => setGroup(k)}>{l}</Chip>)}
            </div>
            <div className="overflow-x-auto"><LearnedTable groups={learning.groups} feature={group} /></div>
          </Panel>

          <Panel title="Best time to post" icon={Clock}>
            <HourStrip hours={learning.hours} best={learning.best_hours} />
            <div className="mt-3 space-y-2.5">
              {data.accounts.length === 0 && <p className="text-xs text-muted">Connect a YouTube channel to schedule by the best hours.</p>}
              {data.accounts.map((a) => (
                <div key={a.account_key} className="rounded-xl border border-line bg-canvas px-3 py-2" data-testid="smart-times">
                  <Toggle checked={a.smart_slots} onChange={(v) => setSmart(a.account_key, v)}
                    label={<span className="flex items-center gap-1.5"><MonitorPlay size={13} className="text-[#ff4e45]" />{a.title} · Smart post times</span>}
                    hint={a.smart_slots
                      ? (a.best_hours ? `Posting at ${a.best_hours.slice(0, a.daily_cap).map(hourLabel).join(', ')} (${a.timezone}) - learned from your views.` : `Not enough posts on this channel yet - using your slots ${a.manual_slots.join(', ')} until it learns.`)
                      : `Using your own slots: ${a.manual_slots.join(', ')} (${a.timezone}).`} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Top clips" icon={Trophy} pad={false}>
            {data.top.length === 0 ? <EmptyState icon={Eye} title="No numbers yet" text="Posted clips show up here once their first views are collected." /> : (
              <ul className="divide-y divide-line">
                {data.top.map((c, i) => (
                  <li key={c.clip_id} className="flex items-center gap-3 px-3.5 py-2.5" data-testid="top-clip">
                    <span className="w-5 text-[12px] text-faint tabular-nums">{i + 1}</span>
                    {c.has_thumb ? <img src={withToken(`/api/clips/${c.clip_id}/thumbnail`)} alt="" className="w-8 h-14 rounded-md object-cover bg-black shrink-0" loading="lazy" /> : <div className="w-8 h-14 rounded-md bg-raised shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-ink font-medium truncate">{c.title}</div>
                      <div className="text-[11px] text-muted truncate">@{c.channel_id} · {c.template} {c.ai_score != null && <>· AI score {Math.round(c.ai_score)}</>}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[14px] font-semibold text-ink tabular-nums">{fmt(c.views)}</div>
                      <div className="text-[10.5px] text-muted flex items-center gap-1.5 justify-end">
                        {c.platforms.youtube && <span className="inline-flex items-center gap-0.5"><MonitorPlay size={10} />{fmt(c.platforms.youtube.views)}</span>}
                        {c.platforms.instagram && <span className="inline-flex items-center gap-0.5"><Camera size={10} />{fmt(c.platforms.instagram.views)}</span>}
                        {c.retention != null && <span>{c.retention}%</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid lg:grid-cols-2 gap-3">
            <Panel title="Title tests" icon={FlaskConical}>
              {needsReconnect.length > 0 && (
                <Notice tone="warn" icon={AlertTriangle} className="mb-3">
                  {needsReconnect.map((a) => a.channel_title || a.account_key).join(', ')} {needsReconnect.length === 1 ? 'needs' : 'need'} to reconnect once
                  to allow title tests and translations (new YouTube permission). <Link to="/accounts" className="underline">Open accounts</Link> and sign in again.
                </Notice>
              )}
              <Toggle checked={!!g.ab_titles} onChange={(v) => setGrowth({ ab_titles: v })} label="Test 3 titles on every new Short"
                hint="The AI writes 2 more titles. Each runs in turn (A B C C B A) and the one that gets the most views per hour stays." />
              <Toggle checked={!!g.ab_thumbnails} onChange={(v) => setGrowth({ ab_thumbnails: v })} label="Also test a thumbnail per title"
                hint="Uses a different frame for each title. YouTube shows custom thumbnails in search and on your channel, not in the Shorts feed; needs a verified channel." />
              <Field label="Each title runs for" className="mt-2">
                <Select value={String(g.ab_window_hours)} onChange={(e) => setGrowth({ ab_window_hours: Number(e.target.value) })} aria-label="Window length">
                  {[2, 3, 4, 6, 8, 12].map((h) => <option key={h} value={h}>{h} hours per window</option>)}
                </Select>
              </Field>
              <p className="text-[11px] text-muted mt-2">YouTube's own Test & Compare isn't available to apps, so titles take turns. Each switch costs 50 of the 10,000 daily quota units. Tests pause when quota is low.</p>
              <div className="space-y-2.5 mt-3">
                {data.title_tests.length === 0 ? <p className="text-xs text-muted">Tests start when the next Short uploads.</p>
                  : data.title_tests.map((t) => <TitleTest key={t.id} t={t} onKeep={keep} busy={busy} />)}
              </div>
            </Panel>

            <Panel title="Translations" icon={Languages}>
              <Toggle checked={!!g.translate_titles} onChange={(v) => setGrowth({ translate_titles: v })} label="Translated titles & descriptions"
                hint="Viewers whose YouTube is in that language see the translated title. One quota-cheap update per Short." />
              <Toggle checked={!!g.translate_captions} onChange={(v) => setGrowth({ translate_captions: v })} label="Translated caption tracks"
                hint="Transcribes the finished Short and uploads a subtitle track per language (400 quota units each, skipped when uploads need the quota)." />
              <Field label="Languages (up to 5)" className="mt-2">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(data.languages).map(([code, name]) => {
                    const on = g.languages.includes(code);
                    return (
                      <Chip key={code} active={on} onClick={() => {
                        const next = on ? g.languages.filter((l) => l !== code) : [...g.languages, code];
                        if (next.length <= 5) setGrowth({ languages: next });
                      }}>{name}</Chip>
                    );
                  })}
                </div>
              </Field>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {data.translations.length === 0 ? <p className="text-xs text-muted col-span-full">Translations are added right after the next upload.</p> : data.translations.map((t) => (
                  <div key={t.language} className="rounded-xl border border-line bg-canvas px-3 py-2 text-[11.5px]">
                    <div className="text-ink font-semibold">{t.name}</div>
                    <div className="text-muted">{t.titles} titles · {t.captions} captions{t.failed ? <span className="text-warn"> · {t.failed} failed</span> : null}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}
    </Page>
  );
}
