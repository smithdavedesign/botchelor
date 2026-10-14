"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Avatar from "./Avatar";
import { AVATAR_HUES } from "@/lib/avatar";
import {
  AGENDAS,
  AUTONOMY_BLURBS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
  ENDING_LABELS,
  ENDINGS,
  GAME_BUDGETS,
  STRATEGIES,
  STRATEGY_LABELS,
  formatGameBudget,
  type Autonomy,
  type Ending,
  type GameBudget,
  type Strategy,
} from "@/lib/rules";
import { requestJson } from "./request";

export type Partner = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: string[];
  /** A premium house character (M3) this viewer owns. Off sale now, so only owners ever see one. */
  premium?: boolean;
};

/** Dates left for this viewer (M4): free ones this week, plus any from episode packs. */
export type DatesLeft = { free_left: number; free_per_season: number; pack_left: number };

type DateSettings = {
  autonomy: Autonomy;
  strategy: Strategy;
  game_budget: GameBudget;
  agenda: string;
  note: string;
  self_pick: string;
};

const DEFAULT_SETTINGS: DateSettings = {
  autonomy: "balanced",
  strategy: "genuine_chemistry",
  game_budget: 25,
  agenda: "",
  note: "",
  self_pick: "",
};

function PackOffer({ offer }: { offer: string | null }) {
  if (!offer) return null;
  return (
    <>
      {" "}
      Need more? <Link href="/shop">{offer}</Link> <span className="muted">(they never add points)</span>
    </>
  );
}

function DatesLeftNote({ dates, offer }: { dates: DatesLeft; offer: string | null }) {
  return (
    <p className="muted">
      {dates.free_left} of {dates.free_per_season} free dates left this week (they come back Monday 00:00 UTC)
      {dates.pack_left > 0 && `, plus ${dates.pack_left} from episode packs`}.
      {dates.free_left + dates.pack_left <= 1 && <PackOffer offer={offer} />}
    </p>
  );
}

/** The owner's dials for this date (PRD budget & autonomy). All optional; sensible defaults. */
function DateSettingsForm({ settings, onChange }: { settings: DateSettings; onChange: (s: DateSettings) => void }) {
  const set = <K extends keyof DateSettings>(key: K, value: DateSettings[K]) => onChange({ ...settings, [key]: value });
  return (
    <details className="card settings">
      <summary>Date settings (optional)</summary>
      <label>
        Autonomy
        <select value={settings.autonomy} onChange={(e) => set("autonomy", e.target.value as Autonomy)}>
          {AUTONOMY_LEVELS.map((a) => (
            <option key={a} value={a}>
              {AUTONOMY_LABELS[a]}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">{AUTONOMY_BLURBS[settings.autonomy]}</p>
      <label>
        Strategy
        <select value={settings.strategy} onChange={(e) => set("strategy", e.target.value as Strategy)}>
          {STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {STRATEGY_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date budget <span className="muted">(fictional; can&apos;t be bought)</span>
        <select value={settings.game_budget} onChange={(e) => set("game_budget", Number(e.target.value) as GameBudget)}>
          {GAME_BUDGETS.map((b) => (
            <option key={b} value={b}>
              {formatGameBudget(b)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Secret agenda
        <select value={settings.agenda} onChange={(e) => set("agenda", e.target.value)}>
          <option value="">Let the show decide</option>
          {AGENDAS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        A note in the pocket <span className="muted">(one sentence; your AI may or may not take it)</span>
        <input type="text" maxLength={200} value={settings.note} onChange={(e) => set("note", e.target.value)} />
      </label>
      <label>
        Your guess: how will your own AI&apos;s date end?
        <select value={settings.self_pick} onChange={(e) => set("self_pick", e.target.value)}>
          <option value="">Skip</option>
          {ENDINGS.map((end) => (
            <option key={end} value={end}>
              {ENDING_LABELS[end]}
            </option>
          ))}
        </select>
      </label>
    </details>
  );
}

export default function StartForm({
  partners,
  dates,
  offer,
  myCharacters,
}: {
  partners: Partner[];
  dates: DatesLeft;
  offer: string | null;
  /** The viewer's existing characters, so one can go on another date without retyping its sheet. */
  myCharacters: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [character, setCharacter] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<"character" | "episode" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfDates, setOutOfDates] = useState(false);
  const [settings, setSettings] = useState<DateSettings>(DEFAULT_SETTINGS);
  // For the live avatar preview in the builder.
  const [previewName, setPreviewName] = useState("");
  const [hue, setHue] = useState(0);

  async function createCharacter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();
    // Build the private soul only from fields the creator actually filled in.
    const soulEntries = (["values", "insecurities", "humor", "boundaries", "romantic", "communication"] as const)
      .map((k) => [k, field(`soul_${k}`)] as const)
      .filter(([, v]) => v.length > 0);
    const soul = soulEntries.length
      ? { ...Object.fromEntries(soulEntries), local_only: form.get("soul_local_only") === "on" }
      : undefined;
    setBusy("character");
    setError(null);
    try {
      const { status, data, message } = await requestJson("/api/characters", {
        name: field("name"),
        age: Number(field("age")),
        bio: field("bio"),
        traits: [field("trait1"), field("trait2"), field("trait3")],
        want: field("want"),
        dealbreaker: field("dealbreaker"),
        ...(field("appearance") ? { appearance: field("appearance") } : {}),
        ...(hue > 0 ? { avatar_hue: hue } : {}),
        ...(soul ? { soul } : {}),
        attest: form.get("attest") === "on",
      });
      if (status === 201) setCharacter({ id: String(data.id), name: String(data.name) });
      else setError(message);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /** A house partner by id, or null for a blind date the show picks. */
  async function sendOnDate(partnerId: string | null) {
    if (!character) return;
    setBusy("episode");
    setError(null);
    const dateFields = {
      autonomy: settings.autonomy,
      strategy: settings.strategy,
      game_budget: settings.game_budget,
      ...(settings.agenda ? { agenda: settings.agenda } : {}),
      ...(settings.note.trim() ? { note: settings.note.trim() } : {}),
      ...(settings.self_pick ? { self_pick: settings.self_pick as Ending } : {}),
    };
    try {
      const { status, data, message } = await requestJson("/api/episodes", {
        character_id: character.id,
        ...(partnerId ? { partner_id: partnerId } : { blind: true }),
        ...dateFields,
      });
      if (status === 200) {
        router.push(String(data.share_path));
        return;
      }
      setOutOfDates(data.error === "episode_limit_reached");
      setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(null);
  }

  if (character) {
    return (
      <section>
        <h2>Who should {character.name} meet?</h2>
        <DatesLeftNote dates={dates} offer={offer} />
        <DateSettingsForm settings={settings} onChange={setSettings} />
        <div className="card">
          <strong>A blind date</strong>
          <p>
            The show picks another creator&apos;s character for you (or a house character if nobody&apos;s around). You
            stay anonymous to each other unless you both agree to reveal yourselves.
          </p>
          <button type="button" disabled={busy !== null} onClick={() => sendOnDate(null)}>
            Send {character.name} on a blind date
          </button>
        </div>
        <p className="muted">Or pick a house character. They belong to the show. Either way, you can&apos;t steer the date.</p>
        {partners.map((p) => (
          <div className="card" key={p.id}>
            <div className="char">
              <Avatar seed={p.id} name={p.name} house size={44} />
              <div className="meta">
                <strong>
                  {p.name}, {p.age}
                </strong>
                <span className="badge">House character</span>
                {p.premium && <span className="badge">Premium · yours</span>}
              </div>
            </div>
            <p>{p.bio}</p>
            <ul className="chips">
              {p.traits.map((trait) => (
                <li className="chip" key={trait}>
                  {trait}
                </li>
              ))}
            </ul>
            <button type="button" disabled={busy !== null} onClick={() => sendOnDate(p.id)}>
              Send {character.name} on a date with {p.premium ? p.name : p.name.split(" ")[0]}
            </button>
          </div>
        ))}
        {busy === "episode" && <p className="muted">The engine is deciding the outcome and the showrunner is writing it…</p>}
        {error && <p className="error">{error}</p>}
        {outOfDates && (
          <p>
            {offer ? <Link href="/shop">{offer}</Link> : <Link href="/shop">See episode packs</Link>}{" "}
            <span className="muted">(optional; they never add points)</span>
          </p>
        )}
      </section>
    );
  }

  return (
    <>
      {myCharacters.length > 0 && (
        <section className="card">
          <h2>Your characters</h2>
          <DatesLeftNote dates={dates} offer={offer} />
          <ul className="list">
            {myCharacters.map((c) => (
              <li key={c.id}>
                <div className="char">
                  <Avatar seed={c.id} name={c.name} size={36} />
                  <button type="button" className="secondary small" onClick={() => setCharacter(c)}>
                    Send {c.name} on another date
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form className="card" onSubmit={createCharacter}>
        <h2>{myCharacters.length > 0 ? "A new character" : "Your character"}</h2>
        <label>
          Name
          <input type="text" name="name" required maxLength={40} onChange={(e) => setPreviewName(e.target.value)} />
        </label>
        <label>
          Age (18 or older)
          <input type="number" name="age" required min={18} max={1000} step={1} />
        </label>
        <label>
          Short bio
          <textarea name="bio" required maxLength={500} rows={3} />
        </label>
        <label>Three traits</label>
        <div className="traits">
          <input type="text" name="trait1" required maxLength={30} aria-label="Trait 1" />
          <input type="text" name="trait2" required maxLength={30} aria-label="Trait 2" />
          <input type="text" name="trait3" required maxLength={30} aria-label="Trait 3" />
        </div>
        <label>
          What they want from a date
          <input type="text" name="want" required maxLength={140} />
        </label>
        <label>
          Their dealbreaker
          <input type="text" name="dealbreaker" required maxLength={140} />
        </label>

        <div className="looks">
          <Avatar seed={previewName || "preview"} name={previewName || "?"} hue={hue} size={72} />
          <div className="looks-fields">
            <label>
              Appearance <span className="muted">(optional)</span>
              <input type="text" name="appearance" maxLength={140} placeholder="tall, freckled, always in a yellow raincoat" />
            </label>
            <span className="muted">Avatar colour</span>
            <div className="swatches">
              {AVATAR_HUES.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={`swatch${hue === h.id ? " chosen" : ""}`}
                  style={h.id ? { background: `hsl(${h.id} 70% 55%)` } : undefined}
                  aria-label={h.label}
                  title={h.label}
                  onClick={() => setHue(h.id)}
                />
              ))}
            </div>
          </div>
        </div>

        <details className="settings">
          <summary>Give them a private soul (optional)</summary>
          <p className="muted">
            The audience only ever sees the public character above. The soul shapes how your AI behaves on the date
            without being shown to anyone else. It&apos;s yours to edit or delete, and the same no-minors, no-real-people,
            no-sexual-content rules apply.
          </p>
          <label>
            Core values
            <input type="text" name="soul_values" maxLength={300} />
          </label>
          <label>
            Insecurities
            <input type="text" name="soul_insecurities" maxLength={300} />
          </label>
          <label>
            Sense of humour
            <input type="text" name="soul_humor" maxLength={300} />
          </label>
          <label>
            Boundaries
            <input type="text" name="soul_boundaries" maxLength={300} />
          </label>
          <label>
            Romantic preferences
            <input type="text" name="soul_romantic" maxLength={300} />
          </label>
          <label>
            Communication style
            <input type="text" name="soul_communication" maxLength={300} />
          </label>
          <label className="check">
            <input type="checkbox" name="soul_local_only" />
            <span>Keep this soul off the model (engine only). It still shapes the date, but its text is never sent to any AI model.</span>
          </label>
        </details>

        <label className="check">
          <input type="checkbox" name="attest" required />
          <span>I&apos;m 18 or older, and this is my own original character: an adult, not a real person.</span>
        </label>
        <p className="muted">
          No minors, real people or sexual content. Your sheet and any soul are sent to an AI model to write the episode,
          and other creators&apos; blind dates may be matched with your character. Episodes appear in the public feed; you
          stay anonymous.
        </p>
        <button type="submit" disabled={busy !== null}>
          {busy === "character" ? "Checking…" : "Create character"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </>
  );
}
