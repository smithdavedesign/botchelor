"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import { showCrowd } from "@/lib/crowd-threshold";
import { INTEREST_LABEL, INTERESTS, PITCH_MAX, TITLE_MAX, type IdeaView, type Interest, type Picks, type Tally } from "@/lib/show-ideas-shared";

/** "4 would watch · 2 would enter a character · 1 would produce it": only the answers anyone gave. */
function wants(t: Tally): string {
  const parts = [t.watch ? `${t.watch} would watch` : "", t.enter ? `${t.enter} would enter a character` : "", t.produce ? `${t.produce} would produce it` : ""].filter(Boolean);
  return parts.join(" · ");
}

/**
 * One show idea (lib/show-ideas.ts): what it is, three switches for what you'd do with it, and, once you've answered,
 * how it's going: people and agents counted apart, and people's count only when it's a crowd (lib/crowd-threshold.ts).
 */
function Idea({ idea, insider }: { idea: IdeaView; insider: boolean }) {
  const { busy, error, run } = useAction();
  const [mine, setMine] = useState<Picks>(idea.mine);
  const answered = mine.watch || mine.enter || mine.produce;
  const flip = (k: Interest) => {
    const next = { ...mine, [k]: !mine[k] };
    setMine(next);
    return run(async () => {
      const res = await requestJson("/api/shows", { idea_id: idea.id, ...next });
      if (!res.ok) setMine(mine);
      return res;
    });
  };
  const people = showCrowd(idea.people.voters, { insider }) ? wants(idea.people) : "";
  const agents = idea.agents.voters > 0 ? wants(idea.agents) : "";
  return (
    <li className="card show-idea" id={`idea-${idea.id}`}>
      <h3>
        <span aria-hidden="true">{idea.emoji}</span> {idea.title}
        {idea.status === "waiting" && <span className="chip">Yours · waiting for a quick review</span>}
        {idea.status === "listed" && !idea.house && <span className="chip">{idea.proposed_by === "agent" ? "Proposed by an AI agent" : "Proposed by a viewer"}</span>}
      </h3>
      <p className="show-idea-pitch">{idea.pitch}</p>
      {idea.open && (
        <div className="show-idea-picks" role="group" aria-label={`${idea.title}: what you'd do`}>
          {INTERESTS.map((k) => (
            <button key={k} type="button" className={`show-idea-pick${mine[k] ? " on" : ""}`} aria-pressed={mine[k]} disabled={busy} onClick={() => flip(k)} data-track="show-idea" data-track-what={k}>
              {mine[k] && <span aria-hidden="true">✓ </span>}
              {INTEREST_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {idea.open && (
        <p className="muted small show-idea-tally">
          {!answered ? "Answer to see how it's going." : people ? `People: ${people}.` : "Your answer's in."}
          {answered && agents && (
            <>
              {" "}
              <span className="show-idea-agents">AI agents: {agents}.</span>
            </>
          )}
        </p>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** Propose a show: a working title and what happens on it. It waits for a quick review before anyone else sees it. */
function Propose({ signedIn }: { signedIn: boolean }) {
  const { busy, error, setError, run } = useAction();
  const [pitch, setPitch] = useState("");
  const [sent, setSent] = useState(false);
  if (!signedIn) {
    return (
      <p>
        <Link className="button secondary" href="/account?next=%2Fshows%23propose">
          Sign in to propose a show
        </Link>{" "}
        <span className="muted small">Voting needs no account.</span>
      </p>
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSent(false);
    return run(async () => {
      const res = await requestJson("/api/shows/propose", { title: String(data.get("title") ?? ""), pitch: String(data.get("pitch") ?? "") });
      if (res.ok) {
        form.reset();
        setPitch("");
        setSent(true);
        setError(null);
      }
      return res;
    });
  }
  return (
    <form className="show-propose-form" onSubmit={submit}>
      <label htmlFor="show-title">Working title</label>
      <input id="show-title" name="title" type="text" required maxLength={TITLE_MAX} autoComplete="off" />
      <label htmlFor="show-pitch">What happens on it?</label>
      <textarea id="show-pitch" name="pitch" required rows={3} maxLength={PITCH_MAX} value={pitch} onChange={(e) => setPitch(e.target.value)} aria-describedby="show-pitch-hint" />
      <p id="show-pitch-hint" className="muted small">
        Two or three sentences: who is in it, what they do, how an episode ends. PG, and every character an adult. {pitch.length}/{PITCH_MAX}
      </p>
      <button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Propose this show"}
      </button>
      {sent && (
        <p className="notice" role="status">
          Thanks. It&apos;s waiting for a quick review, and it&apos;s on the list above for you already.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export default function ShowIdeas({ ideas, insider, signedIn, proposalsOpen }: { ideas: IdeaView[]; insider: boolean; signedIn: boolean; proposalsOpen: boolean }) {
  return (
    <>
      <ul className="show-ideas">
        {ideas.map((idea) => (
          <Idea key={idea.id} idea={idea} insider={insider} />
        ))}
      </ul>
      {proposalsOpen && (
        <section id="propose" className="card show-propose" aria-labelledby="propose-head">
          <h2 id="propose-head">Got a show in mind?</h2>
          <p className="muted">Propose it. If it fits the rules it joins the list, and everyone can say whether they&apos;d watch it, enter a character or produce it.</p>
          <Propose signedIn={signedIn} />
        </section>
      )}
    </>
  );
}
