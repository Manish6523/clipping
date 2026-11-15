import React, { useRef } from 'react';

/**
 * Unified TransformBox component used for:
 * - Layers (Destination placement on 9:16 Canvas)
 * - Captions hit box
 * - Watermark branding overlay
 * 
 * Features:
 * - Drag body to move
 * - 4 Corner handles for proportional aspect-locked scaling
 * - 4 Edge handles for stretching
 * - 44dp touch-friendly target hitboxes
 * - Visual guide lines on active drag
 */
export default function TransformBox({
  rect = { x: 0, y: 0, w: 1, h: 1 },
  isSelected = false,
  isLocked = false,
  color = '#00F0FF',
  label = '',
  aspectLocked = true,
  onPointerDown, // (e, action, handle)
  onClick,
  showResizeHandles = true,
  showEdgeHandles = false,
  className = '',
  children
}) {
  const boxRef = useRef(null);
  const { x, y, w, h } = rect;

  return (
    <div
      ref={boxRef}
      style={{
        left: `${(x ?? 0) * 100}%`,
        top: `${(y ?? 0) * 100}%`,
        width: `${(w ?? 1) * 100}%`,
        height: `${(h ?? 1) * 100}%`,
        borderColor: isSelected ? '#FFFFFF' : (color || '#00F0FF'),
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      onPointerDown={(e) => onPointerDown?.(e, 'move', null)}
      className={`absolute border sm:border-2 transition-shadow select-none touch-none ${
        isSelected
          ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.7)] z-30 cursor-grab active:cursor-grabbing'
          : 'border-white/30 hover:border-white/80 z-20 cursor-pointer'
      } ${className}`}
    >
      {/* Corner color badge */}
      {color && (
        <div
          style={{ backgroundColor: color }}
          className="absolute top-0 left-0 w-2.5 h-2.5 rounded-br pointer-events-none"
          title={label}
        />
      )}

      {/* Embedded content */}
      {children}

      {/* Resize handles */}
      {isSelected && !isLocked && showResizeHandles && (
        <>
          {/* 4 Corner Handles (Aspect Locked scaling) */}
          {['nw', 'ne', 'se', 'sw'].map((hnd) => (
            <div
              key={hnd}
              onPointerDown={(e) => {
                e.stopPropagation();
                onPointerDown?.(e, 'resize', hnd);
              }}
              style={{ borderColor: color || '#FFFFFF' }}
              className={`absolute w-4 h-4 sm:w-3 sm:h-3 bg-white border-2 rounded-full z-40 shadow hover:scale-125 transition-transform touch-none cursor-${hnd}-resize ${
                hnd === 'nw' ? '-top-2 -left-2 sm:-top-1.5 sm:-left-1.5' :
                hnd === 'ne' ? '-top-2 -right-2 sm:-top-1.5 sm:-right-1.5' :
                hnd === 'se' ? '-bottom-2 -right-2 sm:-bottom-1.5 sm:-right-1.5' :
                '-bottom-2 -left-2 sm:-bottom-1.5 sm:-left-1.5'
              }`}
            />
          ))}

          {/* Optional Edge handles when aspect ratio is unlocked */}
          {showEdgeHandles && !aspectLocked && ['n', 's', 'e', 'w'].map((hnd) => (
            <div
              key={hnd}
              onPointerDown={(e) => {
                e.stopPropagation();
                onPointerDown?.(e, 'resize', hnd);
              }}
              style={{ borderColor: color || '#FFFFFF' }}
              className={`absolute w-3.5 h-3.5 sm:w-2.5 sm:h-2.5 bg-accent border rounded-full z-40 shadow hover:scale-125 transition-transform touch-none cursor-${hnd}-resize ${
                hnd === 'n' ? '-top-1.5 left-1/2 -translate-x-1/2' :
                hnd === 's' ? '-bottom-1.5 left-1/2 -translate-x-1/2' :
                hnd === 'e' ? 'top-1/2 -right-1.5 -translate-y-1/2' :
                'top-1/2 -left-1.5 -translate-y-1/2'
              }`}
            />
          ))}
        </>
      )}
    </div>
  );
}
