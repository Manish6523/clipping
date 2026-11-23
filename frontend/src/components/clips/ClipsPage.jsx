import React, { useMemo, useState } from 'react';
import { LayoutGrid, Clapperboard, Search, SlidersHorizontal, X } from 'lucide-react';
import { Input, Select, Sheet, Button, Field, PILL } from '../ui';
import { useLayoutMode } from '../../hooks/useLayoutMode';
import PublishSheet from '../PublishSheet';
import { useClipFeed } from './useClipFeed';
import { useClipActions } from './useClipActions';
import ClipGrid from './ClipGrid';
import ClipReels from './ClipReels';
import StyleSheet from './StyleSheet';
import UndoBar from './UndoBar';
import EditsSheet from './EditsSheet';
import { STATUS_TABS, SORTS } from './model';

const VIEW_KEY = 'autoclip_clips_view';
const GROUP_KEY = 'autoclip_clips_group';
const SCORES = [0, 60, 70, 80, 90];

function Filters({ feed, group, setGroup, view, stacked = false }) {
  const { filters, setFilters, channels } = feed;
  const cls = stacked ? 'w-full' : '!w-auto';
  const wrap = (label, el) => (stacked ? <Field label={label}>{el}</Field> : el);
  return (
    <>
      {wrap('Streamer', (
        <Select value={filters.channel} onChange={(e) => setFilters({ channel: e.target.value })} aria-label="Streamer" className={cls} pill={!stacked}>
          <option value="all">All streamers</option>
          {channels.map((c) => <option key={c.id} value={c.id}>@{c.id} ({c.count})</option>)}
        </Select>
      ))}
      {wrap('Minimum score', (
        <Select value={String(filters.min_score || 0)} onChange={(e) => setFilters({ min_score: Number(e.target.value) })} aria-label="Minimum score" className={cls} pill={!stacked}>
          {SCORES.map((s) => <option key={s} value={s}>{s ? `Score ${s}+` : 'Any score'}</option>)}
        </Select>
      ))}
      {wrap('Sort', (
        <Select value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value })} aria-label="Sort" className={cls} pill={!stacked}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      ))}
      {view === 'grid' && wrap('Group', (
        <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group" className={cls} pill={!stacked}>
          <option value="none">No grouping</option>
          <option value="channel">By streamer</option>
          <option value="day">By day</option>
        </Select>
      ))}
    </>
  );
}

export default function ClipsPage() {
  const { isPhone, width } = useLayoutMode();
  const isWide = (width || window.innerWidth) >= 1024;
  const [view, setViewState] = useState(() => { try { return localStorage.getItem(VIEW_KEY) || (isPhone ? 'reels' : 'grid'); } catch { return 'grid'; } });
  const [group, setGroupState] = useState(() => { try { return localStorage.getItem(GROUP_KEY) || 'none'; } catch { return 'none'; } });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [publishing, setPublishing] = useState(null);
  const [styling, setStyling] = useState(null);
  const [editing, setEditing] = useState(null);
  const feed = useClipFeed();
  const actions = useClipActions();

  const setView = (v) => { actions.flush(); setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* */ } };
  const setGroup = (g) => { setGroupState(g); try { localStorage.setItem(GROUP_KEY, g); } catch { /* */ } };

  const clips = useMemo(() => feed.clips.filter((c) => !actions.hidden.has(c.id)), [feed.clips, actions.hidden]);
  const { filters, setFilters, counts } = feed;
  const tabs = STATUS_TABS.map((t) => ({ value: t.value, label: counts ? `${t.label} ${counts[t.value] ?? 0}` : t.label }));
  const activeFilters = (filters.channel !== 'all') + (Number(filters.min_score) > 0) + (filters.sort !== 'new');

  const reels = view === 'reels';

  // Unified sleek header:
  // - Category dropdown pill with counts (e.g. "To review 50 ▾")
  // - Fast search bar (on desktop or in grid)
  // - Streamlined inline filters
  // - Rounded View Toggle [Grid | Reels]
  const unifiedHeader = (
    <div className={`shrink-0 z-30 flex items-center justify-between gap-2 ${
      reels && isPhone ? 'absolute top-3 inset-x-3 pointer-events-none' : 'w-full pb-1'
    }`}>
      {/* Left: Category Dropdown & Clips Title */}
      <div className="flex items-center gap-2 pointer-events-auto min-w-0">
        {!isPhone && <h1 className="text-[17px] font-bold text-ink shrink-0 mr-1">Clips</h1>}
        
        <div className="relative inline-flex items-center">
          <Select pill aria-label="Status" value={filters.status} onChange={(e) => setFilters({ status: e.target.value })} className="!w-auto">
            {tabs.map((t) => (
              <option key={t.value} value={t.value} className="bg-surface text-ink">{t.label}</option>
            ))}
          </Select>
        </div>

        {/* Search input on desktop */}
        {!isPhone && (
          <div className="relative w-64 max-w-xs ml-2">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <Input
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="Search clips, #tag, @streamer…"
              pill
              className="!pl-8"
              aria-label="Search clips"
              onKeyDown={(e) => e.stopPropagation()}
            />
            {filters.q && (
              <button
                type="button"
                onClick={() => setFilters({ q: '' })}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-muted hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right: Filters & View Switcher */}
      <div className="flex items-center gap-1.5 pointer-events-auto shrink-0">
        {!isPhone && <Filters feed={feed} group={group} setGroup={setGroup} view={view} />}

        {isPhone && (
          <button type="button" onClick={() => setFiltersOpen(true)} aria-label="Open Filters" title="Filters"
            className={`${PILL} relative w-9 h-9 flex items-center justify-center ${activeFilters ? '!bg-accent-strong !border-accent-strong text-white' : ''}`}>
            <SlidersHorizontal size={14} />
            {activeFilters > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent text-white text-[9.5px] font-bold flex items-center justify-center border border-black">
                {activeFilters}
              </span>
            )}
          </button>
        )}

        {/* Unified View Toggle Pill [Grid | Reels] - Uniform with top navbar */}
        <div className={`${PILL} p-0.5 flex items-center`} role="group" aria-label="View">
          <button
            type="button"
            onClick={() => setView('grid')}
            title="Grid view"
            aria-label="Switch to Grid view"
            aria-pressed={view === 'grid'}
            className={`flex items-center justify-center gap-1.5 px-2.5 h-8 rounded-full text-xs font-semibold transition-colors ${
              view === 'grid' ? 'bg-white/[0.12] text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            <LayoutGrid size={13} />
            <span className="hidden sm:inline">Grid</span>
          </button>
          <button
            type="button"
            onClick={() => setView('reels')}
            title="Reels view"
            aria-label="Switch to Reels view"
            aria-pressed={view === 'reels'}
            className={`flex items-center justify-center gap-1.5 px-2.5 h-8 rounded-full text-xs font-semibold transition-colors ${
              view === 'reels' ? 'bg-white/[0.12] text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            <Clapperboard size={13} />
            <span className="hidden sm:inline">Reels</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={
        reels
          ? isPhone
            ? 'relative h-[calc(100dvh-56px-64px-env(safe-area-inset-bottom))] w-full overflow-hidden'
            : 'flex flex-col px-4 pt-2.5 max-w-[1600px] mx-auto h-[calc(100dvh-56px)] select-none'
          : 'px-3 sm:px-5 pt-3 pb-24 md:pb-8 max-w-[1600px] mx-auto space-y-3'
      }
      data-testid="clips-page"
    >
      {unifiedHeader}

      {reels ? (
        <div className="flex-1 min-h-0 h-full overflow-hidden">
          <ClipReels
            feed={feed}
            clips={clips}
            actions={actions}
            onPublish={setPublishing}
            onStyle={setStyling}
            onEdits={setEditing}
            isWide={isWide}
          />
        </div>
      ) : (
        <ClipGrid
          feed={feed}
          clips={clips}
          actions={actions}
          onPublish={setPublishing}
          onStyle={setStyling}
          onEdits={setEditing}
          isWide={isWide}
          group={group}
        />
      )}

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters & Search"
        footer={<Button block variant="primary" onClick={() => setFiltersOpen(false)}>Apply</Button>}
      >
        <div className="space-y-3">
          <Field label="Search">
            <Input
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="Title, description, #tag, @streamer…"
            />
          </Field>
          <Filters feed={feed} group={group} setGroup={setGroup} view={view} stacked />
          <Button
            block
            variant="ghost"
            onClick={() => setFilters({ channel: 'all', min_score: 0, sort: 'new', q: '' })}
          >
            Reset all filters
          </Button>
        </div>
      </Sheet>

      <PublishSheet
        open={!!publishing}
        clip={publishing}
        onClose={() => setPublishing(null)}
        onDone={() => {
          setPublishing(null);
          actions.refresh();
          actions.flash('Publishing started', 'ok');
        }}
      />
      <StyleSheet clip={styling} onClose={() => setStyling(null)} actions={actions} />
      <EditsSheet clip={editing} onClose={() => setEditing(null)} actions={actions} />
      <UndoBar actions={actions} />
    </div>
  );
}
