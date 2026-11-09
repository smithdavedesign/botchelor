"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A modal for a step that needs room or asks first (2026-10-31 UX audit, David: "if its too complicated make a model"):
 * a centred card on a wide screen, a bottom sheet on a phone, like app/FeedbackModal.tsx. A native modal <dialog>, so
 * the page behind is inert, Tab stays inside and Escape closes it; so does a tap on the dimmed page (not a drag that
 * started inside and ended outside). It's rendered into <body> while open, so it outlives the menu that opened it.
 */
export default function Sheet({ open, onClose, title, children, wide = false, fit = false }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; fit?: boolean }) {
  if (!open) return null;
  return createPortal(
    <SheetDialog onClose={onClose} title={title} wide={wide} fit={fit}>
      {children}
    </SheetDialog>,
    document.body,
  );
}

/** `wide`: room for a picker of pictures (the looks builder): wider on a desktop, the whole screen on a phone. */
/** `fit`: short content that never scrolls; the sheet grows to hold it. */
function SheetDialog({ onClose, title, children, wide, fit }: { onClose: () => void; title: ReactNode; children: ReactNode; wide: boolean; fit: boolean }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={["sheet-dialog", wide && "is-wide", fit && "is-fit"].filter(Boolean).join(" ")}
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
        pressedBackdrop.current = false;
      }}
    >
      <div className="sheet-body">
        <div className="sheet-head">
          <h2 id={`${id}-title`}>{title}</h2>
          <button type="button" className="sheet-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
