import React from 'react';
import { useEditorStore } from '../../../store/editorStore';
import EditPlanPanel from '../../clips/EditPlanPanel';

/** Editor tab: the clip's auto edits (zooms, emphasised words, sounds, cold open, hook) on the editor's playhead. */
export default function AutoEditPanel() {
  const clipId = useEditorStore((s) => s.clipId);
  const requestSeek = useEditorStore((s) => s.requestSeek);
  if (!clipId) return null;
  return (
    <div className="p-3">
      <EditPlanPanel clipId={clipId} compact
        getTime={() => useEditorStore.getState().currentTime}
        seek={(t) => requestSeek(t)} />
    </div>
  );
}
