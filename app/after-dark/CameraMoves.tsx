"use client";

import { CAMERA_MOVES, type CameraMoveId } from "@/lib/adult/camera-moves";

/**
 * How the camera moves through a clip (lib/adult/camera-moves.ts): a tile per move, each a small preview of the move over
 * the picture it starts from (a plain frame when there isn't one yet), moving while it's picked, hovered or focused.
 * CSS transforms only, never a filter (discreet mode's blur holds); still for reduced motion.
 */
export default function CameraMoves({ value, onChange, src = null, disabled = false }: { value: CameraMoveId; onChange: (m: CameraMoveId) => void; src?: string | null; disabled?: boolean }) {
  return (
    <div className="ad-camera-moves" role="radiogroup" aria-label="Camera">
      {CAMERA_MOVES.map((m) => (
        <button key={m.id} type="button" role="radio" aria-checked={value === m.id} className={`ad-camera${value === m.id ? " on" : ""}`} disabled={disabled} onClick={() => onChange(m.id)} title={m.words}>
          <span className={`ad-camera-view move-${m.id}`} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media */}
            {src ? <img src={src} alt="" loading="lazy" /> : <span className="ad-camera-blank" />}
          </span>
          <span className="ad-camera-label small">{m.label}</span>
        </button>
      ))}
    </div>
  );
}
