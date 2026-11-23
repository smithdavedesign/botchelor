import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import CharacterName from "@/app/CharacterName";
import Icon from "@/app/Icon";
import { isAdmin } from "@/lib/admins";
import { rolloutOn } from "@/lib/adult/rollout";
import { getAdultSettings } from "@/lib/adult/settings";
import { drawnSets, listStepInScenes, playedRoleplays, STEP_IN_TAGLINE, stepInCast, stepInPersona, stepInPlaces, stepInViewerFromCookies, storyPlaces, type StepInSceneRef } from "@/lib/adult/step-in";
import type { BondMark } from "@/lib/adult/step-in-bond";
import { bondMarks } from "@/lib/adult/step-in-bond-data";
import { getDb } from "@/lib/db";
import { showHome } from "@/lib/site";
import LocalTime from "../LocalTime";
import StepInSetup from "./StepInSetup";
import StepInShelf from "./StepInShelf";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Step in · After Dark · Botchelor", robots: { index: false, follow: false } };

type Props = { searchParams?: Promise<{ with?: string; roleplay?: string }> };

/** When a scene was last played or ended, as a day in the viewer's own clock (LocalTime writes it in the browser). */
const WHEN = { day: "numeric", month: "short" } as const;

/**
 * Step in's front page (lib/adult/step-in.ts; docs/after-dark.md "Step in"): the viewer's scenes to pick up, the
 * roleplays as cards to start in a click (./StepInShelf.tsx), the set-up for everything a card doesn't choose (who,
 * where, the roleplay and the viewer's side of it, how it opens), then the scenes they ended. `?with=` and `?roleplay=`
 * start the set-up on someone and on a roleplay ("Set it up" on a card). Not found for anyone Step in isn't open to
 * (the "companion" rollout piece: admins only until it's switched on), like After Dark's other closed pieces.
 */
export default async function StepInSetupPage({ searchParams }: Props = {}) {
  const db = await getDb();
  const viewer = await stepInViewerFromCookies(db, await cookies());
  if (!viewer) notFound();
  const [cast, drawn, who, scenes, admin, settings, sp, played, bonds] = await Promise.all([
    stepInCast(db, viewer),
    drawnSets(db),
    stepInPersona(db, viewer),
    listStepInScenes(db, viewer),
    isAdmin(db, viewer),
    getAdultSettings(db),
    searchParams,
    // Which roleplays they've played to the end (lib/adult/step-in-story.ts): said on the shelf's cards.
    playedRoleplays(db, viewer).catch(() => ({}) as Record<string, number>),
    // How well they know each of them (lib/adult/step-in-bond.ts): one statement for every card's mark.
    bondMarks(db, viewer)
      .then((m) => Object.fromEntries(m))
      .catch(() => ({}) as Record<string, BondMark>),
  ]);
  // The persona is the show's to edit (app/account/PersonaCard.tsx): one for every scene, on either side.
  const personaHref = `${showHome().replace(/\/$/, "")}/account#persona`;
  // Still closed to everyone else: an admin is told so, and where the switch is.
  const adminsOnly = admin && !rolloutOn(settings.rollout, "companion", false);
  // Who they've had scenes with, the latest first: the picker shows them first.
  const recent = [...scenes.running, ...scenes.ended].sort((x, y) => y.last_at.localeCompare(x.last_at)).map((s) => s.character.id);
  // Where each roleplay's own story is set, and whether that's out in public (the cards, and the set-up's "Where").
  const stories = storyPlaces();
  return (
    <div className="after-dark-mode">
      <article className="after-dark ad-si" data-step-in-setup>
        <p className="kicker">
          <Link href="/after-dark">
            ← <Icon name="moon" /> After Dark
          </Link>
        </p>
        <h1>Step in</h1>
        <p className="muted ad-si-tagline">{STEP_IN_TAGLINE}</p>
        <p>
          You, in the scene with one of them: a date or a roleplay, told as a story. You write what you say and do; they answer in their own voice, with a will of
          their own.
        </p>
        {adminsOnly && (
          <p className="muted small" data-step-in-admins-only>
            Admins only for now. It opens to everyone After Dark is open to from <Link href="/admin/after-dark/settings?tab=rollout">Settings → Rollout</Link>, once the card
            processors have been told.
          </p>
        )}
        {scenes.running.length > 0 && (
          <section aria-labelledby="ad-si-running">
            <h2 id="ad-si-running">Pick up where you left off</h2>
            <SceneList scenes={scenes.running} />
          </section>
        )}
        {/* The roleplays, each cast and ready (UTC's day, so this page and the browser agree on who's on each card). */}
        {cast.length > 0 && <StepInShelf cast={cast} recent={recent} day={new Date().toISOString().slice(0, 10)} with_={sp?.with ?? null} places={stories} played={played} bonds={bonds} />}
        <h2 id="ad-si-set">{cast.length ? "Or set the scene yourself" : "Set the scene"}</h2>
        {cast.length ? (
          // Keyed on what it starts from: "Set it up" on a card comes back to this page with another pair.
          <StepInSetup
            key={`${sp?.with ?? ""}:${sp?.roleplay ?? ""}`}
            cast={cast}
            recent={recent}
            places={stepInPlaces(drawn)}
            persona={who.persona ? { name: who.persona.name } : null}
            personaLeftOut={who.leftOut}
            personaHref={personaHref}
            preselect={sp?.with ?? null}
            preselectRoleplay={sp?.roleplay ?? null}
            storyPlaces={stories}
          />
        ) : (
          <p className="muted">Nobody is in your After Dark yet. This season&apos;s cast is in by default; your own characters are switched in on the Studio page.</p>
        )}
        {scenes.ended.length > 0 && (
          <section aria-labelledby="ad-si-ended">
            <h2 id="ad-si-ended">Scenes you ended</h2>
            <p className="muted small">Kept to read again. The next scene with someone remembers the last ones in a line.</p>
            <SceneList scenes={scenes.ended} />
          </section>
        )}
      </article>
    </div>
  );
}

function SceneList({ scenes }: { scenes: StepInSceneRef[] }) {
  return (
    <ul className="list ad-si-scenes">
      {scenes.map((s) => (
        <li key={s.id} className="card ad-si-scene-row" data-step-in-scene={s.id}>
          <Link href={`/after-dark/step-in/${s.id}`} className="ad-si-scene-link">
            <CharacterName character={{ id: s.character.id, name: s.character.name, portrait: s.character.portrait, hue: s.character.hue }} link={false} size={34} strong />
            <span className="ad-si-scene-meta muted small">
              {s.place}
              {s.roleplay ? ` · ${s.roleplay}` : ""} · <LocalTime iso={s.ended_at ?? s.last_at} format={WHEN} />
            </span>
            {s.line && <span className="ad-si-scene-line small">{s.line}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
