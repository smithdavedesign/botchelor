"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { BLURRED_MEDIA, DISCREET_ATTR, SHOWN_ATTR } from "@/lib/adult/discreet";

const WRAPPER = `[${DISCREET_ATTR}="blur"]`;
const MEDIA = "img, video, image";
const HINT = "Hidden for privacy: tap to show";
/** Marks the tabindex and title this script added, so showing a picture takes back only those. */
const ADDED = "data-ad-hint";

/** The blurred picture or video an event landed on, or null. */
function hiddenMedia(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const media = target.closest(MEDIA);
  return media && media.closest(WRAPPER) && media.matches(BLURRED_MEDIA) ? media : null;
}

/** Keyboard users can reach a blurred picture (Enter or Space shows it), and a pointer gets a tooltip saying what a tap does. */
function hint() {
  for (const el of document.querySelectorAll(`${WRAPPER} :is(${MEDIA})`)) {
    if (!el.matches(BLURRED_MEDIA) || el.hasAttribute(ADDED)) continue;
    const added: string[] = [];
    if (!el.hasAttribute("tabindex")) {
      el.setAttribute("tabindex", "0");
      added.push("tabindex");
    }
    if (!el.hasAttribute("title")) {
      el.setAttribute("title", HINT);
      added.push("title");
    }
    el.setAttribute(ADDED, added.join(" "));
  }
}

/** Shows it, and the pictures or videos right beside it: the reel player's two stacked videos are one tap. */
function reveal(media: Element) {
  const group = media.parentElement ? [...media.parentElement.children].filter((el) => el.matches(MEDIA)) : [media];
  for (const el of group) {
    el.setAttribute(SHOWN_ATTR, "");
    for (const attr of (el.getAttribute(ADDED) ?? "").split(" ").filter(Boolean)) el.removeAttribute(attr);
    el.removeAttribute(ADDED);
  }
}

/** Everything shown is blurred again. */
function hideAll() {
  for (const el of document.querySelectorAll(`[${SHOWN_ATTR}]`)) el.removeAttribute(SHOWN_ATTR);
  hint();
}

/**
 * Discreet mode's tap-to-reveal (docs/after-dark.md "Discreet mode"). The blur itself is CSS on the After Dark layouts'
 * wrapper (app/after-dark/discreet.css); this only listens. The first tap or click on a blurred picture or video shows
 * it and does nothing else (no link, lightbox or play underneath). Leaving the page, or the tab going to the background,
 * blurs everything again. Mounted only while blur is on.
 */
export default function DiscreetMedia() {
  const pathname = usePathname();

  useEffect(() => {
    // On window, in the capture phase: before React's own handlers (on the document) and before a video's controls.
    const onClick = (e: MouseEvent) => {
      const media = hiddenMedia(e.target);
      if (!media) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      reveal(media);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const media = hiddenMedia(document.activeElement);
      if (!media) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      reveal(media);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hideAll();
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", hideAll);
    const root = document.querySelector(WRAPPER);
    const observer = new MutationObserver(hint);
    if (root) observer.observe(root, { childList: true, subtree: true });
    hint();
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", hideAll);
      observer.disconnect();
    };
  }, []);

  // A move to another After Dark page keeps this mounted (the layout stays): blur whatever the last page showed.
  useEffect(() => {
    hideAll();
  }, [pathname]);

  return null;
}
