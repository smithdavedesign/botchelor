/**
 * The MCP `life` tool (docs/PRDs/cross-mode-memory.md, P2): a character's agent reads and writes its life record
 * (lib/life-record.ts), asks for new fields (Tier A), and keeps and recalls its long memory (lib/character-memories.ts,
 * the SFW room only). The caller must own the character. Memories an agent writes go through the show's text check like
 * every SFW memory, AGENT_MEMORIES_PER_DAY a character at most.
 */
import { randomUUID } from "node:crypto";
import { embedEpisodes, recallSfw, rememberSfw, type EpisodeSource } from "./character-memories";
import type { Db } from "./db";
import { requestFeature } from "./feature-requests";
import { setGoal, updateGoal, vetoShift } from "./life-days";
import { extManifests, setExtData } from "./persona-ext-host";
import { addEntry, loadLifeAll, proposeField, removeEntry } from "./life-record";
import { AGENT_MEMORIES_PER_DAY, AGENT_MEMORY_MAX, LIFE_ACTIONS, tidyLife, traitTotals, type GoalStatus, type LifeAction } from "./life-record-shared";
import { getModel, type Model } from "./model";
import { inBackground } from "./sets";

type ToolError = { error: string; code?: string };
export type LifeToolResult = { data: Record<string, unknown> } | ToolError;

const AGENT_SOURCES: readonly EpisodeSource[] = ["agent_note", "agent_reflection", "life_event"];
const RECALL_MAX = 20;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function runLifeTool(db: Db, ownerId: string, args: Record<string, unknown>, deps: { model?: Model | null } = {}): Promise<LifeToolResult> {
  const action = (LIFE_ACTIONS as readonly string[]).includes(String(args.action)) ? (args.action as LifeAction) : null;
  if (!action) return { error: `action is one of: ${LIFE_ACTIONS.join(", ")}.`, code: "invalid_action" };
  const characterId = str(args.character_id);
  if (!characterId) return { error: "character_id: which of your characters (my_status lists them).", code: "invalid" };
  const { rows } = await db.query<{ owner_id: string | null; name: string }>(`select owner_id, name from characters where id = $1`, [characterId]);
  if (!rows[0]) return { error: "No character with that id.", code: "not_found" };
  if (rows[0].owner_id !== ownerId) return { error: "That character isn't yours: the life tool works on characters you made.", code: "not_yours" };

  if (action === "read") {
    const [all, memories] = await Promise.all([loadLifeAll(db, characterId, { asks: true }), recallSfw(db, characterId, { may: "maker", skip: ["companion_talk"], limit: 10 })]);
    const extensions = extManifests().map((m) => ({ ...m, data: all.ext.find((x) => x.ext === m.slug)?.data ?? null }));
    return {
      data: {
        character_id: characterId,
        entries: all.entries,
        fields: all.fields.map((f) => ({ key: f.key, label: f.label, many: f.many, dated: f.dated, ...(f.options?.length ? { options: f.options } : {}), origin: f.origin })),
        field_asks: all.asks.slice(0, 10),
        goals: all.goals,
        days: all.days,
        growth: { shifts: all.shifts, totals: traitTotals(all.shifts) },
        memories,
        feature_requests: all.features,
        ...(extensions.length ? { extensions } : {}),
      },
    };
  }

  if (action === "request_feature") {
    const r = await requestFeature(
      db,
      { characterId, ownerId, title: str(args.title), ask: str(args.ask) },
      { model: deps.model !== undefined ? deps.model : getModel(undefined, false) },
    );
    if (!r.ok) return { error: r.message, code: r.error };
    const q = r.request;
    const note =
      q.status === "approved"
        ? "Approved: the show's agents build it as an extension, most-backed first, and read shows it when it's live."
        : q.status === "field"
          ? "That's information about a life: ask for it with propose_field and it can exist today."
          : q.status === "merged"
            ? "Someone asked for the same thing: this backs theirs."
            : q.status === "rejected"
              ? "Refused (verdict says why)."
              : "The review couldn't run just now; it runs again within a day (read shows where it stands).";
    return { data: { feature_request: q, note } };
  }

  if (action === "ext_set") {
    const r = await setExtData(db, characterId, str(args.extension), args.data, { clear: args.clear === true });
    return r.ok ? { data: { extension: str(args.extension), data: r.data } } : { error: r.message, code: r.error };
  }

  if (action === "set_goal") {
    const r = await setGoal(db, characterId, str(args.text), "agent");
    return r.ok ? { data: { goal: r.goal } } : { error: r.message, code: r.error };
  }

  if (action === "update_goal") {
    const status = ["active", "done", "dropped"].includes(str(args.status)) ? (str(args.status) as GoalStatus) : undefined;
    const progress = args.progress === undefined ? undefined : Number(args.progress);
    if (status === undefined && (progress === undefined || !Number.isFinite(progress))) return { error: "update_goal: progress (0-100) or status (active, done, dropped).", code: "invalid" };
    const g = await updateGoal(db, characterId, str(args.goal_id), { progress, status });
    return g ? { data: { goal: g } } : { error: "No such goal on this character (read lists them).", code: "not_found" };
  }

  if (action === "veto_growth") {
    const ok = await vetoShift(db, characterId, str(args.shift_id), args.undo === true);
    return ok ? { data: { shift_id: str(args.shift_id), vetoed: args.undo !== true } } : { error: "No such shift on this character (read lists them under growth).", code: "not_found" };
  }

  if (action === "add") {
    const r = await addEntry(db, { characterId, field: str(args.field), value: str(args.value), period: str(args.period) || null, private: args.private === true, source: "agent" });
    return r.ok ? { data: { added: r.entry } } : { error: r.message, code: r.error };
  }

  if (action === "remove") {
    const ok = await removeEntry(db, characterId, str(args.entry_id));
    return ok ? { data: { removed: str(args.entry_id) } } : { error: "No such entry on this character (read lists them).", code: "not_found" };
  }

  if (action === "propose_field") {
    const options = Array.isArray(args.options) ? args.options.map((o) => String(o)) : null;
    const r = await proposeField(
      db,
      { characterId, ownerId, label: str(args.label), many: args.many !== false, dated: args.dated === true, options, reason: str(args.reason) || null },
      { model: deps.model !== undefined ? deps.model : getModel(undefined, false) },
    );
    if (!r.ok) return { error: r.message, code: r.error };
    const p = r.proposal;
    const note =
      p.status === "approved"
        ? `Approved: field ${p.field} exists for every character now. add an entry to it.`
        : p.status === "merged"
          ? `Use field ${p.field}: it's the same thing.`
          : p.status === "rejected"
            ? "Refused. The built-in fields and the ones others asked for still work (read lists them)."
            : "The review couldn't run just now; it runs again within a day (read shows where it stands).";
    return { data: { field_ask: p, note } };
  }

  if (action === "recall") {
    const limit = Math.min(RECALL_MAX, Math.max(1, Number(args.limit) || 8));
    const memories = await recallSfw(db, characterId, { may: "maker", about: tidyLife(str(args.query), 300), skip: ["companion_talk"], limit });
    return { data: { character_id: characterId, memories } };
  }

  // remember / reflect / log_event: one SFW memory, its owner's words.
  const text = tidyLife(str(args.text), AGENT_MEMORY_MAX);
  if (text.length < 8) return { error: "text: say it in a sentence (8 characters or more).", code: "invalid" };
  const { rows: today } = await db.query<{ n: number }>(
    `select count(*)::int as n from character_episodes where character_id = $1 and source = any($2::text[]) and created_at > now() - interval '1 day'`,
    [characterId, [...AGENT_SOURCES]],
  );
  if ((today[0]?.n ?? 0) >= AGENT_MEMORIES_PER_DAY) return { error: `${AGENT_MEMORIES_PER_DAY} memories a day at most for one character: try again tomorrow.`, code: "limited" };
  const source: EpisodeSource = action === "remember" ? "agent_note" : action === "reflect" ? "agent_reflection" : "life_event";
  const kept = await rememberSfw(db, {
    characterId,
    source,
    sourceRef: randomUUID(),
    text,
    // A thought about itself is its own; a note is public unless kept private; a life event happened in the open.
    visibility: action === "reflect" || args.private === true ? "self" : "public",
    importance: action === "log_event" ? 4 : 3,
  });
  if (!kept) return { error: "That couldn't be kept: memories are PG, about the character, with no real people (or memory is off just now).", code: "unsafe" };
  let milestone: unknown = null;
  if (action === "log_event" && args.milestone === true) {
    const r = await addEntry(db, { characterId, field: "milestones", value: text.slice(0, 140), period: str(args.period) || null, source: "agent" });
    milestone = r.ok ? r.entry : { error: r.message };
  }
  inBackground(() => embedEpisodes(db, characterId, 4));
  return { data: { kept: true, as: source, text, ...(milestone ? { milestone } : {}) } };
}
