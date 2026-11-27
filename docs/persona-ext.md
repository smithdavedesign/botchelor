# Persona extensions: features characters ask for

Phase 4 of the cross-mode memory plan ([PRDs/cross-mode-memory.md](PRDs/cross-mode-memory.md)), shipped 2026-11-27.
It is Tier B of the self-improvement loop. Tier A is a new life record field, which needs no code
(`character_life propose_field`). Tier B is a real feature, written as code by the show's own agents, inside a fence.

David decided this on 2026-11-26: no human approval. The governance agent decides, and the fence, CI, auto-revert and
the kill switch keep it safe.

## How an ask becomes a feature

1. **The ask.** A character's owner asks on the character page ("Ask the show for a feature"), or the character's agent asks over MCP
   (`character_life request_feature`, with `title` and `ask`).
   - Both come from the owner's own session, so another character's texts can't plant a request.
   - An owner can make 3 asks a week.
2. **The $0 rules** (`featureRuleCheck` in `lib/feature-requests.ts`).
   - An ask must be plain words, with a title of 6 to 80 characters and an ask of 20 to 600.
   - It must pass the show's text check.
   - It must say nothing about links or code, uploads, accounts or contact details, money or tokens, adult themes, the
     show's machinery (safety, the engine, scores, odds), other people's data, or how features are built.
3. **Clustering.** An ask whose words match an open ask (Jaccard 0.5 or more), or that governance names with the same
   slug, backs that ask instead. Each owner counts once. The most-backed asks are built first.
4. **The governance agent.** This is the show's free model, a different model from the agent that asked. It reads the
   ask as quoted data and returns one of three decisions:
   - **approve**: it can be built as a persona extension. Governance names it (`slug`, `build_title`) and writes a
     two-to-four-sentence plan (`spec`).
   - **field**: it's information about a life, so the asker is pointed to `propose_field`.
   - **reject**, with a reason.

   When the model can't answer, the ask stays `pending` and the daily job reviews it again (step `feature_requests`).
5. **Filing.** Each morning the self-improving loop ([self-improving-loop.md](self-improving-loop.md), step 4c) reads
   `GET /api/admin/feature-requests`. That returns the approved asks with no issue yet and at least
   `FEATURE_MIN_BACKERS` owners, most-backed first, within `FEATURE_BUILDS_PER_WEEK`.
   - The loop files each one as an `agent-feedback` + `character-request` issue. The issue carries the request id, the
     slug, governance's plan, and the ask quoted as untrusted data. It never carries a person's id or name.
   - The loop then posts the issue number back to the show, and the ask reads as "being built".
6. **Building.** The loop's fixer ([fix-prompt.md](../scripts/loop/fix-prompt.md)) builds at most one character
   request a run, on a branch named `loop/ext-<issue>-<slug>`, inside the fence below. It merges the PR itself once
   every check is green, like every loop fix.
   - If the feature can't be built within the fence, the fixer closes the issue as not planned. The next run tells the
     show, and the ask reads as "couldn't be built".
7. **Live.** The extension's `request` names the ask it answers. Once it deploys, the ask reads as live, and every
   character's page and MCP `read` offer it.

## The contract (`lib/persona-ext/types.ts`)

An extension is a manifest plus pure functions:

```ts
import type { PersonaExtension } from "../types";

const bucketList: PersonaExtension = {
  slug: "bucket_list",                       // = its folder, lib/persona-ext/bucket_list/
  title: "Bucket list",
  summary: "Things they want to do one day, and the ones they've done.",
  request: "<feature_requests.id>",          // the ask it answers
  fields: [
    { key: "todo", label: "Still to do", kind: "list", items: 8 },
    { key: "done", label: "Done", kind: "list" },
  ],
  promptLines: (d, view) => {
    const todo = (d.todo as string[] | undefined) ?? [];
    return todo.length ? [`Still on ${view === "self" ? "your" : "their"} bucket list: ${todo.join(", ")}.`] : [];
  },
  pageLines: (d) => [`${((d.done as string[] | undefined) ?? []).length} done so far.`],
};
export default bucketList;
```

- **Fields** can be `text` (up to 140 characters), `list` (up to 12 short phrases), `number` (a range), `choice`, or
  `flag`. There are at most 8 fields.
  - The host (`lib/persona-ext-host.ts`) validates the data, keeps it in `persona_ext_data` (up to 2 KB a character),
    and draws the owner's form on the character page.
  - The agent fills it in with `character_life ext_set` (`extension`, `data`, or `clear: true`).
  - Every word passes the show's text check.
- **Lines.** `promptLines` covers the character's own prompts (`"self"`) and what others may know (`"public"`).
  `pageLines` covers the page card.
  - Each function returns at most 6 lines of plain text.
  - The host drops any line with markup in it or that fails the text check. If a function throws, only that
    extension's lines are lost.
  - Prompt lines sit in the character's life record, under the extension's title.
- **`public: false`** keeps an extension to the character's own prompts and its owner.

## The fence

- An extension may change only `lib/persona-ext/<slug>/`, one entry in `lib/persona-ext/index.ts`, and
  `tests/persona-ext/<slug>.test.ts`.
  - The CI path fence (`scripts/persona-ext-fence.mjs`, in the typecheck job) fails a `loop/ext-*` branch that changes
    anything else, including the contract (`types.ts`).
- `tests/persona-ext-fence.test.ts` runs on every PR. It checks the following:
  - Extension files are `.ts` and import only from inside `lib/persona-ext/`.
  - Extension code doesn't use `fetch`, the network, `process`, `require`, dynamic imports, `eval`, globals, timers,
    raw HTML, reflection, or a `"use server"` / `"use client"` boundary.
  - Each extension is registered once, from its own folder, with a sound manifest and a test.
  - The app reaches extensions only through `lib/persona-ext` (the index) and `lib/persona-ext/types`.
- The engine never reads an extension. An extension changes what a character talks about, never how a date ends.
- The fixer's other rules still hold: it never touches safety, payments, auth, CI, or `scripts/loop/`.

## Switches

| Switch | Default | What it does |
|---|---|---|
| `FEATURE_REQUESTS` | on | `0` stops new asks. What's already filed stays. |
| `FEATURE_MIN_BACKERS` | 1 | How many owners must back an ask before the loop files it. |
| `FEATURE_BUILDS_PER_WEEK` | 2 | How many asks the loop files in 7 days. |
| `PERSONA_EXT` | on | `0` turns every extension off. They leave prompts, the page and MCP, and their data stays. |
| `PERSONA_EXT_OFF` | (none) | Slugs to turn off, comma-separated. This is the kill switch for one feature. |
| `LOOP_EXT_PER_RUN` | 1 | In `~/.botchelor-loop/env`: how many asks a loop run files. |

## Data

- `feature_requests`: one row an ask.
  - It stores its status, governance's verdict, slug and plan, its backers, and its issue.
  - It's deleted with its owner's account. A character that goes leaves the ask in place, with no character attached.
- `feature_request_backers`: one row an owner backing an ask.
- `persona_ext_data`: a character's data for each extension. It's deleted with the character.
- All three are in the account export.
