import React, { useRef, useState } from 'react';
import { Sheet } from '../ui';
import { withToken } from '../../api';
import EditPlanPanel from './EditPlanPanel';

// rendered-video time <-> clip source time (see EditPlanPanel ctx)
const toSource = (out, c) => c.start + Math.max(0, out * c.speed - c.lead);
const toOutput = (src, c) => ((src - c.start) + c.lead) / c.speed;

/** The clip's auto edits next to its video (Clips page). */
export default function EditsSheet({ clip, onClose, actions }) {
  const videoRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState(null);
  if (!clip) return null;
  const src = videoUrl || actions.videoFor(clip);
  return (
    <Sheet open={!!clip} onClose={onClose} title={`Auto edits · clip #${clip.id}`} wide>
      <div className="sm:grid sm:grid-cols-[200px_1fr] gap-4 space-y-3 sm:space-y-0">
        <div className="sm:sticky sm:top-0 self-start">
          {src
            ? <video ref={videoRef} key={src} src={withToken(src)} controls playsInline className="w-full max-h-[38dvh] sm:max-h-[60dvh] aspect-[9/16] object-contain rounded-xl bg-black" />
            : <div className="aspect-[9/16] max-h-[38dvh] rounded-xl bg-black" />}
          <p className="text-[10.5px] text-muted mt-1">Pause where you want a zoom, word or sound, then use "at playhead".</p>
        </div>
        <EditPlanPanel clipId={clip.id}
          getTime={(c) => (videoRef.current ? toSource(videoRef.current.currentTime, c) : c.start)}
          seek={(t, c) => { if (videoRef.current) { videoRef.current.currentTime = Math.max(0, toOutput(t, c)); videoRef.current.pause(); } }}
          onRendered={(res) => { if (res?.video_url) setVideoUrl(res.video_url); actions.refresh(); actions.flash(`Clip #${clip.id} re-rendered`, 'ok'); }} />
      </div>
    </Sheet>
  );
}
