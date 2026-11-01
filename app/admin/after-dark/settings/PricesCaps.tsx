"use client";

import type { ReactNode } from "react";
import type { AdultSettings } from "@/lib/adult/settings";
import type { StudioConfig } from "@/lib/adult/studio-config";
import { USAGE_KINDS, type UsageKind } from "@/lib/adult/usage";
import { FieldNote, blurOnEnter, useSettings } from "./autosave";

const CAP_LABEL: Record<UsageKind, string> = {
  writes: "Scene steps",
  pictures: "Scene pictures",
  clips: "Clips",
  voice_lines: "Voiced lines",
  monologues: "Two sides of a night",
  studio: "Studio pictures (our models)",
  studio_byok: "Studio pictures (their own key)",
  upscales: "Upscales",
  moments: "Moments from clips",
  captions: "Captions written",
};

type Price = Exclude<keyof StudioConfig["prices"], "shoot" | "pair">;

/**
 * One number in the grid: saved when it's left, if it changed. Keyed on the saved value, so a change saved elsewhere
 * (the Studio's JSON) shows here too. `max` is the old field's own.
 */
function NumberCell({
  id,
  field,
  label,
  hint,
  value,
  min = 0,
  max,
  onSave,
}: {
  id?: string;
  field: string;
  label: ReactNode;
  hint?: ReactNode;
  value: number;
  min?: number;
  max?: number;
  onSave: (n: number) => void;
}) {
  const num = (v: string) => Math.max(min, Math.floor(Number(v) || 0));
  return (
    <label htmlFor={id}>
      <span>
        {label} <FieldNote field={field} />
      </span>
      <input key={value} id={id} type="number" min={min} max={max} defaultValue={value} onBlur={(e) => num(e.target.value) !== value && onSave(num(e.target.value))} onKeyDown={blurOnEnter} />
      {hint && <small className="muted ad-hint">{hint}</small>}
    </label>
  );
}

/**
 * Prices & caps (2026-10-31 UX audit, E3: token prices lived in three places, and the monthly caps inside the Studio's
 * card): every token price, what a chapter or a subscriber gets without paying, and every monthly cap, each saved on
 * its own when it's left (./autosave.tsx).
 */
export default function PricesCaps() {
  const { base, save } = useSettings();
  const top = (k: keyof AdultSettings) => (n: number) => void save(k, { [k]: n });
  const studio = base.studio;
  const price = (k: Price) => ({ value: studio.prices[k], onSave: (n: number) => void save(`studio.prices.${k}`, { studio: { prices: { [k]: n } } }) });
  const studioPrices: [string, string, { value: number; onSave: (n: number) => void }][] = [
    ["shoot.standard", "Shoot, standard", { value: studio.prices.shoot.standard, onSave: (n) => void save("studio.prices.shoot.standard", { studio: { prices: { shoot: { ...base.studio.prices.shoot, standard: n } } } }) }],
    ["shoot.pro", "Shoot, pro", { value: studio.prices.shoot.pro, onSave: (n) => void save("studio.prices.shoot.pro", { studio: { prices: { shoot: { ...base.studio.prices.shoot, pro: n } } } }) }],
    ["restyle", "Restyle", price("restyle")],
    ["recast", "Recast", price("recast")],
    ["body", "Body reference", price("body")],
    ["variations", "More like this", price("variations")],
    ["upscale", "Upscale", price("upscale")],
    ["identity", "Identity pack", price("identity")],
    ["pg.identity_price", "PG Studio identity pack", { value: studio.pg.identity_price, onSave: (n) => void save("studio.pg.identity_price", { studio: { pg: { identity_price: n } } }) }],
    ["carousel", "Carousel", price("carousel")],
    ["sfw_twin", "SFW twin", price("sfw_twin")],
    ["pg.carousel_price", "PG Studio carousel", { value: studio.pg.carousel_price, onSave: (n) => void save("studio.pg.carousel_price", { studio: { pg: { carousel_price: n } } }) }],
    ["animate_5", "Animate 5 s", price("animate_5")],
    ["animate_10", "Animate 10 s", price("animate_10")],
    ["own_key", "On their own key", price("own_key")],
  ];
  const STUDIO_HINT: Record<string, string> = {
    identity: "8 views; fewer cost their share.",
    carousel: "6 angles of a picture.",
    sfw_twin: "A picture made safe for work.",
  };

  return (
    <section className="card after-dark-settings" style={{ gridTemplateColumns: "minmax(0, 1fr)" }} aria-label="Prices and caps">
      <p className="muted small">Prices are in bought tokens (5 for $4); admins don&apos;t pay and are never capped.</p>
      <h3>Nights and clips</h3>
      <div className="ad-settings-grid">
        <NumberCell id="ad-chapter-tokens" field="chapter_tokens" label="A chapter" hint="Up to 120 lines, taken when it starts; included for a subscriber (#1005)." value={base.chapter_tokens} max={100} onSave={top("chapter_tokens")} />
        <NumberCell id="ad-reel-tokens" field="reel_tokens" label="Video of the night" value={base.reel_tokens} max={500} onSave={top("reel_tokens")} />
        <NumberCell id="ad-clip-tokens" field="clip_tokens" label="A clip on demand" hint="One shot, from the act menu or the latest moment." value={base.clip_tokens} max={100} onSave={top("clip_tokens")} />
        <NumberCell
          id="ad-menu-picture-tokens"
          field="menu_picture_tokens"
          label="A picture from the shot menu"
          hint="The two of them, as composed; it counts against the month's pictures too."
          value={base.menu_picture_tokens}
          max={100}
          onSave={top("menu_picture_tokens")}
        />
        <NumberCell id="ad-draw-ahead-tokens" field="draw_ahead_tokens" label="Draw ahead, a chapter" value={base.draw_ahead_tokens} max={20} onSave={top("draw_ahead_tokens")} />
        <NumberCell
          id="ad-included-clips"
          field="included_clips"
          label="Clips included a month"
          hint="A subscriber's, at no tokens; each after that costs a clip's price."
          value={base.included_clips}
          max={50}
          onSave={top("included_clips")}
        />
        <NumberCell
          id="ad-pictures-per-chapter"
          field="pictures_per_chapter"
          label="Pictures a chapter draws"
          hint="Without being asked: its own, a new place's, ones its lines ask for, its moments at the close."
          value={base.pictures_per_chapter}
          max={10}
          onSave={top("pictures_per_chapter")}
        />
        <NumberCell
          id="ad-draw-ahead-pictures"
          field="draw_ahead_pictures"
          label="Extra pictures drawn ahead"
          hint="A chapter drawn ahead may draw these on top of its own, at about 3¢ each."
          value={base.draw_ahead_pictures}
          max={10}
          onSave={top("draw_ahead_pictures")}
        />
      </div>
      <h3>Studio</h3>
      <p className="muted small">A shoot makes {studio.shoot_size} pictures (set under Studio).</p>
      <div className="ad-settings-grid">
        {studioPrices.map(([k, label, p]) => (
          <NumberCell key={k} field={`studio.prices.${k}`} label={label} hint={STUDIO_HINT[k]} value={p.value} max={100} onSave={p.onSave} />
        ))}
      </div>
      <h3>Monthly caps, per person</h3>
      <p className="muted small">What each person can make a month. The tokens protect the margin; these protect the checker and storage.</p>
      <div className="ad-settings-grid">
        {USAGE_KINDS.map((k) => (
          <NumberCell
            key={k}
            field={`caps.${k}`}
            label={CAP_LABEL[k]}
            hint={k === "moments" ? "Stills, boomerangs, loops." : undefined}
            value={base.caps[k]}
            onSave={(n) => void save(`caps.${k}`, { caps: { [k]: n } })}
          />
        ))}
      </div>
    </section>
  );
}
