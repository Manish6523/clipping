import React from 'react';

/** Mini 9:16 drawing of a template's layer boxes + caption line (shared by pickers). */
export default function TemplateMini({ layout, captionY, className = '' }) {
  const layers = (layout?.layers || []).filter((l) => l.visible !== false && l.dst);
  return (
    <svg viewBox="0 0 90 160" className={`w-full aspect-[9/16] rounded-lg bg-black ${className}`} aria-hidden="true">
      {layers.map((l, i) => (
        <rect
          key={l.id || i} x={(l.dst.x || 0) * 90} y={(l.dst.y || 0) * 160} width={(l.dst.w || 1) * 90} height={(l.dst.h || 1) * 160}
          rx={l.style?.shape === 'circle' ? 45 : 2} fill={l.color || '#334155'} fillOpacity="0.35" stroke={l.color || '#64748b'} strokeWidth="1.5"
        />
      ))}
      {layers.length === 0 && <rect x="0" y="0" width="90" height="160" fill="#334155" fillOpacity="0.35" />}
      <rect x="18" y={(captionY ?? 0.76) * 160 - 3} width="54" height="6" rx="3" fill="#FACC15" />
    </svg>
  );
}
