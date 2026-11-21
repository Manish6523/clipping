import React, { useMemo, useState } from 'react';
import { LayoutGrid, Clapperboard, Search, SlidersHorizontal, X } from 'lucide-react';
import { Segmented, Input, Select, Sheet, Button, Field } from '../ui';
import { useLayoutMode } from '../../hooks/useLayoutMode';
import PublishSheet from '../PublishSheet';
import { useClipFeed } from './useClipFeed';
import { useClipActions } from './useClipActions';
import ClipGrid from './ClipGrid';
import ClipReels from './ClipReels';
import StyleSheet from './StyleSheet';
import UndoBar from './UndoBar';
import { STATUS_TABS, SORTS } from './model';

const VIEW_KEY = 'autoclip_clips_view';
const GROUP_KEY = 'autoclip_clips_group';
const SCORES = [0, 60, 70, 80, 90];

function Filters({ feed, group, setGroup, view, stacked = false }) {
  const { filters, setFilters, channels } = feed;
  const cls = stacked ? 'w-full' : '!h-9 !w-auto !text-xs';
  const wrap = (label, el) => (stacked ? <Field label={label}>{el}</Field> : el);
  return (
    <>
      {wrap('Streamer', (
        <Select value={filters.channel} onChange={(e) => setFilters({ channel: e.target.value })} aria-label="Streamer" className={cls}>
          <option value="all">All streamers</option>
          {channels.map((c) => <option key={c.id} value={c.id}>@{c.id} ({c.count})</option>)}
        </Select>
      ))}
      {wrap('Minimum score', (
        <Select value={String(filters.min_score || 0)} onChange={(e) => setFilters({ min_score: Number(e.target.value) })} aria-label="Minimum score" className={cls}>
          {SCORES.map((s) => <option key={s} value={s}>{s ? `Score ${s}+` : 'Any score'}</option>)}
        </Select>
      ))}
      {wrap('Sort', (
        <Select value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value })} aria-label="Sort" className={cls}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      ))}
      {view === 'grid' && wrap('Group', (
        <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group" className={cls}>
          <option value="none">No grouping</option>
          <option value="channel">By streamer</option>
          <option value="day">By day</option>
        </Select>
      ))}
    </>
  );
}

/** Home: every clip, as a grid or as reels, with the same details and actions in both. */
export default function ClipsPage() {
  const { isPhone, width } = useLayoutMode();
  const isWide = (width || window.innerWidth) >= 1024;
  const [view, setViewState] = useState(() => { try { return localStorage.getItem(VIEW_KEY) || (isPhone ? 'reels' : 'grid'); } catch { return 'grid'; } });
  const [group, setGroupState] = useState(() => { try { return localStorage.getItem(GROUP_KEY) || 'none'; } catch { return 'none'; } });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [publishing, setPublishing] = useState(null);
  const [styling, setStyling] = useState(null);
  const feed = useClipFeed();
  const actions = useClipActions();

  const setView = (v) => { actions.flush(); setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* */ } };
  const setGroup = (g) => { setGroupState(g); try { localStorage.setItem(GROUP_KEY, g); } catch { /* */ } };

  const clips = useMemo(() => feed.clips.filter((c) => !actions.hidden.has(c.id)), [feed.clips, actions.hidden]);
  const { filters, setFilters, counts } = feed;
  const tabs = STATUS_TABS.map((t) => ({ value: t.value, label: counts ? `${t.label} ${counts[t.value] ?? 0}` : t.label }));
  const activeFilters = (filters.channel !== 'all') + (Number(filters.min_score) > 0) + (filters.sort !== 'new');

  const reels = view === 'reels';
  const toolbar = (
    <div className={`shrink-0 space-y-2 ${reels && isPhone ? 'px-3 pt-2 pb-1.5' : ''}`}>
      <div className="flex items-center gap-2">
        <h1 className="text-[17px] font-bold text-ink mr-auto">Clips</h1>
        <Segmented value={view} onChange={setView} ariaLabel="View" size="sm"
          options={[{ value: 'grid', label: 'Grid', icon: LayoutGrid }, { value: 'reels', label: 'Reels', icon: Clapperboard }]} />
        {isPhone && (
          <Button size="sm" variant={activeFilters ? 'primary' : 'secondary'} icon={SlidersHorizontal} onClick={() => setFiltersOpen(true)} aria-label="Filters">
            {activeFilters || ''}
          </Button>
        )}
      </div>
      <Segmented value={filters.status} onChange={(v) => setFilters({ status: v })} options={tabs} ariaLabel="Status" size="sm" className="max-w-full" />
      {(!isPhone || !reels) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <Input value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} placeholder="Search title, description, #tag, @streamer, id"
              className="!h-9 !pl-8 !text-[13px]" aria-label="Search clips" onKeyDown={(e) => e.stopPropagation()} />
            {filters.q && <button type="button" onClick={() => setFilters({ q: '' })} aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-muted"><X size={14} /></button>}
          </div>
          {!isPhone && <Filters feed={feed} group={group} setGroup={setGroup} view={view} />}
        </div>
      )}
    </div>
  );

  return (
    <div className={reels ? `flex flex-col ${isPhone ? '' : 'px-4 pt-3 max-w-[1600px] mx-auto'} h-[calc(100dvh-56px-64px-var(--safe-bottom))] md:h-[calc(100dvh-56px)]`
      : 'px-3 md:px-4 pt-3 pb-24 md:pb-8 max-w-[1600px] mx-auto space-y-3'} data-testid="clips-page">
      {toolbar}
      {reels ? (
        <div className="flex-1 min-h-0">
          <ClipReels feed={feed} clips={clips} actions={actions} onPublish={setPublishing} onStyle={setStyling} isWide={isWide} />
        </div>
      ) : (
        <ClipGrid feed={feed} clips={clips} actions={actions} onPublish={setPublishing} onStyle={setStyling} isWide={isWide} group={group} />
      )}

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters"
        footer={<Button block variant="primary" onClick={() => setFiltersOpen(false)}>Show clips</Button>}>
        <div className="space-y-3">
          {reels && (
            <Field label="Search">
              <Input value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} placeholder="Title, description, #tag, @streamer" />
            </Field>
          )}
          <Filters feed={feed} group={group} setGroup={setGroup} view={view} stacked />
          <Button block variant="ghost" onClick={() => setFilters({ channel: 'all', min_score: 0, sort: 'new', q: '' })}>Reset filters</Button>
        </div>
      </Sheet>
      <PublishSheet open={!!publishing} clip={publishing} onClose={() => setPublishing(null)}
        onDone={() => { setPublishing(null); actions.refresh(); actions.flash('Publishing started', 'ok'); }} />
      <StyleSheet clip={styling} onClose={() => setStyling(null)} actions={actions} />
      <UndoBar actions={actions} />
    </div>
  );
}
