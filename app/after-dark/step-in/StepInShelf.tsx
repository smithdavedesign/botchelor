"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import CharacterName from "@/app/CharacterName";
import { useAdultTagDemand } from "@/app/after-dark/useAdultTagDemand";
import { ROLEPLAYS } from "@/lib/adult/roleplays";
import type { StepInCharacter } from "@/lib/adult/step-in-shared";
import { SHELF_TONIGHT, shelfCast, shelfLead, shelfTonight } from "@/lib/adult/step-in-shelf";
import { roleplayGroups } from "@/lib/adult/tags";
import { cardForYou } from "@/lib/scene-cards";
import StepInButton from "./StepInButton";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * Step in's roleplays as cards (lib/adult/step-in-shelf.ts; David, 2026-11-23, after Chub.ai's scene cards): each one a
 * situation told from the viewer's side, cast with someone from their own After Dark, and one click from being in it.
 * It opens on tonight's eight (a different eight tomorrow); a kind, or all of them, is a tap. "Someone else" recasts
 * a card on the spot; "Set it up" takes the pair to the set-up form below for the other side, another place or a
 * written opening. Nothing here costs anything until a card is started (one reply, like any opening).
 *
 * `day` is the server's (UTC), so the page it sends and the browser agree on who is on each card. `with_`: the page was
 * opened for one of them (?with=<id>, "Roleplay or place" on their card), so every card opens on that person.
 */
export default function StepInShelf({ cast, recent, day, with_ = null }: { cast: StepInCharacter[]; recent: string[]; day: string; with_?: string | null }) {
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
  if (!who.order.length) return null;
  const chip = (id: string, label: string, n?: number) => (
    <button key={id} type="button" className="ad-chip" aria-pressed={show === id} onClick={() => setShow(id)} data-step-in-shelf-show={id}>
      {label}
      {n !== undefined && <span className="ad-si-shelf-n"> {n}</span>}
    </button>
  );
  return (
    <section className="ad-si-shelf" aria-labelledby="ad-si-shelf-h" data-step-in-shelf>
      <h2 id="ad-si-shelf-h">{asked ? `Step into a roleplay with ${first(asked.name)}` : "Step into a roleplay"}</h2>
      <p className="muted small">
        {ROLEPLAYS.length} stories, each ready to play with {asked ? first(asked.name) : "someone from your After Dark"}. One click and you&apos;re in it.
      </p>
      <div className="ad-chip-row ad-si-shelf-kinds" role="group" aria-label="Which roleplays to show">
        {chip("tonight", `Tonight's ${SHELF_TONIGHT}`)}
        {groups.map((g) => chip(g.id, g.label, g.roleplays.length))}
        {chip("all", "All", ROLEPLAYS.length)}
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
              </h3>
              <p className="ad-si-shelf-setup">{card.setup}</p>
              {rp.roles && (
                <p className="muted small ad-si-shelf-roles">
                  You play {rp.roles[0]}; {name} plays {rp.roles[1]}.
                </p>
              )}
              <p className="ad-si-shelf-who">
                <CharacterName character={them} link={false} size={34} strong />
                {who.order.length > 1 && (
                  <button type="button" className="link-button small" onClick={() => setTurns((t) => ({ ...t, [rp.id]: turn + 1 }))} aria-label={`Play ${rp.title} with someone else`} data-step-in-card-next>
                    Someone else
                  </button>
                )}
              </p>
              <p className="ad-si-shelf-go">
                <StepInButton characterId={them.id} name={name} roleplay={{ id: rp.id, you: 0 }} className="button small" label={`Step in with ${name}`} />
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
