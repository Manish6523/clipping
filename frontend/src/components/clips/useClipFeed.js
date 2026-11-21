import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import axios from 'axios';

const KEY = 'autoclip_clips_filters';
const DEFAULTS = { status: 'pending_approval', channel: 'all', min_score: 0, q: '', sort: 'new' };

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}'), q: '' }; } catch { return DEFAULTS; }
}

/** Filters (remembered per browser, except the search text) + the paged clip list. */
export function useClipFeed() {
  const [filters, setFiltersState] = useState(load);
  const setFilters = (patch) => setFiltersState((f) => {
    const next = { ...f, ...patch };
    try { const { q, ...keep } = next; localStorage.setItem(KEY, JSON.stringify(keep)); } catch { /* storage off */ }
    return next;
  });

  const query = useInfiniteQuery({
    queryKey: ['clips', 'feed', filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = { ...filters, limit: 30, cursor: pageParam || 0 };
      if (!params.q) delete params.q;
      return (await axios.get('/api/clips/feed', { params })).data;
    },
    getNextPageParam: (last) => last?.next_cursor ?? undefined,
    staleTime: 5000,
  });

  const pages = query.data?.pages || [];
  const clips = useMemo(() => {
    const seen = new Set();
    return pages.flatMap((p) => p.clips || []).filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
  }, [pages]);
  const counts = pages[0]?.counts || null;
  const channels = pages[0]?.channels || [];

  return { filters, setFilters, clips, counts, channels, ...query };
}
