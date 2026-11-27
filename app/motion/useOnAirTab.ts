"use client";

import { useEffect } from "react";

const ON_AIR_ICON = "/icon-onair.svg";

/**
 * While a date is on air in this tab, the tab says so (2026-11-27, the finish pass): the icon gets the red ON AIR dot
 * (public/icon-onair.svg) and the title a "● LIVE" prefix, so a viewer who switched tabs can see the show is still
 * running. Both go back the moment it isn't live, or the room is left.
 */
export function useOnAirTab(live: boolean) {
  useEffect(() => {
    if (!live) return;
    const icons = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
    const before = icons.map((l) => l.href);
    for (const l of icons) l.href = ON_AIR_ICON;
    const title = document.title;
    if (!title.startsWith("● ")) document.title = `● LIVE · ${title}`;
    return () => {
      icons.forEach((l, i) => (l.href = before[i]));
      document.title = title;
    };
  }, [live]);
}

