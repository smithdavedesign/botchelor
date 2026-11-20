"use client";

/**
 * The ✕ every hand-made menu and popover carries (2026-11-20 mobile audit, pattern 2): the same 44px round button as the
 * `Sheet`'s, so a thumb always has a way out besides a tap on the page behind. Styles: `button.overlay-x`, app/globals.css.
 */
export default function OverlayClose({ onClose, label = "Close", className }: { onClose: () => void; label?: string; className?: string }) {
  return (
    <button type="button" className={["overlay-x", className].filter(Boolean).join(" ")} aria-label={label} title={label} onClick={onClose}>
      ×
    </button>
  );
}
