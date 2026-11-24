"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import CharacterName from "@/app/CharacterName";
import { useAdultTagDemand } from "@/app/after-dark/useAdultTagDemand";
import { coverFor, ROLEPLAY_COVERS } from "@/lib/adult/roleplay-covers";
import { ROLEPLAYS, type Roleplay } from "@/lib/adult/roleplays";
import type { BondMark } from "@/lib/adult/step-in-bond";
import type { StepInCharacter, StoryPlace } from "@/lib/adult/step-in-shared";
import { SHELF_OWN, SHELF_TONIGHT, shelfCast, shelfLead, shelfShown, shelfYours, shelfYoursSlot } from "@/lib/adult/step-in-shelf";
import { storyGoal } from "@/lib/adult/step-in-story";
import { roleplayGroups } from "@/lib/adult/tags";
import { cardShownToYou, premiseShownToYou } from "@/lib/scene-cards";
import { BondMarkTag } from "./[id]/StepInBond";
import StepInButton from "./StepInButton";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
/**
 * The roleplays with a cover picture (lib/adult/roleplay-covers.ts): every one of them since 2026-11-23, so this orders
 * nothing today. It stays for a roleplay written before its picture is drawn: the pictured lead tonight's, and come
 * first in any list.
 */
const PICTURED: ReadonlySet<string> = new Set(Object.keys(ROLEPLAY_COVERS));
const NO_PLACES: Record<string, StoryPlace> = {};
const NO_OWN: Roleplay[] = [];

/**
 * Step in's roleplays as cards (lib/adult/step-in-shelf.ts; David, 2026-11-23, after Chub.ai's scene cards): each one a
 * situation told from the viewer's side, cast with someone from their own After Dark, and one click from being in it.
 * It opens on tonight's eight (a different eight tomorrow); all of them is a tap, and a kind is one pick from a list
 * (fifteen kinds as chips filled a phone's first screen before any card: the first live check). "Someone else" recasts
 * a card on the spot; "Set it up" takes the pair to the set-up form below for the other side, another place or a
 * written opening. Nothing here costs anything until a card is started (one reply, like any opening).
 *
 * `day` is the server's (UTC), so the page it sends and the browser agree on who is on each card. `with_`: the page was
 * opened for one of them (?with=<id>, "Roleplay or place" on their card), so every card opens on that person.
 * `places`: where each roleplay's own story is set (lib/adult/step-in.ts storyPlaces): a card says where, and that it's
 * out in public when it is, since a scene started from it starts there.
 *
 * `own`: the roleplays the viewer wrote themselves (the Create library; lib/adult/own-roleplay-card.ts ownRoleplays),
 * each with the story card drafted for it. They're cards like any other, first under "All" and a kind of their own
 * ("✨ Yours"): no picture (nobody drew one), and once its story is drafted the goal and where it's set (`places` has
 * theirs too; one with no place starts at the character's). Tonight's eight stay the show's. `createHref`: where one
 * is written, said in a few words to someone who has none.
 */
export default function StepInShelf({
  cast,
  recent,
  day,
  with_ = null,
  places = NO_PLACES,
  played = {},
  bonds = {},
  own = NO_OWN,
  createHref = null,
}: {
  cast: StepInCharacter[];
  recent: string[];
  day: string;
  with_?: string | null;
  places?: Record<string, StoryPlace>;
  /** The roleplays this viewer has played to their last beat, and how many times (lib/adult/step-in.ts playedRoleplays). */
  played?: Record<string, number>;
  /** How well the viewer knows each of them (lib/adult/step-in-bond-data.ts bondMarks): the level's name beside a face. */
  bonds?: Record<string, BondMark>;
  /** The viewer's own roleplays, the newest first, shaped like the show's (their card when it's been drafted). */
  own?: Roleplay[];
  /** Where a roleplay of one's own is written (the Studio's Create tab). */
  createHref?: string | null;
}) {
  // Which cards show: tonight's, one kind of them (who the two are to each other), or all.
  const [show, setShow] = useState("tonight");
  // How many times "Someone else" was pressed on each card.
  const [turns, setTurns] = useState<Record<string, number>>({});
  const who = useMemo(() => shelfCast(cast, recent, with_), [cast, recent, with_]);
  // Whose page this is, when it was opened for someone in the viewer's After Dark.
  const asked = with_ && who.order[0]?.id === with_ ? who.order[0] : null;
  const demand = useAdultTagDemand();
  const groups = useMemo(() => roleplayGroups(ROLEPLAYS, demand ?? undefined), [demand]);
  // The viewer's own come first under "All", and are a kind of their own; tonight's eight are the show's.
  const shown = shelfShown<Roleplay>(show, { house: ROLEPLAYS, own, day, pictured: PICTURED, kinds: groups });
  const playedCount = [...own, ...ROLEPLAYS].filter((r) => played[r.id]).length;
  if (!who.order.length) return null;
  const kind = (show === SHELF_OWN && own.length > 0) || groups.some((g) => g.id === show) ? show : "";
  const chip = (id: string, label: string, n?: number) => (
    <button key={id} type="button" className={show === id ? "ad-chip on" : "ad-chip"} aria-pressed={show === id} onClick={() => setShow(id)} data-step-in-shelf-show={id}>
      {label}
      {n !== undefined && <span className="ad-si-shelf-n"> {n}</span>}
    </button>
  );
  return (
    <section className="ad-si-shelf" aria-labelledby="ad-si-shelf-h" data-step-in-shelf>
      <h2 id="ad-si-shelf-h">{asked ? `Step into a roleplay with ${first(asked.name)}` : "Step into a roleplay"}</h2>
      <p className="muted small">
        {ROLEPLAYS.length} stories{own.length > 0 ? ` and ${own.length} of your own` : ""}, each ready to play with {asked ? first(asked.name) : "someone from your After Dark"}. One
        click and you&apos;re in it.
        {/* Nobody's own yet: where one is written, in a few words. */}
        {own.length === 0 && createHref && (
          <span data-step-in-shelf-write>
            {" "}
            Or <Link href={createHref}>write your own</Link>: it gets a goal and an ending to play for, like these.
          </span>
        )}
        {playedCount > 0 && (
          <span data-step-in-shelf-played>
            {" "}
            You&apos;ve played {playedCount} of them to the end.
          </span>
        )}
      </p>
      <div className="ad-si-shelf-kinds" role="group" aria-label="Which roleplays to show">
        {chip("tonight", `Tonight's ${SHELF_TONIGHT}`)}
        {chip("all", "All", ROLEPLAYS.length + own.length)}
        <label htmlFor="ad-si-shelf-kind" className="sr-only">
          A kind of roleplay
        </label>
        <select id="ad-si-shelf-kind" className={kind ? "on" : undefined} value={kind} onChange={(e) => setShow(e.target.value || "tonight")} data-step-in-shelf-kind>
          <option value="">A kind…</option>
          {own.length > 0 && (
            <option value={SHELF_OWN}>
              ✨ Yours ({own.length})
            </option>
          )}
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label} ({g.roleplays.length})
            </option>
          ))}
        </select>
      </div>
      <ul className="ad-si-shelf-cards">
        {shown.map((rp, index) => {
          // Tonight's last two are kept for the people they've stepped in with (the one they were with last, then
          // someone else of theirs): with a picture on every card, nobody of their own would lead one otherwise.
          const yours = show === "tonight" ? shelfYoursSlot(index, shown.length, who) : null;
          // "Someone else" is counted apart for one of their own two: it walks on from their person, and the same
          // story under "All 45" walks on from the one in its picture, so a press on one mustn't move the other (it
          // did on the first live check: two presses in tonight's left that story without its cover under All).
          const turnKey = yours !== null ? `${rp.id}:yours` : rp.id;
          const turn = turns[turnKey] ?? 0;
          // Every other card opens on the one in its picture (the people they know come next, with "Someone else").
          const them = yours !== null ? shelfYours(day, who, yours, turn) : shelfLead(rp.id, day, who, turn, ROLEPLAY_COVERS[rp.id]?.character ?? null);
          if (!them) return null;
          const name = first(them.name);
          // With the one in the picture, the card is as the picture shows it: they play that side, the viewer the other.
          const cover = coverFor(rp.id, them.id);
          const you: 0 | 1 = cover ? cover.you : 0;
          // The story as the viewer reads it: they're "you", the other is whoever is on the card. One of their own with
          // no card drafted yet is told by what they wrote.
          const side = you === 1 ? "b" : "a";
          const setup = rp.card ? cardShownToYou(rp.card, side, name).setup : premiseShownToYou(rp.premise, side, name);
          const goal = storyGoal(rp, you, name);
          const mine = own.includes(rp);
          return (
            <li key={rp.id} className={cover ? "card ad-si-shelf-card has-cover" : "card ad-si-shelf-card"} data-step-in-card={rp.id} data-step-in-card-with={them.id} data-step-in-card-you={you}>
              {cover && (
                // The show's own picture (public/cast), so discreet mode leaves it alone like any house portrait.
                // eslint-disable-next-line @next/next/no-img-element -- a small static file, already the size it's shown at
                <img className="ad-si-shelf-cover" src={cover.src} alt={cover.alt} width={960} height={720} loading="lazy" decoding="async" data-step-in-card-cover />
              )}
              {/* One of their own two: it has no picture because it's with someone other than the one in it, and it
                  says why, for as long as the card is with someone they've stepped in with. */}
              {yours !== null && !cover && who.order.slice(0, who.own).some((c) => c.id === them.id) && (
                <p className="kicker ad-si-shelf-yours" data-step-in-card-yours>
                  With someone you know
                </p>
              )}
              {mine && (
                <p className="kicker ad-si-shelf-yours" data-step-in-card-own>
                  Your own
                </p>
              )}
              <h3>
                <span aria-hidden="true">{rp.icon}</span> {rp.title}
                {played[rp.id] ? (
                  <span className="ad-si-shelf-played" data-step-in-card-played>
                    ✓ Played
                  </span>
                ) : null}
              </h3>
              <p className="ad-si-shelf-setup">{setup}</p>
              {places[rp.id] && (
                <p className="muted small ad-si-shelf-at" data-step-in-card-at={places[rp.id].public ? "public" : "private"}>
                  📍 {places[rp.id].title}
                  {places[rp.id].public ? " · out in public" : ""}
                </p>
              )}
              {/* What their side of it wants: what they're playing for (the card's own words, told to them). */}
              {goal && (
                <p className="muted small ad-si-shelf-goal" data-step-in-card-goal>
                  {goal}
                </p>
              )}
              {rp.roles && (
                <p className="muted small ad-si-shelf-roles">
                  You play {rp.roles[you]}; {name} plays {rp.roles[you === 0 ? 1 : 0]}.
                </p>
              )}
              <p className="ad-si-shelf-who">
                <CharacterName character={them} link={false} size={34} strong />
                <BondMarkTag mark={bonds[them.id]} className="ad-si-shelf-bond" />
                {who.order.length > 1 && (
                  <button type="button" className="link-button small" onClick={() => setTurns((t) => ({ ...t, [turnKey]: turn + 1 }))} aria-label={`Play ${rp.title} with someone else`} data-step-in-card-next>
                    Someone else
                  </button>
                )}
              </p>
              <p className="ad-si-shelf-go">
                <StepInButton characterId={them.id} name={name} roleplay={{ id: rp.id, you }} className="button small" label={`Step in with ${name}`} about={rp.title} />
                <Link className="button-ghost small" href={`/after-dark/step-in?with=${encodeURIComponent(them.id)}&roleplay=${encodeURIComponent(rp.id)}${you === 1 ? "&you=1" : ""}#ad-si-set`} data-step-in-card-setup>
                  Set it up
                </Link>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
