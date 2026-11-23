"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import CharacterName from "@/app/CharacterName";
import { useAdultTagDemand } from "@/app/after-dark/useAdultTagDemand";
import { ROLEPLAYS } from "@/lib/adult/roleplays";
import type { BondMark } from "@/lib/adult/step-in-bond";
import type { StepInCharacter } from "@/lib/adult/step-in-shared";
import { SHELF_TONIGHT, shelfCast, shelfLead, shelfTonight } from "@/lib/adult/step-in-shelf";
import { storyGoal } from "@/lib/adult/step-in-story";
import { roleplayGroups } from "@/lib/adult/tags";
import { cardForYou } from "@/lib/scene-cards";
import { BondMarkTag } from "./[id]/StepInBond";
import StepInButton from "./StepInButton";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

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
 */
export default function StepInShelf({
  cast,
  recent,
  day,
  with_ = null,
  played = {},
  bonds = {},
}: {
  cast: StepInCharacter[];
  recent: string[];
  day: string;
  with_?: string | null;
  /** The roleplays this viewer has played to their last beat, and how many times (lib/adult/step-in.ts playedRoleplays). */
  played?: Record<string, number>;
  /** How well the viewer knows each of them (lib/adult/step-in-bond-data.ts bondMarks): the level's name beside a face. */
  bonds?: Record<string, BondMark>;
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
  const shown = show === "tonight" ? shelfTonight(ROLEPLAYS, day) : show === "all" ? ROLEPLAYS : (groups.find((g) => g.id === show)?.roleplays ?? []);
  const playedCount = ROLEPLAYS.filter((r) => played[r.id]).length;
  if (!who.order.length) return null;
  const kind = groups.some((g) => g.id === show) ? show : "";
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
        {ROLEPLAYS.length} stories, each ready to play with {asked ? first(asked.name) : "someone from your After Dark"}. One click and you&apos;re in it.
        {playedCount > 0 && (
          <span data-step-in-shelf-played>
            {" "}
            You&apos;ve played {playedCount} of them to the end.
          </span>
        )}
      </p>
      <div className="ad-si-shelf-kinds" role="group" aria-label="Which roleplays to show">
        {chip("tonight", `Tonight's ${SHELF_TONIGHT}`)}
        {chip("all", "All", ROLEPLAYS.length)}
        <label htmlFor="ad-si-shelf-kind" className="sr-only">
          A kind of roleplay
        </label>
        <select id="ad-si-shelf-kind" className={kind ? "on" : undefined} value={kind} onChange={(e) => setShow(e.target.value || "tonight")} data-step-in-shelf-kind>
          <option value="">A kind…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label} ({g.roleplays.length})
            </option>
          ))}
        </select>
      </div>
      <ul className="ad-si-shelf-cards">
        {shown.map((rp) => {
          const turn = turns[rp.id] ?? 0;
          const them = shelfLead(rp.id, day, who, turn);
          if (!them) return null;
          const name = first(them.name);
          // The story as the viewer reads it: they're "you", the other is whoever is on the card.
          const card = cardForYou(rp.card, "a", name);
          return (
            <li key={rp.id} className="card ad-si-shelf-card" data-step-in-card={rp.id} data-step-in-card-with={them.id}>
              <h3>
                <span aria-hidden="true">{rp.icon}</span> {rp.title}
                {played[rp.id] ? (
                  <span className="ad-si-shelf-played" data-step-in-card-played>
                    ✓ Played
                  </span>
                ) : null}
              </h3>
              <p className="ad-si-shelf-setup">{card.setup}</p>
              {/* What their side of it wants: what they're playing for (the card's own words, told to them). */}
              <p className="muted small ad-si-shelf-goal" data-step-in-card-goal>
                {storyGoal(rp, 0, name)}
              </p>
              {rp.roles && (
                <p className="muted small ad-si-shelf-roles">
                  You play {rp.roles[0]}; {name} plays {rp.roles[1]}.
                </p>
              )}
              <p className="ad-si-shelf-who">
                <CharacterName character={them} link={false} size={34} strong />
                <BondMarkTag mark={bonds[them.id]} className="ad-si-shelf-bond" />
                {who.order.length > 1 && (
                  <button type="button" className="link-button small" onClick={() => setTurns((t) => ({ ...t, [rp.id]: turn + 1 }))} aria-label={`Play ${rp.title} with someone else`} data-step-in-card-next>
                    Someone else
                  </button>
                )}
              </p>
              <p className="ad-si-shelf-go">
                <StepInButton characterId={them.id} name={name} roleplay={{ id: rp.id, you: 0 }} className="button small" label={`Step in with ${name}`} about={rp.title} />
                <Link className="button-ghost small" href={`/after-dark/step-in?with=${encodeURIComponent(them.id)}&roleplay=${encodeURIComponent(rp.id)}#ad-si-set`} data-step-in-card-setup>
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
