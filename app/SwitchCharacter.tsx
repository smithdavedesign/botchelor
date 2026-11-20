"use client";

import { PICKER_OPEN_EVENT } from "@/lib/current-character";

/**
 * A character's name in a page's heading ("Who should Ambrose meet?", "Ambrose Fenn's Studio") that opens the header's
 * picker (app/CharacterPicker.tsx), for someone with several characters: the switch is where the page names who it's
 * about, not only in the header's corner. Only where there's someone to switch to; the page renders the plain name
 * otherwise.
 */
export default function SwitchCharacter({
  name,
  label,
  suffix,
}: {
  name: string;
  /** A button of its own instead of the name: "Switch character". */
  label?: string;
  /** What follows the name without a break ("'s"): a button is an atomic box, so a heading broke right after it and left
   * "'s matches" on a line of its own (2026-11-20 mobile audit, B2). */
  suffix?: string;
}) {
  const open = () => window.dispatchEvent(new Event(PICKER_OPEN_EVENT));
  if (label) {
    return (
      <button type="button" className="button secondary" aria-haspopup="dialog" onClick={open}>
        {label}
      </button>
    );
  }
  // No ▾ after it (2026-11-18 visual pass: in display type it read as a stray mark before "'s"): the dotted underline
  // and the pointer say it opens something.
  const button = (
    <button type="button" className="heading-switch" aria-haspopup="dialog" title={`${name}: switch character`} onClick={open}>
      {name}
    </button>
  );
  return suffix ? (
    <span className="heading-switch-keep">
      {button}
      {suffix}
    </span>
  ) : (
    button
  );
}
