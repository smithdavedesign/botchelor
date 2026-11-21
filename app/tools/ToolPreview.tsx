import type { CSSProperties } from "react";
import CountUp from "@/app/motion/CountUp";
import { CHEMISTRY_EXAMPLE, chemistryTest } from "@/lib/chemistry-test";
import { OC_NAMES_PATH, ocNames } from "@/lib/oc-names";
import { OC_QUESTIONS, OC_QUESTIONS_PATH } from "@/lib/oc-questions";
import { characterPortrait } from "@/lib/portraits";
import { ENDING_LABELS } from "@/lib/rules";
import { shipNames } from "@/lib/ship-names";
import { CHEMISTRY_TOOL_PATH, RANDOM_OC_TOOL_PATH, SHIP_TOOL_PATH } from "@/lib/tools";

/** The three house faces the random generator's preview fans out (reviewed PG portraits). */
const FAN = ["house-juniper", "house-dex", "house-nell"];
/** How many ship names the ship preview turns through. */
const SHIP_TURNS = 4;

/**
 * What each free tool makes, shown on its own card on /tools (pass 2 of the 2026-11-20 visual pop audit): a fanned hand
 * of characters, a few names, a question, ship names turning over, the example chemistry score filling. Every one is
 * the tool's real output for a fixed input (the tools are deterministic: lib/tools.ts), never made up for the picture.
 * Decorative beside the card's words, so hidden from screen readers; complete at rest, and still under reduced motion.
 */
export default function ToolPreview({ path }: { path: string }) {
  if (path === RANDOM_OC_TOOL_PATH) {
    return (
      <div className="tool-preview tool-fan" aria-hidden="true">
        {FAN.map((id) => {
          const src = characterPortrait(id);
          // eslint-disable-next-line @next/next/no-img-element -- a static public asset, reviewed and committed
          return src ? <img key={id} src={src} alt="" width={72} height={96} loading="lazy" decoding="async" /> : null;
        })}
      </div>
    );
  }
  if (path === OC_NAMES_PATH) {
    return (
      <ul className="tool-preview tool-names" aria-hidden="true">
        {ocNames({ style: null }).slice(0, 3).map((n) => (
          <li key={n.name}>{n.name}</li>
        ))}
      </ul>
    );
  }
  if (path === OC_QUESTIONS_PATH) {
    return (
      <p className="tool-preview tool-question" aria-hidden="true">
        {OC_QUESTIONS[0].text}
      </p>
    );
  }
  if (path === SHIP_TOOL_PATH) {
    const names = shipNames("juniper", "dex").slice(0, SHIP_TURNS).map((n) => n.name);
    if (!names.length) return null;
    // The reel's turns are written for SHIP_TURNS names (globals.css tool-ship-turn); fewer, and the best one stands still.
    if (names.length < SHIP_TURNS) names.splice(1);
    return (
      <div className="tool-preview tool-ship" aria-hidden="true">
        <span className="tool-ship-pair">Juniper × Dex</span>
        <span className="tool-ship-window">
          <span className={names.length > 1 ? "tool-ship-reel" : undefined} style={{ "--turns": names.length } as CSSProperties}>
            {(names.length > 1 ? [...names, names[0]] : names).map((n, i) => (
              <span key={`${n}-${i}`}>{n}</span>
            ))}
          </span>
        </span>
      </div>
    );
  }
  if (path === CHEMISTRY_TOOL_PATH) {
    const result = chemistryTest(...CHEMISTRY_EXAMPLE);
    return (
      <div className="tool-preview tool-chem" aria-hidden="true">
        <span className="tool-chem-pair">Juniper × Dex</span>
        <strong className="tool-chem-score">
          <CountUp value={result.score} />
          <small>/100</small>
        </strong>
        <span className="tool-chem-track">
          <span className="fill-in" style={{ width: `${result.score}%` }} />
        </span>
        <span className="tool-chem-ending">{ENDING_LABELS[result.ending]}</span>
      </div>
    );
  }
  return null;
}
