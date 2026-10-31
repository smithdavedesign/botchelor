"use client";

import { useId, useState } from "react";
import { shortName } from "@/lib/names";
import { DATE_ROLEPLAYS, dateRoleplayById, ROLEPLAY_PREMISE_MAX, ROLEPLAY_ROLE_MAX, ROLEPLAY_TAGS, ROLEPLAY_TITLE_MAX, type RoleplayTag } from "@/lib/roleplays";

/** What a picker chose: one of the show's roleplays, or one written for the date, and which role is the booker's. */
export type RoleplayChoice =
  | { roleplay_id: string; my_role: 0 | 1 }
  | { custom: { title: string; premise: string; roles?: [string, string] }; my_role: 0 | 1 };

/** The fields a booking or a proposal sends for a choice (POST /api/episodes, the couple's roleplay route). */
export function roleplayFields(c: RoleplayChoice | null, key: "roleplay" | "terms" = "roleplay"): Record<string, unknown> {
  if (!c) return {};
  if (key === "terms") return "roleplay_id" in c ? { roleplay_id: c.roleplay_id, my_role: c.my_role } : { custom: c.custom, my_role: c.my_role };
  return { roleplay: "roleplay_id" in c ? c.roleplay_id : c.custom, my_role: c.my_role };
}

/** A written roleplay is ready to send: a title, a premise of 20 characters or more, and both roles or neither. */
export function choiceReady(c: RoleplayChoice | null): boolean {
  if (!c) return false;
  if ("roleplay_id" in c) return true;
  const roles = c.custom.roles;
  return c.custom.title.trim().length > 0 && c.custom.premise.trim().length >= 20 && (!roles || (roles[0].trim().length > 0) === (roles[1].trim().length > 0));
}

const fill = (premise: string, a: string, b: string) => premise.replaceAll("{a}", a).replaceAll("{b}", b);

/**
 * The show's roleplays for a date (lib/roleplays.ts), by kind, plus one of your own: pick one, and who plays whom. A
 * roleplay is framing only: the characters play it as a game they share for the evening, and the engine decides the ending.
 */
export default function RoleplayPicker({ me, them, value, onChange }: { me: string; them: string | null; value: RoleplayChoice | null; onChange: (v: RoleplayChoice | null) => void }) {
  const id = useId();
  const [tag, setTag] = useState<RoleplayTag | "all">("all");
  const mine = shortName(me);
  const theirs = them ? shortName(them) : "your date";
  const custom = value && "custom" in value ? value.custom : null;
  const def = value && "roleplay_id" in value ? dateRoleplayById(value.roleplay_id) : null;
  const roles: readonly [string, string] | null = def ? def.roles : custom?.roles && custom.roles[0].trim() && custom.roles[1].trim() ? custom.roles : null;
  const myRole = value?.my_role ?? 0;
  // {a} is whoever plays the first role: the booker's character unless they took the second.
  const [a, b] = myRole === 0 ? [mine, theirs] : [theirs, mine];
  const shown = DATE_ROLEPLAYS.filter((r) => tag === "all" || r.tag === tag);
  const setCustom = (patch: Partial<{ title: string; premise: string; roles: [string, string] }>) =>
    onChange({ custom: { title: custom?.title ?? "", premise: custom?.premise ?? "", ...(custom?.roles ? { roles: custom.roles } : {}), ...patch }, my_role: myRole });

  return (
    <div className="rp-picker">
      <div className="rp-tags" role="group" aria-label="Kinds of roleplay">
        {[{ id: "all" as const, label: "All", icon: "✨" }, ...ROLEPLAY_TAGS].map((t) => (
          <button key={t.id} type="button" className="rp-tag" aria-pressed={tag === t.id} onClick={() => setTag(t.id)}>
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
      <ul className="rp-grid" aria-label="Roleplays">
        {shown.map((r) => {
          const on = def?.id === r.id;
          return (
            <li key={r.id}>
              <button type="button" className="rp-tile" aria-pressed={on} onClick={() => onChange(on ? null : { roleplay_id: r.id, my_role: myRole })}>
                <span className="rp-tile-title">
                  <span aria-hidden="true">{r.icon}</span> {r.title}
                </span>
                <span className="rp-tile-premise">{fill(r.premise, on ? a : mine, on ? b : theirs)}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" className="rp-tile rp-tile-own" aria-pressed={Boolean(custom)} onClick={() => (custom ? onChange(null) : setCustom({}))}>
            <span className="rp-tile-title">
              <span aria-hidden="true">✍️</span> One of your own
            </span>
            <span className="rp-tile-premise">Write who the two of them are to each other tonight. PG, and both adults.</span>
          </button>
        </li>
      </ul>

      {custom && (
        <fieldset className="rp-own">
          <legend>Your roleplay</legend>
          <label htmlFor={`${id}-title`}>Title</label>
          <input id={`${id}-title`} type="text" maxLength={ROLEPLAY_TITLE_MAX} value={custom.title} placeholder="The last lighthouse keepers" onChange={(e) => setCustom({ title: e.target.value })} />
          <label htmlFor={`${id}-premise`}>
            Premise <span className="muted small">(write {"{a}"} and {"{b}"} for the two of them)</span>
          </label>
          <textarea
            id={`${id}-premise`}
            rows={3}
            maxLength={ROLEPLAY_PREMISE_MAX}
            value={custom.premise}
            placeholder="{a} and {b} keep the last lighthouse on the coast, and tonight the ships have stopped coming."
            onChange={(e) => setCustom({ premise: e.target.value })}
          />
          <div className="rp-own-roles">
            <label>
              <span className="muted small">First role (optional)</span>
              <input type="text" maxLength={ROLEPLAY_ROLE_MAX} value={custom.roles?.[0] ?? ""} placeholder="the keeper" onChange={(e) => setCustom({ roles: [e.target.value, custom.roles?.[1] ?? ""] })} />
            </label>
            <label>
              <span className="muted small">Second role</span>
              <input type="text" maxLength={ROLEPLAY_ROLE_MAX} value={custom.roles?.[1] ?? ""} placeholder="the apprentice" onChange={(e) => setCustom({ roles: [custom.roles?.[0] ?? "", e.target.value] })} />
            </label>
          </div>
        </fieldset>
      )}

      {roles && value && (
        <fieldset className="rp-roles">
          <legend>Who plays whom?</legend>
          {([0, 1] as const).map((i) => (
            <label key={i} className="rp-role">
              <input type="radio" name={`${id}-role`} checked={myRole === i} onChange={() => onChange({ ...value, my_role: i })} />
              {mine} is {roles[i]}, {theirs} {roles[1 - i]}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
