"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { FRAMINGS, TURN_ONS, type FramingId, type TurnOnId } from "@/lib/adult/profile";
import type { AdultScene, ProfileView } from "@/lib/adult/scenes";

/**
 * What they're into, and how they know each other (lib/adult/profile.ts): the pair's framing (the viewer's, per pair),
 * and each character's private turn-ons, for a character whose profile the viewer may set (their own; an admin, the
 * house cast). Nothing here is ever shown on the show. Loaded when opened.
 */
export default function Profile({ scene, onScene }: { scene: AdultScene; onScene: (scene: AdultScene) => void }) {
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = (n: string) => n.split(/\s+/)[0];
  const ids = { a: scene.a.id, b: scene.b.id };

  async function load() {
    const res = await fetch(`/api/admin/after-dark?a=${encodeURIComponent(ids.a)}&b=${encodeURIComponent(ids.b)}&profile=1`).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { profile: ProfileView }) : null;
    if (!data) return setError("Their profiles didn't load. Try again.");
    setError(null);
    setProfile(data.profile);
  }
  async function post(body: Record<string, unknown>) {
    setBusy(true);
    const res = await requestJson("/api/admin/after-dark", { a: ids.a, b: ids.b, ...body }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res?.message ?? "That didn't save. Try again.");
    setError(null);
    if (res.data.profile) setProfile(res.data.profile as ProfileView);
    if (res.data.scene) onScene(res.data.scene as AdultScene);
  }
  function toggle(who: "a" | "b", id: TurnOnId) {
    const now = profile?.[who].turn_ons ?? [];
    void post({ turn_ons: { character_id: ids[who], ids: now.includes(id) ? now.filter((x) => x !== id) : [...now, id] } });
  }

  const framing = FRAMINGS.find((f) => f.id === scene.framing);
  return (
    <details className="ad-panel ad-profile" onToggle={(e) => (e.currentTarget.open && !profile ? void load() : undefined)}>
      <summary>💜 What they&apos;re into{framing ? ` · ${framing.label}` : ""}</summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <fieldset className="ad-framing">
        <legend>How they know each other tonight</legend>
        <div className="ad-chip-row" role="radiogroup" aria-label="How they know each other">
          {FRAMINGS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={scene.framing === f.id}
              className={`ad-chip${scene.framing === f.id ? " on" : ""}`}
              disabled={busy}
              title={f.prompt}
              onClick={() => void post({ framing: scene.framing === f.id ? null : (f.id as FramingId) })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </fieldset>
      {!profile ? (
        !error && <p className="muted small">Loading…</p>
      ) : (
        (["a", "b"] as const).map((who) => {
          const c = who === "a" ? scene.a : scene.b;
          if (!profile[who].editable) {
            return (
              <p key={who} className="muted small">
                {first(c.name)}&apos;s turn-ons are private to {first(c.name)}&apos;s owner.
              </p>
            );
          }
          return (
            <fieldset key={who} className="ad-turn-ons">
              <legend>{first(c.name)} is into (private, never on the show)</legend>
              <div className="ad-chip-row" role="group" aria-label={`What ${first(c.name)} is into`}>
                {TURN_ONS.map((t) => {
                  const on = profile[who].turn_ons.includes(t.id);
                  return (
                    <button key={t.id} type="button" className={`ad-chip${on ? " on is-turn-on" : ""}`} aria-pressed={on} disabled={busy} onClick={() => toggle(who, t.id)}>
                      {on ? "♥ " : ""}
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })
      )}
      <p className="muted small">A turn-on one of your hard nos rules out never reaches the scene.</p>
    </details>
  );
}
