"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import Avatar from "@/app/Avatar";
import { fold, pairOf, pickGroups, surprisePair, underWay, whoseCounts, whoseFilters, type PickerData, type Whose } from "@/lib/adult/pair-pick";
import type { CastMember, CastPair } from "@/lib/adult/scenes";

type Who = CastMember;
type Pair = CastPair;

const first = (n: string) => n.split(/\s+/)[0];

/** How many nights under way show before "Show all". */
export const CONTINUE_SHOWN = 8;

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", then the date. */
function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Where a night is: its chapter, its lines, and (in the browser) when it was played. */
function nightMeta(p: Pair, now: number | null): string {
  return [p.chapter && p.chapter > 1 ? `Chapter ${p.chapter}` : "", p.lines > 0 ? `${p.lines} lines` : "", now ? ago(p.updated_at, now) : ""].filter(Boolean).join(" · ");
}

/** A face, round: the one kept for this viewer where there is one (behind the privacy blur when it's on), else the portrait. */
const Face = ({ c, size }: { c: Who; size: number }) => (
  <Avatar seed={c.id} name={c.name} house={c.house ?? false} portraitSrc={c.portrait ?? null} photoSrc={c.photo ?? null} size={size} decorative round />
);

/**
 * One night under way, as a card to pick up again: its newest picture as the cover (David, 2026-11-18: "a flagship
 * landing page with more assets"; behind the privacy blur when it's on), both faces, who, the night's last line, its
 * chapter and when it was played. Without a picture, the two faces large. The whole card is one link.
 */
function NightCard({ p, now }: { p: Pair; now: number | null }) {
  // "6 min ago" only once in the browser: the server's clock and the browser's differ, and React won't hydrate a mismatch.
  const meta = nightMeta(p, now);
  return (
    <li className="ad-night" data-night={p.path}>
      <Link href={p.path} className="ad-night-link">
        <span className={`ad-night-cover${p.cover ? "" : " is-faces"}`}>
          {p.cover ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a private file from the media route */}
              <img src={`${p.cover}?w=640`} alt="" loading="lazy" />
              <span className="ad-night-faces" aria-hidden="true">
                <Face c={p.a} size={34} />
                <Face c={p.b} size={34} />
              </span>
            </>
          ) : (
            <span className="ad-night-duo" aria-hidden="true">
              <Face c={p.a} size={76} />
              <Face c={p.b} size={76} />
            </span>
          )}
        </span>
        <span className="ad-night-body">
          <span className="ad-pair-names">
            <strong>{first(p.a.name)}</strong>
            <span className="ad-pair-x" aria-hidden="true">
              {" "}×{" "}
            </span>
            <span className="sr-only"> and </span>
            <strong>{first(p.b.name)}</strong>
          </span>
          {p.last && (
            <span className="ad-night-last muted small">
              {p.last.who}: “{p.last.text}”
            </span>
          )}
          {meta && <span className="ad-night-meta muted small">{meta}</span>}
          {/* #1132: one of the two has left the cast since; the pair stays theirs, and says which month it's from. */}
          {p.earlier && (
            <span className="ad-pair-earlier muted small" data-earlier-cast="true">
              🗓 {p.earlier}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** A face to pick, with its whole name and, where it says something, how far their night has got. */
function PickFace({ c, meta, onPick }: { c: Who; meta?: string; onPick: () => void }) {
  return (
    <li>
      <button type="button" className="ad-pp-face" title={c.name} onClick={onPick} data-face={c.id}>
        <Face c={c} size={56} />
        <span className="ad-pp-name">{c.name}</span>
        {meta && <span className="ad-pp-meta">{meta}</span>}
      </button>
    </li>
  );
}

/**
 * The hub's scenes (app/after-dark/page.tsx). The nights under way first, under Continue, as cards with their pictures
 * (the newest eight, then Show all). Then a new pair, picked by face (David, 2026-10-24: not the long list of every
 * pair) and, since 2026-11-18 ("change the choose a new pair to be better ux like a picker with a search"), found by
 * name: one search box, Everyone · House cast · Yours, the faces from their nights first, then everyone A to Z, in a
 * panel that scrolls instead of a wall of 150 names. Pick one and the box asks who they're with (only those they can
 * pair with, theirs under way first); pick the second and the pair shows large with the way in. 🎲 picks a new pair at
 * random. Start over clears either pick. A pair kept from an earlier cast (#1132) is only under Continue: who left the
 * cast isn't a face to start a new pair with.
 *
 * data-first-scene: the first pair's scene, for the screenshot scripts (they open a scene without picking).
 */
export default function PairPicker({
  cast,
  nights: going,
  firstScene,
  stepIn = false,
}: PickerData & {
  /** Step in is open to this viewer (lib/adult/step-in.ts): a row offers it with whoever is picked. */
  stepIn?: boolean;
}) {
  const [one, setOne] = useState<string | null>(null);
  const [two, setTwo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [whose, setWhose] = useState<Whose>("all");
  const [allNights, setAllNights] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  // `going`: under way (lines, or a chapter filed, or kept from an earlier cast), the latest played first. `cast`: who a
  // new pair is picked from, A to Z (lib/adult/pair-pick.ts pickerData).
  const picked = cast.find((c) => c.id === one) ?? null;
  const second = picked ? (cast.find((c) => c.id === two && c.id !== picked.id) ?? null) : null;
  const chosen = picked && second ? pairOf(cast, going, picked.id, second.id) : null;
  const counts = useMemo(() => whoseCounts(cast), [cast]);
  const filters = whoseFilters(counts);
  const q = fold(query.trim());
  // What the panel shows: the first pick's faces, or who the first pick can be with, in groups.
  const groups = useMemo(() => pickGroups(cast, going, { one: picked?.id ?? null, query, whose }), [cast, going, picked, query, whose]);
  const shown = groups.reduce((n, g) => n + g.faces.length, 0);

  const pickOne = (id: string) => {
    setOne(id);
    setTwo(null);
    setQuery("");
  };
  const pickTwo = (id: string) => {
    setTwo(id);
    setQuery("");
  };
  const startOver = () => {
    setOne(null);
    setTwo(null);
    setQuery("");
  };
  // 🎲: a pair they haven't started, at random (any pair once they've started them all).
  const surprise = () => {
    const p = surprisePair(cast, going);
    if (!p) return;
    setOne(p.a.id);
    setTwo(p.b.id);
    setQuery("");
  };
  // Enter takes the first face shown; Escape clears what's typed, then the last pick.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const top = groups[0]?.faces[0]?.c;
      if (top) (picked ? pickTwo : pickOne)(top.id);
    } else if (e.key === "Escape") {
      if (query) setQuery("");
      else if (two) setTwo(null);
      else if (one) setOne(null);
    }
  };
  const nights = allNights ? going : going.slice(0, CONTINUE_SHOWN);

  return (
    <div className="ad-pair-picker" data-first-scene={firstScene}>
      {going.length > 0 && (
        <>
          <h3 className="ad-hub-sub">Continue</h3>
          <ul className="ad-nights">
            {nights.map((p) => (
              <NightCard key={p.path} p={p} now={now} />
            ))}
          </ul>
          {going.length > CONTINUE_SHOWN && (
            <p className="ad-nights-more">
              <button type="button" className="button-ghost" onClick={() => setAllNights(!allNights)} aria-expanded={allNights}>
                {allNights ? "Show fewer" : `Show all ${going.length} nights`}
              </button>
            </p>
          )}
        </>
      )}
      {cast.length > 0 && (
        <div className="ad-pp" data-pick>
          <h3 className="ad-hub-sub">{going.length ? "Start a new pair" : "Pick a pair"}</h3>
          {/* The two picks: who, then who with. A filled one clears on a tap. */}
          <div className="ad-pp-slots" role="group" aria-label="The pair">
            <span className="ad-pp-pair">
              {picked ? (
                <button type="button" className="ad-pp-slot is-filled" onClick={startOver} aria-label={`${picked.name}: pick someone else`}>
                  <Face c={picked} size={36} />
                  <span className="ad-pp-slot-text">{first(picked.name)}</span>
                  <span aria-hidden="true">✕</span>
                </button>
              ) : (
                <span className="ad-pp-slot">
                  <span className="ad-pp-slot-n" aria-hidden="true">
                    1
                  </span>
                  <span className="ad-pp-slot-text">Pick one</span>
                </span>
              )}
              <span className="ad-pair-x" aria-hidden="true">
                ×
              </span>
              {second ? (
                <button type="button" className="ad-pp-slot is-filled" onClick={() => setTwo(null)} aria-label={`${second.name}: pick who else`}>
                  <Face c={second} size={36} />
                  <span className="ad-pp-slot-text">{first(second.name)}</span>
                  <span aria-hidden="true">✕</span>
                </button>
              ) : (
                <span className={`ad-pp-slot${picked ? " is-next" : ""}`}>
                  <span className="ad-pp-slot-n" aria-hidden="true">
                    2
                  </span>
                  <span className="ad-pp-slot-text">Who with?</span>
                </span>
              )}
            </span>
            {picked ? (
              <button type="button" className="link-button" onClick={startOver}>
                Start over
              </button>
            ) : (
              <button type="button" className="link-button ad-pp-surprise" onClick={surprise} title="A pair you haven't started, at random">
                🎲 Surprise me
              </button>
            )}
          </div>
          {chosen ? (
            <div className="card ad-pp-chosen" data-chosen={chosen.path}>
              <span className="ad-pp-chosen-faces" aria-hidden="true">
                <Face c={chosen.a} size={72} />
                <Face c={chosen.b} size={72} />
              </span>
              <span className="ad-pp-chosen-body">
                <strong className="ad-pp-chosen-names">
                  {chosen.a.name} × {chosen.b.name}
                </strong>
                <span className="muted small">{underWay(chosen) ? `Under way: ${nightMeta(chosen, now)}` : "A new night: nothing's happened between them yet."}</span>
                <span className="ad-pair-go">
                  <Link className="button primary" href={chosen.path}>
                    {underWay(chosen) ? "Continue" : "Start"} {first(chosen.a.name)} × {first(chosen.b.name)}
                  </Link>
                </span>
              </span>
            </div>
          ) : (
            <>
              <div className="ad-pp-bar">
                <input
                  type="search"
                  className="ad-pp-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKey}
                  placeholder={picked ? `Search who ${first(picked.name)} can be with` : `Search ${cast.length} characters by name`}
                  aria-label={picked ? `Search who ${first(picked.name)} can be with` : "Search the cast by name"}
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="go"
                />
                {filters.length > 0 && (
                  <span className="ad-pp-filters" role="group" aria-label="Whose">
                    {filters.map((w) => (
                      <button key={w} type="button" aria-pressed={whose === w} onClick={() => setWhose(w)}>
                        {w === "all" ? "Everyone" : w === "house" ? "House cast" : "Yours"} <span className="ad-pp-count">{counts[w]}</span>
                      </button>
                    ))}
                  </span>
                )}
              </div>
              <p className="sr-only" aria-live="polite">
                {q ? `${shown} ${shown === 1 ? "match" : "matches"}` : ""}
              </p>
              <div className="ad-pp-panel" role="group" aria-label={picked ? `Pick who ${first(picked.name)} is with` : "Pick the first of the two"}>
                {groups.length ? (
                  groups.map((g) => (
                    <section key={g.label} className="ad-pp-group">
                      <h4 className="ad-pp-group-label">{g.label}</h4>
                      <ul className="ad-pp-grid">
                        {g.faces.map(({ c, meta }) => (
                          <PickFace key={c.id} c={c} meta={meta} onPick={() => (picked ? pickTwo(c.id) : pickOne(c.id))} />
                        ))}
                      </ul>
                    </section>
                  ))
                ) : (
                  <p className="muted small ad-pp-none">
                    Nobody {q ? <>called “{query.trim()}”</> : "here"}
                    {whose !== "all" ? " in this group" : ""}.{" "}
                    {(q || whose !== "all") && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          setQuery("");
                          setWhose("all");
                        }}
                      >
                        Show everyone
                      </button>
                    )}
                  </p>
                )}
              </div>
            </>
          )}
          {/* Step in (lib/adult/step-in.ts): the viewer in the scene instead of a second character, with whoever is picked. */}
          {stepIn && !second && (
            <p className="ad-pair-go" data-step-in-row>
              <Link className="button-ghost" href={picked ? `/after-dark/step-in?with=${encodeURIComponent(picked.id)}` : "/after-dark/step-in"}>
                Or step in yourself, with {picked ? first(picked.name) : "one of them"}
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
