"use client";

import { useEffect, useState } from "react";
import Icon from "@/app/Icon";
import { SOUND_EVENT, setSound, soundOn } from "./cues";

/**
 * Sound on or off (app/motion/cues.ts): off until a viewer turns it on, remembered on this browser. One switch for the
 * whole site, so every copy of it (the ceremony, the footer) shows the same state.
 */
export default function SoundToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(soundOn());
    const sync = () => setOn(soundOn());
    window.addEventListener(SOUND_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SOUND_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return (
    <button type="button" className={`sound-toggle${on ? " is-on" : ""}${className ? ` ${className}` : ""}`} aria-pressed={on} onClick={() => setSound(!on)} data-track="sound-toggle">
      <Icon name="volume" /> <span className="sound-toggle-word">{on ? "Sound on" : "Sound off"}</span>
    </button>
  );
}
