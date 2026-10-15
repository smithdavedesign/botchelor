"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "../../request";

type Props = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: string[];
  want: string;
  appearance: string | null;
  pronouns: string | null;
  voice: string | null;
};

/** Owner-only: edit a character's characteristics any time, or delete it. Shown only to the owner. */
export default function OwnerControls(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const str = (k: string) => String(form.get(k) ?? "").trim();
    const body: Record<string, unknown> = {
      name: str("name"),
      age: Number(str("age")),
      bio: str("bio"),
      traits: [str("t0"), str("t1"), str("t2")],
      want: str("want"),
      appearance: str("appearance") || null,
      pronouns: str("pronouns") || null,
      voice: str("voice") || null,
    };
    const dealbreaker = str("dealbreaker");
    if (dealbreaker) body.dealbreaker = dealbreaker; // blank = leave the quiz answer unchanged
    setBusy(true);
    setError(null);
    setSaved(false);
    const { ok, message } = await requestJson(`/api/characters/${props.id}`, body, "PATCH").catch(() => ({ ok: false, message: "Network error." }));
    setBusy(false);
    if (ok) {
      setSaved(true);
      router.refresh();
    } else {
      setError(message);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${props.name}? This can't be undone. If they've already aired in an episode, that episode stays but is no longer yours.`)) return;
    setBusy(true);
    const { ok } = await requestJson(`/api/characters/${props.id}`, {}, "DELETE").catch(() => ({ ok: false }));
    setBusy(false);
    if (ok) router.push("/account");
  }

  if (!open) {
    return (
      <section className="card owner-controls">
        <p className="muted">
          This is your character. <button type="button" className="link-button" onClick={() => setOpen(true)}>Edit or delete</button>
        </p>
      </section>
    );
  }

  return (
    <section className="card owner-controls">
      <h2>Edit your character</h2>
      <form onSubmit={save}>
        <label>
          Name
          <input name="name" defaultValue={props.name} maxLength={40} required />
        </label>
        <label>
          Age
          <input name="age" type="number" defaultValue={props.age} min={18} max={1000} required />
        </label>
        <label>
          Bio
          <textarea name="bio" defaultValue={props.bio} maxLength={500} rows={3} required />
        </label>
        <fieldset className="traits-fields">
          <legend>Three traits</legend>
          {[0, 1, 2].map((i) => (
            <input key={i} name={`t${i}`} defaultValue={props.traits[i] ?? ""} maxLength={30} required />
          ))}
        </fieldset>
        <label>
          Wants
          <input name="want" defaultValue={props.want} maxLength={140} required />
        </label>
        <label>
          Dealbreaker <span className="muted">(the quiz answer — leave blank to keep it)</span>
          <input name="dealbreaker" placeholder="unchanged" maxLength={140} />
        </label>
        <label>
          Looks (optional)
          <input name="appearance" defaultValue={props.appearance ?? ""} maxLength={140} />
        </label>
        <label>
          Pronouns (optional)
          <select name="pronouns" defaultValue={props.pronouns ?? ""}>
            <option value="">Not set</option>
            <option value="she/her">she/her</option>
            <option value="he/him">he/him</option>
            <option value="they/them">they/them</option>
          </select>
        </label>
        <label>
          How they talk (optional)
          <textarea name="voice" defaultValue={props.voice ?? ""} maxLength={200} rows={2} />
        </label>
        <div className="account-actions">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <button type="button" className="button-ghost" onClick={() => setOpen(false)} disabled={busy}>
            Done
          </button>
          <button type="button" className="link-button danger" onClick={remove} disabled={busy}>
            Delete character
          </button>
        </div>
      </form>
      {saved && <p className="notice">Saved.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
