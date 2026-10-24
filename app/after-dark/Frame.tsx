import type { ReactNode } from "react";
import { AI_FICTION_AFTER_DARK, AiFiction } from "@/app/AiLabel";
import { DISCREET_ATTR, discreetValue } from "@/lib/adult/discreet";
import type { AfterDarkView } from "@/lib/adult/privacy";
import DiscreetMedia from "./DiscreetMedia";
import PinGate from "./PinGate";

/**
 * What both After Dark layouts (app/after-dark, app/admin/after-dark) wrap their pages in (docs/after-dark.md "Discreet
 * mode"). A device that hasn't entered the account's PIN sees only the PIN prompt: the page under it still runs, but
 * every page, API and media route checks the lock itself (lib/adult/mode.ts adultViewer), so it has nothing to show.
 * Otherwise the pages sit inside the one CSS hook that blurs every picture and video until it's tapped
 * (app/after-dark/discreet.css).
 */
export default function AfterDarkFrame({ view, children }: { view: AfterDarkView; children: ReactNode }) {
  if (view.locked) return <PinGate reset={view.reset ?? { email: null, password: false }} />;
  const hook = { [DISCREET_ATTR]: discreetValue(view.blur) };
  return (
    <div className="ad-discreet" {...hook}>
      {children}
      {/* The AI disclosure on every After Dark page (EU AI Act Art. 50; docs/after-dark.md 2026-10-24). */}
      <AiFiction text={AI_FICTION_AFTER_DARK} className="ad-ai-fiction" />
      {view.blur && <DiscreetMedia />}
    </div>
  );
}
