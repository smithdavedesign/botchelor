/**
 * After Dark's providers at a glance, for the admin (app/admin/after-dark/providers, docs/PRDs/connections.md): one card
 * per house provider, the same card the Connections page uses. After Dark runs on the house's keys only (nobody's own key
 * reaches it, lib/adult/settings.ts), so this is read-only: each key's last four, what it does, whether it's the one in
 * use, and its live status from adult_media_cooldowns (Hive over its daily limit, lib/adult/hive-limit.ts; Venice or
 * Replicate cooling down after a 429 or a 402, lib/adult/fallback.ts), with when each last made something. Reads only.
 */
import type { Db } from "../db";
import { HOUSE_PROVIDER_INFO, HOUSE_PROVIDERS, type HouseProvider } from "../connections-shared";
import { getAdultSettings } from "./settings";

/** A card's state: ready to use, paused or cooling down right now, no key saved, or saved but not what's set to run. */
export type HouseState = "ready" | "paused" | "no_key" | "standby";

export type HouseCard = {
  provider: HouseProvider;
  label: string;
  what: string;
  state: HouseState;
  pill: string;
  /** In plain words: "Daily limit reached: back around 17:00 UTC". */
  status: string;
  /** When a pause or cooldown ends (the page shows it in the viewer's own time). */
  until: string | null;
  last4: string | null;
  /** The model it runs, where one is set here. */
  model: string | null;
  /** When it last made something (a step, a picture, a video): null when we can't tell. */
  last_used_at: string | null;
};

type Cooldown = { provider: string; until: string | Date; status: number | null };

/** "17:00 UTC": the time a pause ends, as the server says it (the page rewrites it in local time). */
const utc = (iso: string): string => `${new Date(iso).toISOString().slice(11, 16)} UTC`;

/** Why a provider is cooling down, in plain words, from the status that started it, and who covers for it meanwhile. */
function cooling(status: number | null, until: string, covered: string | null): string {
  const why = status === 402 ? "Out of credit" : status === 429 ? "Rate limited" : "Limited";
  return `${why}: skipped until ${utc(until)}${covered ? `; ${covered} makes its jobs meanwhile` : "; nothing else can make its jobs meanwhile"}`;
}

/** When each provider last made something, from what After Dark kept (best effort: nulls if a table can't be read). */
async function lastMade(db: Db): Promise<Partial<Record<HouseProvider, string>>> {
  const out: Partial<Record<HouseProvider, string>> = {};
  const max = async (sql: string): Promise<{ provider: string | null; at: Date | string | null }[]> =>
    (await db.query<{ provider: string | null; at: Date | string | null }>(sql).catch(() => ({ rows: [] }))).rows;
  const media = [
    ...(await max(`select provider, max(created_at) as at from adult_images where provider is not null group by provider`)),
    ...(await max(`select provider, max(created_at) as at from adult_reels where provider is not null group by provider`)),
  ];
  for (const r of media) {
    if (!r.at || !r.provider || !(HOUSE_PROVIDERS as readonly string[]).includes(r.provider)) continue;
    const at = new Date(r.at).toISOString();
    const p = r.provider as HouseProvider;
    if (!out[p] || out[p]! < at) out[p] = at;
  }
  const step = (await max(`select null as provider, max(created_at) as at from adult_steps where status = 'ok'`))[0]?.at;
  if (step) out.openrouter = new Date(step).toISOString();
  // Every picture kept passed Hive first (lib/adult/check.ts): the newest one is when Hive last said yes.
  const picture = (await max(`select null as provider, max(created_at) as at from adult_images where status = 'ready'`))[0]?.at;
  if (picture) out.hive = new Date(picture).toISOString();
  return out;
}

/** Every house provider's card, in HOUSE_PROVIDERS order. */
export async function houseProviderStatus(db: Db, now: number = Date.now()): Promise<HouseCard[]> {
  const s = await getAdultSettings(db);
  const rows = (await db.query<Cooldown>(`select provider, until, status from adult_media_cooldowns`).catch(() => ({ rows: [] as Cooldown[] }))).rows;
  const pause = new Map(rows.map((r) => [r.provider, { until: new Date(r.until).toISOString(), status: r.status, active: new Date(r.until).getTime() > now }]));
  const made = await lastMade(db);
  const keyOf: Record<HouseProvider, string | null> = {
    openrouter: s.openrouter_last4,
    venice: s.venice_last4,
    replicate: s.replicate_last4 ?? (s.replicate_from_env ? "env" : null),
    fal: s.fal_last4,
    hive: s.hive_last4,
  };
  const modelOf: Record<HouseProvider, string | null> = {
    openrouter: s.text_model,
    venice: s.venice_image_model,
    replicate: s.replicate_picture_model,
    fal: s.image_model,
    hive: null,
  };
  // What's set to run: the text writer, the media provider (the other is the fallback), fal when pictures are set to it.
  const inUse: Record<HouseProvider, boolean> = {
    openrouter: true,
    venice: s.media_provider === "venice" || s.image_provider === "venice",
    replicate: s.media_provider === "replicate",
    fal: s.image_provider === "fal",
    hive: true,
  };
  // Who makes Venice's or Replicate's jobs while it cools down: the other, with fallback on and a key (lib/adult/fallback.ts).
  const coverFor = (p: HouseProvider): string | null => {
    const other = p === "venice" ? "replicate" : p === "replicate" ? "venice" : null;
    return other && s.media_fallback && keyOf[other] && !pause.get(other)?.active ? HOUSE_PROVIDER_INFO[other].label : null;
  };
  /** What a provider that's set to run is doing, in a line. */
  const doing: Record<HouseProvider, string> = {
    openrouter: "Writing every scene",
    venice: coverFor("venice") ? `In use, with ${coverFor("venice")} as the fallback` : "In use",
    replicate: coverFor("replicate") ? `In use, with ${coverFor("replicate")} as the fallback` : "In use",
    fal: "In use for pictures",
    hive: "Checking every picture and video before it's kept",
  };
  return HOUSE_PROVIDERS.map((provider) => {
    const info = HOUSE_PROVIDER_INFO[provider];
    const key = keyOf[provider];
    const p = pause.get(provider);
    const base = { provider, label: info.label, what: info.what, last4: key === "env" ? null : key, model: modelOf[provider], last_used_at: made[provider] ?? null };
    if (!key) return { ...base, state: "no_key" as const, pill: "No key", status: provider === "hive" ? "No key saved: pictures and videos stay off" : "No key saved", until: null };
    if (p?.active) {
      const status = provider === "hive" ? `Daily limit reached: back around ${utc(p.until)}` : cooling(p.status, p.until, coverFor(provider));
      return { ...base, state: "paused" as const, pill: provider === "hive" ? "Paused" : "Cooling down", status, until: p.until };
    }
    const ended = provider === "hive" && p && !p.active ? `The daily-limit pause ended at ${utc(p.until)}; the next picture asks Hive first` : null;
    const keyLine = key === "env" ? "Using the server's REPLICATE_API_TOKEN" : null;
    if (!inUse[provider]) {
      return { ...base, state: "standby" as const, pill: "Standby", status: provider === "replicate" || provider === "venice" ? "Ready as the fallback" : "Saved, not set to run", until: null };
    }
    return { ...base, state: "ready" as const, pill: "✓ Ready", status: ended ?? keyLine ?? doing[provider], until: null };
  });
}
