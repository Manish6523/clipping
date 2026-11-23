import React from 'react';
import { AlertTriangle, Plus, Loader2 } from 'lucide-react';
import { Toggle, Button } from '../ui';
import { Avatar, PLATFORM } from '../distribution/parts';
import { MODE_LABEL } from '../distribution/model';

const ORDER = ['youtube', 'instagram', 'tiktok'];

/**
 * Every connected account, grouped by platform, each with a switch.
 * isOn(dest) / onChange(dest, on) / busy(dest) let it drive live routing (instant saves) or a local
 * selection (the Add-streamer flow).
 */
export default function PostingPicker({ destinations, isOn, onChange, busy = () => false, onConnect, compact = false }) {
  if (!destinations.length) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong p-4 text-center space-y-2" data-testid="posting-empty">
        <p className="text-[13px] text-ink font-semibold">No posting accounts connected yet</p>
        <p className="text-[12px] text-muted">Connect a YouTube channel, Instagram or TikTok account, then switch it on here.</p>
        {onConnect && <Button size="sm" variant="primary" icon={Plus} onClick={onConnect}>Connect an account</Button>}
      </div>
    );
  }
  const groups = ORDER.map((p) => [p, destinations.filter((d) => d.platform === p)]).filter(([, l]) => l.length);
  return (
    <div className="space-y-3" data-testid="posting-picker">
      {groups.map(([platform, list]) => {
        const P = PLATFORM[platform];
        return (
          <div key={platform}>
            <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: P.color }}>
              <P.icon size={12} /> {P.label}
            </div>
            <div className="rounded-xl border border-line divide-y divide-line overflow-hidden">
              {list.map((d) => {
                const on = isOn(d);
                const b = busy(d);
                return (
                  <div key={d.id} role="group" aria-label={`${d.title} (${P.label})`}
                    onClick={() => { if (!b) onChange(d, !on); }}
                    className={`flex items-center gap-3 px-3 ${compact ? 'py-2' : 'py-2.5'} cursor-pointer select-none hover:bg-white/[0.03] ${on ? 'bg-accent/[0.06]' : ''}`}
                    data-testid={`post-${d.id}`} data-on={on ? '1' : '0'}>
                    <Avatar src={d.avatar} name={d.title} platform={d.platform} size={compact ? 30 : 34} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-ink truncate">{d.title}</span>
                      <span className="block text-[11.5px] text-muted truncate">
                        {d.handle}{MODE_LABEL[d.mode] ? ` · ${MODE_LABEL[d.mode]}` : ''}
                      </span>
                      {!d.ok && <span className="flex items-center gap-1 text-[11px] text-bad"><AlertTriangle size={11} /> Login expired - reconnect in Accounts</span>}
                    </span>
                    {b && <Loader2 size={14} className="animate-spin text-muted shrink-0" />}
                    <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                      <Toggle checked={on} disabled={b} onChange={(v) => onChange(d, v)} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
