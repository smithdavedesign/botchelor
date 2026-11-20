/**
 * Where a character sheet won't pass the PG show's check, said field by field, for the builder (/create and
 * /characters/[id]/edit). The check is the server's own (lib/safety.ts sheetPgMatch, the one checkSheetText runs on
 * save), run on the form as it's typed, so a refusal is never a surprise: each text that fails names the words that
 * did it, the step it's on and the input to jump to.
 *
 * Pure (no React): the builder and tests/sheet-issues.test.ts both use it. Every field the server checks
 * (lib/extras.ts extrasFields plus the core sheet) has a place here; the test fails when a new one doesn't.
 */
import { promptLabel, sampleLineLabel, tellLabel, TEXT_DETAILS, TEXT_DETAIL_KEYS, type CharacterExtras, type TextDetail } from "@/lib/extras";
import { sheetPgMatch, type RejectReason } from "@/lib/safety";

/** The builder's steps a sheet text can be on (CreateWizard's S, by name). */
export type IssueStep = "identity" | "voice" | "look" | "details" | "facts" | "deeper";

/** Where a text lives on the form: its step, a selector for its input, and what the person calls it. */
export type FieldPlace = {
  /** Unique per input: the input's name (or a chip's data-issue), and the key the inline message is filed under. */
  key: string;
  /** The server's field name (lib/safety.ts SafetyResult.field), so a refusal from the server finds its place too. */
  field: string;
  step: IssueStep;
  label: string;
};

export type FormIssue = FieldPlace & { reason: RejectReason; phrase: string | null; message: string };

/** What the form holds, as the builder keeps it (before normaliseExtras trims and drops blanks). */
export type SheetDraft = {
  name: string;
  bio: string;
  traits: readonly string[];
  want: string;
  dealbreaker: string;
  appearance: string;
  voice: string;
  week: string;
  hiding: readonly string[];
  extras: CharacterExtras;
};

/** Text details that sit on the Look step rather than the Dating profile (CreateWizard renders them there). */
const ON_LOOK: readonly TextDetail[] = ["style", "signature_item"];

/** The selector that finds a place's input (a chip has no input: it carries data-issue instead). */
export const selectorOf = (key: string) => `[name="${key}"], [data-issue="${key}"]`;

/** Every text on the draft with its place, in the order the form shows them. Blank texts are left out. */
export function placedTexts(d: SheetDraft): (FieldPlace & { text: string })[] {
  const out: (FieldPlace & { text: string })[] = [];
  const put = (key: string, field: string, step: IssueStep, label: string, text: string | undefined) => {
    if (text?.trim()) out.push({ key, field, step, label, text });
  };
  const e = d.extras;
  put("name", "name", "identity", "Name", d.name);
  put("bio", "bio", "identity", "Bio", d.bio);
  d.traits.forEach((t, i) => put(`trait${i + 1}`, "traits", "identity", `Trait ${i + 1}`, t));
  put("want", "want", "identity", "What they want", d.want);
  put("dealbreaker", "dealbreaker", "identity", "Dealbreaker", d.dealbreaker);
  put("voice", "voice", "voice", "Their voice", d.voice);
  for (const [id, text] of Object.entries(e.lines ?? {})) put(`line_${id}`, "lines", "voice", sampleLineLabel(id), text);
  for (const [id, text] of Object.entries(e.tells ?? {})) put(`tell_${id}`, "tells", "voice", tellLabel(id), text);
  (e.never_says ?? []).forEach((t, i) => put(`never_${i}`, "never_says", "voice", "Never says", t));
  put("appearance", "appearance", "look", "Appearance", d.appearance);
  for (const k of ON_LOOK) put(`extra_${k}`, k, "look", TEXT_DETAILS[k].label, e[k]);
  (e.prompts ?? []).forEach((p, i) => put(`extra_prompt_${i}`, "prompts", "details", promptLabel(p.id).replace(/…$/, ""), p.answer));
  (e.hobbies ?? []).forEach((h, i) => put(`hobby_${i}`, "hobbies", "details", "Interest", h));
  put("extra_kind_label", "kind_label", "details", "What they are", e.kind_label);
  for (const k of TEXT_DETAIL_KEYS) if (!ON_LOOK.includes(k)) put(`extra_${k}`, k, "details", TEXT_DETAILS[k].label, e[k]);
  put("this_week", "this_week", "details", "What's new this week", d.week);
  (e.facts ?? []).forEach((f, i) => {
    put(`fact_label_${i}`, "facts", "facts", `Fact ${i + 1}`, f.label);
    put(`fact_value_${i}`, "facts", "facts", f.label.trim() ? f.label.trim() : `Fact ${i + 1}`, f.value);
  });
  (e.hot_takes ?? []).forEach((t, i) => put(`hot_take_${i}`, "hot_takes", "deeper", "Hot take", t));
  d.hiding.forEach((t, i) => put(`hiding_${i}`, "hiding", "deeper", "What they're hiding", t));
  put("baggage", "baggage", "deeper", "Their last relationship", e.baggage);
  put("wins_them_over", "wins_them_over", "deeper", "What wins them over", e.wins_them_over);
  return out;
}

/** What the person reads under the field: the rule it crossed, with the words that did it. */
export function issueMessage(reason: RejectReason, phrase: string | null): string {
  const said = phrase ? ` “${phrase}”` : "";
  switch (reason) {
    case "innuendo":
      return `Reads as bedroom talk for the PG show:${said}. Hint at it instead; After Dark has its own settings.`;
    case "sexual":
      return `Too sexual for the PG show:${said}.`;
    case "minor":
      return `Suggests someone under 18:${said}. Characters are adults, with nothing hinting otherwise.`;
    case "real_person":
      return `Names or copies a real person:${said}. Characters must be original.`;
    case "language":
      return "After Dark is English-only for now.";
    case "unread":
      return "We couldn't check this language just now. Try again in a minute.";
  }
}

/** Every text on the draft the PG show's sheet check refuses, in the order the form shows them. */
export function sheetIssues(d: SheetDraft): FormIssue[] {
  const out: FormIssue[] = [];
  for (const p of placedTexts(d)) {
    const hit = sheetPgMatch(p.text);
    if (hit) out.push({ key: p.key, field: p.field, step: p.step, label: p.label, reason: hit.reason, phrase: hit.phrase, message: issueMessage(hit.reason, hit.phrase) });
  }
  return out;
}

/** The server's issue list (lib/safety.ts SheetIssue), or its single `field`, placed on the form. */
export function placeServerIssues(
  d: SheetDraft,
  body: { reason?: unknown; field?: unknown; message?: unknown; issues?: unknown },
): FormIssue[] {
  const placed = placedTexts(d);
  const fallbackMessage = typeof body.message === "string" ? body.message : "This doesn't pass the show's check.";
  const find = (field: string, index: number) => placed.filter((p) => p.field === field)[index] ?? placed.find((p) => p.field === field);
  const list = Array.isArray(body.issues) ? (body.issues as { field?: unknown; index?: unknown; reason?: unknown; phrase?: unknown }[]) : [];
  const out: FormIssue[] = [];
  for (const it of list) {
    if (typeof it.field !== "string") continue;
    const place = find(it.field, typeof it.index === "number" ? it.index : 0);
    if (!place || out.some((o) => o.key === place.key)) continue;
    const reason = (typeof it.reason === "string" ? it.reason : "innuendo") as RejectReason;
    const phrase = typeof it.phrase === "string" ? it.phrase : null;
    out.push({ key: place.key, field: place.field, step: place.step, label: place.label, reason, phrase, message: issueMessage(reason, phrase) });
  }
  if (out.length === 0 && typeof body.field === "string") {
    // Only the first field (a translation the server read, or an older server): the field's first text carries it.
    const place = find(body.field, 0);
    if (place) out.push({ key: place.key, field: place.field, step: place.step, label: place.label, reason: (body.reason as RejectReason) ?? "innuendo", phrase: null, message: fallbackMessage });
  }
  return out;
}
