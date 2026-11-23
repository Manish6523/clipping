import React, { useMemo, useState } from 'react';
import { LayoutGrid, Clapperboard, Search, SlidersHorizontal, X } from 'lucide-react';
import { Input, Select, Sheet, Button, Field } from '../ui';
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
  const cls = stacked ? 'w-full' : '!h-8 !w-auto !text-xs !bg-white/[0.05] !border-white/10 !rounded-full !px-3';
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
          <select
            aria-label="Status"
            value={filters.status}
            onChange={(e) => setFilters({ status: e.target.value })}
            className="h-8.5 pl-3.5 pr-8 rounded-full bg-white/[0.08] hover:bg-white/[0.12] backdrop-blur-md border border-white/15 text-[12px] font-semibold text-white shadow-sm appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent transition-all"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2.2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.65rem center',
              backgroundSize: '0.8em',
            }}
          >
            {tabs.map((t) => (
              <option key={t.value} value={t.value} className="bg-surface text-ink">
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Search input on desktop */}
        {!isPhone && (
          <div className="relative w-64 max-w-xs ml-2">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <Input
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="Search clips, #tag, @streamer…"
              className="!h-8.5 !pl-8.5 !text-[12px] !rounded-full !bg-white/[0.05] !border-white/10"
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
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label="Open Filters"
            className={`h-8.5 w-8.5 rounded-full backdrop-blur-md border flex items-center justify-center text-white/90 shadow-sm transition-all active:scale-95 relative ${
              activeFilters
                ? 'bg-accent text-white border-accent'
                : 'bg-white/[0.08] hover:bg-white/[0.14] border-white/15'
            }`}
            title="Filters"
          >
            <SlidersHorizontal size={14} />
            {activeFilters > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent text-white text-[9.5px] font-bold flex items-center justify-center border border-black">
                {activeFilters}
              </span>
            )}
          </button>
        )}

        {/* Unified View Toggle Pill [Grid | Reels] - Uniform with top navbar */}
        <div className="bg-white/[0.08] hover:bg-white/[0.12] backdrop-blur-md border border-white/15 rounded-full p-0.5 shadow-sm flex items-center">
          <button
            type="button"
            onClick={() => setView('grid')}
            title="Grid view"
            aria-label="Switch to Grid view"
            className={`flex items-center justify-center gap-1.5 px-2.5 h-7 rounded-full text-xs font-medium transition-all ${
              view === 'grid' ? 'bg-white/[0.16] text-white shadow-sm font-semibold' : 'text-white/60 hover:text-white'
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
            className={`flex items-center justify-center gap-1.5 px-2.5 h-7 rounded-full text-xs font-medium transition-all ${
              view === 'reels' ? 'bg-white/[0.16] text-white shadow-sm font-semibold' : 'text-white/60 hover:text-white'
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
