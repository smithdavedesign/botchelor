"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Avatar from "@/app/Avatar";
import CharacterName from "@/app/CharacterName";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import { oneFaceGroups } from "@/lib/adult/pair-pick";
import { ROLEPLAYS } from "@/lib/adult/roleplays";
import { adultTagById, roleplayGroups } from "@/lib/adult/tags";
import { useAdultTagDemand } from "@/app/after-dark/useAdultTagDemand";
import type { StepInCharacter, StepInPlace } from "@/lib/adult/step-in";
import type { CrisisResources } from "@/lib/crisis";
import { premiseForYou } from "@/lib/roleplays";
import { CARD_OPENING_MAX, cardForYou, GENERIC_OPENINGS } from "@/lib/scene-cards";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

type Opening = 0 | 1 | 2 | "surprise" | "written";

const NO_RECENT: string[] = [];

/**
 * Step in's set-up (lib/adult/step-in.ts startStepIn), four small steps on one page: who, where, the roleplay and which
 * side of it you play, and how it opens. Everything shown about a roleplay is from the viewer's side (lib/scene-cards.ts
 * cardForYou: "you", the verbs agreeing). Menus and one optional sentence: no prompt box.
 */
export default function StepInSetup({
  cast,
  recent = NO_RECENT,
  places,
  persona,
  personaLeftOut = false,
  personaHref,
  preselect,
}: {
  cast: StepInCharacter[];
  /** Who they've had scenes with, the latest first (shown first). */
  recent?: string[];
  places: StepInPlace[];
  /** The name the viewer goes by in scenes (lib/persona.ts), when After Dark's lines let it through. */
  persona: { name: string } | null;
  /** They have a persona and the scene's checks leave it out (lib/adult/step-in.ts stepInPersona). */
  personaLeftOut?: boolean;
  /** Where the persona is edited: the show's account page. */
  personaHref: string;
  /** A character to start on (?with=<id>). */
  preselect?: string | null;
}) {
  const router = useRouter();
  const [who, setWho] = useState<string | null>(cast.some((c) => c.id === preselect) ? preselect! : null);
  const [query, setQuery] = useState("");
  const [placeId, setPlaceId] = useState(places.find((p) => p.id === "venue:home")?.id ?? places[0]?.id ?? "");
  const [roleplayId, setRoleplayId] = useState("");
  const [you, setYou] = useState<0 | 1>(0);
  const [opening, setOpening] = useState<Opening>("surprise");
  const [written, setWritten] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(null);

  const character = cast.find((c) => c.id === who) ?? null;
  // Who to pick from: theirs, the house cast and everyone else, or what the search finds (lib/adult/pair-pick.ts, as on the hub's picker).
  const groups = useMemo(() => oneFaceGroups(cast, recent, query), [cast, recent, query]);
  const shown = groups.reduce((n, g) => n + g.faces.length, 0);
  const place = places.find((p) => p.id === placeId) ?? null;
  const rp = ROLEPLAYS.find((r) => r.id === roleplayId) ?? null;
  const name = character ? first(character.name) : "them";
  const side = you === 1 ? "b" : "a";
  // The roleplay's card as the viewer reads it, and the three openings to pick from (the generic three with no roleplay).
  const card = useMemo(() => (rp ? cardForYou(rp.card, side, name) : null), [rp, side, name]);
  // (They name who the viewer is with, so they wait for a pick: "when them walks in" reads wrong.)
  const openings = !character ? [] : card ? card.openings : GENERIC_OPENINGS.map((o) => premiseForYou(o, "a", name));
  // Grouped by who they are to each other (each roleplay's first setup tag, lib/adult/tags.ts), most wanted first.
  const demand = useAdultTagDemand();
  const byCategory = useMemo(() => roleplayGroups(ROLEPLAYS, demand ?? undefined), [demand]);

  async function start() {
    if (!character || !place || busy) return;
    setBusy(true);
    setError(null);
    setCrisis(null);
    try {
      const res = await fetch("/api/admin/after-dark/step-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          character_id: character.id,
          place: place.id,
          roleplay: rp ? { id: rp.id, you } : null,
          opening: opening === "written" ? (written.trim() ? { written } : "surprise") : opening,
        }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      const help = crisisFrom(data);
      if (help) {
        setCrisis(help);
        return;
      }
      if (!res.ok || !data?.id) {
        setError(data?.message ?? "That didn't start. Try again in a moment.");
        return;
      }
      router.push(`/after-dark/step-in/${data.id}`);
    } catch {
      setError("That didn't start. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ad-si-setup">
      <fieldset className="card ad-si-step">
        <legend>1 · Who</legend>
        {/* A face and a whole name each, with a search (first names alone made the cast's Alexes one chip each, and 150 chips
            to scan): the hub's picker's look. Once someone is picked, just them, and a way back to the rest. */}
        {character ? (
          <div className="ad-si-who" data-step-in-who={character.id}>
            <CharacterName character={character} link={false} size={44} strong />
            <button type="button" className="link-button" onClick={() => setWho(null)}>
              Pick someone else
            </button>
          </div>
        ) : (
          <>
            <input
              type="search"
              className="ad-pp-search ad-si-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${cast.length} ${cast.length === 1 ? "character" : "characters"} by name`}
              aria-label="Search the cast by name"
              autoComplete="off"
              spellCheck={false}
              data-step-in-search
            />
            <p className="sr-only" aria-live="polite">
              {query.trim() ? `${shown} ${shown === 1 ? "match" : "matches"}` : ""}
            </p>
            <div className="ad-pp-panel ad-si-panel" role="group" aria-label="Who you're in the scene with">
              {groups.length ? (
                groups.map((g) => (
                  <section key={g.label} className="ad-pp-group">
                    <h4 className="ad-pp-group-label">{g.label}</h4>
                    <ul className="ad-pp-grid">
                      {g.faces.map((c) => (
                        <li key={c.id}>
                          <button type="button" className="ad-pp-face" title={c.name} onClick={() => setWho(c.id)} data-face={c.id}>
                            <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house ?? false} portraitSrc={c.portrait} size={56} decorative round />
                            <span className="ad-pp-name">{c.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              ) : (
                <p className="muted small ad-pp-none">
                  Nobody called “{query.trim()}”.{" "}
                  <button type="button" className="link-button" onClick={() => setQuery("")}>
                    Show everyone
                  </button>
                </p>
              )}
            </div>
          </>
        )}
        <p className="muted small">
          {persona ? (
            <>
              You go by <strong>{persona.name}</strong> in scenes · <a href={personaHref}>edit who you are</a>
            </>
          ) : personaLeftOut ? (
            <span data-step-in-persona-left-out>
              Who you are in scenes isn&apos;t used here: it mentions something these scenes leave out (anyone&apos;s family, anyone young, school, or someone kept
              from saying no). <a href={personaHref}>Edit it</a>, or play without.
            </span>
          ) : (
            <>
              They don&apos;t know who you are in scenes yet. <a href={personaHref}>Add a name, a look and a line about you</a>, or play without.
            </>
          )}
        </p>
      </fieldset>

      <fieldset className="card ad-si-step">
        <legend>2 · Where</legend>
        <label htmlFor="ad-si-place" className="sr-only">
          The place
        </label>
        <select id="ad-si-place" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
              {p.public ? " · out in public" : ""}
            </option>
          ))}
        </select>
        {/* The place itself, empty (the show's own backdrop, or a drawn set): a background, so discreet mode's blur leaves it alone. */}
        {place?.image && <div className="ad-si-place-picture" style={{ backgroundImage: `url("${place.image}")` }} aria-hidden="true" data-step-in-place-picture />}
        {place?.public && <p className="muted small">Out in public, a scene goes as far as a kiss. It can move somewhere private later, from the scene&apos;s ⋯ menu.</p>}
      </fieldset>

      <fieldset className="card ad-si-step">
        <legend>3 · The roleplay</legend>
        <label htmlFor="ad-si-roleplay" className="sr-only">
          The roleplay
        </label>
        <select
          id="ad-si-roleplay"
          value={roleplayId}
          onChange={(e) => {
            setRoleplayId(e.target.value);
            setYou(0);
            if (opening !== "written") setOpening("surprise");
          }}
        >
          <option value="">None: a date, as yourselves</option>
          {byCategory.map((c) => (
            <optgroup key={c.id} label={c.label}>
              {c.roleplays.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {rp && card && (
          <>
            {/* How it starts, with "you" in it and their name: it waits for a pick, like the openings. */}
            {character ? <p className="ad-si-card-setup">{card.setup}</p> : <p className="muted small">Pick who you&apos;re with to read how it starts.</p>}
            {rp.tags.length > 0 && <p className="ad-rp-tags">{rp.tags.map((t) => adultTagById(t)?.label).filter(Boolean).join(" · ")}</p>}
            {rp.roles && (
              <div className="ad-si-roles" role="radiogroup" aria-label="Who plays which role">
                {([0, 1] as const).map((i) => (
                  <label key={i} className="check">
                    <input type="radio" name="ad-si-you" checked={you === i} onChange={() => setYou(i)} />
                    <span>
                      You play {rp.roles![i]}; {character ? `${name} plays` : "they play"} {rp.roles![i === 0 ? 1 : 0]}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="muted small">The roleplay is the story: its stakes and what each of you wants drive the scene. It ends when you end the scene.</p>
          </>
        )}
      </fieldset>

      <fieldset className="card ad-si-step">
        <legend>4 · How it opens</legend>
        <div className="ad-si-openings" role="radiogroup" aria-label="How the scene opens">
          <label className="check">
            <input type="radio" name="ad-si-opening" checked={opening === "surprise"} onChange={() => setOpening("surprise")} />
            <span>Surprise me</span>
          </label>
          {openings.map((o, i) => (
            <label key={i} className="check">
              <input type="radio" name="ad-si-opening" checked={opening === i} onChange={() => setOpening(i as 0 | 1 | 2)} />
              <span>{o}</span>
            </label>
          ))}
          <label className="check">
            <input type="radio" name="ad-si-opening" checked={opening === "written"} onChange={() => setOpening("written")} />
            <span>One sentence of your own</span>
          </label>
        </div>
        {!character && <p className="muted small">Pick who you&apos;re with, and three ways it can open show here.</p>}
        {opening === "written" && (
          <>
            <label htmlFor="ad-si-written" className="sr-only">
              Your opening
            </label>
            <input id="ad-si-written" value={written} maxLength={CARD_OPENING_MAX} onChange={(e) => setWritten(e.target.value)} placeholder="I'm halfway through a crossword when they sit down." />
            <p className="muted small">One sentence of story: who is where, doing what. Nothing explicit here; the scene decides how far it goes.</p>
          </>
        )}
      </fieldset>

      {crisis && <CrisisNotice resources={crisis} onClose={() => setCrisis(null)} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="ad-si-go">
        <button type="button" className="primary" disabled={!character || !place || busy} onClick={() => void start()}>
          {busy ? `${name} is on the way…` : character ? `Step in with ${name}` : "Pick who first"}
        </button>
        <span className="muted small">
          Replies are included (fair use). Both of you can stop at any time. <Link href="/after-dark/account">Your writer and privacy</Link>
        </span>
      </p>
    </div>
  );
}
