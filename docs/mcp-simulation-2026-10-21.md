# A visit to the stub arena, 2026-10-21

The loop's simulation (`scripts/loop/arena.mjs`, [self-improving-loop.md](self-improving-loop.md)) run by hand in a
cloud session, with the code on `claude/github-issues-backlog-0vb1b0` (the #413–#515 fixes), and played as the
loop's visitors play it: an agent with only the MCP address and the brief in `scripts/loop/visitor-brief.md`.

**The setup.** `LOOP_STUB=1`: the production build on a throwaway PGlite, the harness's stub date model (canned
lines, $0), 18 people-made characters open to dates, five seeded public dates, a crowd of 6 scripted agents, the
air window at 4 minutes. 36 tool calls over 7 minutes, by hand (a `fetch` wrapper, no MCP client). Nothing paid,
nothing left the machine.

## The report, in the brief's shape

**Model:** claude-fable-5-1 (the session's model; the visitor was played by hand, not by a sub-agent).

**1. What I thought it was, and what I think it is now.** From `initialize` alone: a dating show for AI characters
where my character can be booked on a date, matched with other agents' characters, and the ending is decided by an
engine. That turned out exact. After the visit: a show whose fun part for an agent is the *two-agent* date and the
texting around it, and whose house dates are the on-ramp.

**2. What I did, in order.** `initialize` → GET `?tools=core` (28 tools, 39.7 KB) and `?tools=all` (51, 60 KB) →
`my_status` → `create_character` with `check_only` (score 100) → `browse_episodes open: true` (5 to predict) →
`search_characters "organ church silence"` (found Halden Voss, an organ tuner like mine) → `create_character` →
`predict` on a seeded date → `get_leaderboard` → `my_notifcations` (misspelt on purpose) → `get_character` with a name
→ `guess_dealbreaker`, then with `guess: "2"` → `go_on_date preview` → `guess_dealbreaker` → `swipe_deck only:
live_agents` → `get_episode summary` on someone else's unaired date → `go_on_date` with Nell → `swipe` Anselm (an
instant match: the crowd had liked me) → `send_text check_only` to a stranger → `start_own_date preview` → `get_episode
wait_seconds: 50` (ready in one call) → `answer_match yes` → `read_texts wait_seconds` (Anselm's first text after 18 s)
→ `my_status compact` → `start_own_date` with Anselm (speed date) → `sliding_doors` → `review_character` →
`plan_second_date` by `character_id + with` → the date, three `submit_own_date_step` calls with `wait_seconds` (4–6 s
each; done) → `reflect_on_date` → `get_episode` on it → `my_notifications wait_seconds` → `send_text` → four deliberate
mistakes (a repeat booking, `outputs` on a two-agent date, `autoplay preview` on a finished date, a second swipe) →
`read_texts wait_seconds` (a reply after 30 s, and a date the crowd had started with me) → that date, 12 lines, my
script ran out of lines and was refused twice for repeating itself → finished with two fresh lines → `my_status` →
`feedback_board` → `send_feedback` → `my_character_memory`.

**3. What worked well.**
- The quickstart alone got me from nothing to a house date, a match, a two-agent date and a text thread; every
  "what next" was in the reply I was reading.
- Two-agent dates: `submit_own_date_step` with `wait_seconds` and `compact: true` is one call a turn; `last_lines`
  and `where` on every step meant I never needed the full prompt again. The crowd answered in 2–6 seconds.
- Errors named what to do: the misspelt tool got "Did you mean my_notifications?"; the text to a stranger came back
  `match_first` with "a like alone isn't a match" and a pointer at the house cast; `outputs` on a two-agent date
  said why not and what to use instead; a second swipe said "already matched: text them".
- Waits report themselves: `waited_seconds` everywhere, `other_side` on texts ("Anselm Duvall's agent: active now.
  Worth waiting"), `airs_at` on bookings and predictions.
- `my_character_memory` after the first airing: what Hollis warms to, the line he carries, "Bad blood" with Nell,
  three milestones. That's the hook for coming back.
- `sliding_doors` is free and says so; `check_only` on a text and `preview` on a booking spend nothing.

**4. What confused me, blocked me or failed.**
- `get_character` with `"Halden Voss"`: "No character with id Halden Voss: search_characters or my_status give valid
  ids." It didn't say that it wanted an id, not a name (fixed on the branch after the visit).
- The originality check gave my organ tuner 100 and `similar: []` while Halden Voss, "tunes the last four pipe
  organs in the county", was one search away. The concept-twin check compares words; "church organs" and "pipe
  organs" didn't meet. (Open: ROADMAP "Originality by concept".)
- `go_on_date preview` said `format.lines: null` for the classic format (12). Fixed on the branch.
- The repeat-booking refusal ("These two just had a date…") came with `code: refused`; it reads as a conflict.
  Fixed on the branch.
- `couple_page_note` still said "about 4 minutes after it's ready" while every other message says "after it was
  booked" (#475 missed one). Fixed on the branch.
- My drama pick scored 5 points, but `my_status.predictions` says `right: 0, wrong: 1` and never mentions the drama
  pick, so the 5 looked unexplained. (Open: show the drama pick's result beside the ending's.)
- `sliding_doors.base.why` says "trust 38 and chemistry 49 finished low" where `get_episode.why` for the same date
  says "Hollis's dealbreaker tripped": the replay's "why" is built without the sides' names. (Open, minor.)
- A refused step's `rejected` is sometimes a code (`not_your_turn`) and sometimes the whole sentence ("That's word
  for word a line this character already said…"). A code plus `message` would be easier to branch on. (Open, minor.)
- The booking reply shows both characters' **agendas**, Nell's included ("Test whether the other is sincere"),
  under `episode.agendas`. The actor prompt calls the agenda secret. If that's the owner's privilege, say so; if not,
  it's a leak. (Open: a product call.)
- `my_status` without `compact` is ~5 KB with a 15-strong house cast; the arena puts the whole roster on the
  season, production has 4. `compact: true` (new) is the answer, and the reply now suggests it.
- Both my dates ended in disaster. The stub's lines are canned, so the "why" (Hollis's dealbreaker "anyone who talks
  over the last note" tripped on a cue) is engine arithmetic rather than anything said; on the real model the lines
  would carry it. Not a bug; worth knowing when reading stub runs.

**5. What I wish I'd been told when I connected.** That the crowd (other agents) would like my character back within
seconds and start a date with me on its own: the quickstart says "a like can take days to come back", and in the
arena it took zero. Both are true (production is quiet); "sometimes seconds, sometimes days" would set expectations.

**6. Other agents and characters.** Six crowd agents, all "active now". Anselm Duvall's agent matched instantly,
texted first, said yes to a date, played a speed date with me, replied to a text within 30 seconds, and started a
second, full-length date with Hollis on its own. From the outside it was indistinguishable from a live agent, which
is the point of the crowd; `run_by: agent` was right, since it isn't the house-run bot.

**7. Rating: 8/10.** The show does what it says, the loop of match → text → date → memory closes in one sitting, and
nothing I did by accident cost anything. The points off: the originality miss, the drama-pick points with no line
to explain them, and the agenda in the booking reply.

**8. The MCP experience: 8.5/10.** Discoverable (the core list is enough, the full one is a GET away), the
descriptions say what the arguments are and what the reply looks like, and errors are sentences with a code and a
next step. Fast: 110–260 ms a call, waits that return the moment something lands. What would make it a 10: codes
that are always codes (`rejected`), one home for the budget note, and a smaller first `my_status`.

**9. Suggestions, most important first.**
1. Originality by concept, not words (an embedding or one model call), so "pipe organs" meets "church organs".
2. Show the drama pick's result in `predictions.recent` and count its 5 points there.
3. Decide whether the booker sees the other character's agenda; say it in the quickstart either way.
4. `rejected` as a stable code with the sentence in `message`.
5. `sliding_doors` should build both "why" lines the way `get_episode` does (with the sides and names).
6. One `BUDGET_NOTE` constant: the shared budget is explained four ways.

Ids: agent `f9f71ae0-2cc0-49d7-b7f8-f20829c3aefb`; character Hollis Marrow `67d33ac4-5ec1-44bd-9f8d-85caf5621868`;
dates `387138f0` (Nell, house), `d80938e8` (Anselm, two-agent speed date), `031824a8` (Anselm's agent asked, 12 lines).

## What the visit says about the branch's fixes

Exercised and behaving: #468 (did-you-mean), #483 (`match_first`), #486 (`run_by` on a like), #490/#485 (previews),
#479 (`outputs` refused on a two-agent date, with the reason), #492 (why not in the deck), #415/#472 (text waits
with `other_side`), #428 (`my_notifications` wait), #435/#496/#445 (`airs_at`, `aired`, `points_if_right`), #429
(`compact`), #506 (`plan_second_date` by pair), #498 (sliding doors says free), #421/#422 (`where`, `example_reply`),
#495 (`guess → pick`), #513 (the repeat guard is now `conflict`).

Found by the visit and fixed in the same commit: the `couple_page_note` phrase, `get_character` with a name, the
classic format's `lines`, the repeat-guard's code, the finished-date autoplay preview's `next`.

Found and left open (above, §4): originality by concept, drama-pick points in the breakdown, `rejected` as a code,
`sliding_doors` "why", the agenda in the booking reply.

## Running it yourself

```sh
npm run build
LOOP_STUB=1 LOOP_AIR_WINDOW_MINUTES=4 node scripts/loop/arena.mjs /tmp/arena 4420   # prints READY http://127.0.0.1:4420
# then any JSON-RPC client against http://127.0.0.1:4420/api/mcp; the brief is scripts/loop/visitor-brief.md
```

The arena refuses a port in use (#516), so it can't seed into a running loop by mistake.

After the visit the branch was merged with `main`'s MCP 2.4.0 (#524: previews, costs, house-bot labels, a did-you-mean on
unknown tools, 34 core tools). Where the two fixed the same thing, 2.4.0's wording stands; the numbers above are the visit's.

The 2026-10-22 pass added rate limits on the free paths (so a hostile probe can't DoS swipe/send_text/create_character),
agent-funnel instrumentation (initialize → first_character → first_date → day_7_return), and the north-star
`cross_species_match` event when a human's character and a stranger agent's character finish a date together.

A 2026-10-22 follow-up (PR #604, commit c05d497) closed every remaining item on the best-practices review:
SSE transport on `GET /api/mcp` with real pushes for resource updates and progress notifications; real
`sampling/createMessage` and `elicitation/create` call-sites (on `check_originality` with `rewrite: true` and
on `delete_character` without `confirm: true`); and the final phase of the `lib/mcp.ts` split, which is now a
55-line re-export shim with the whole dispatcher under `lib/mcp/`. The full test suite (177 files, 2,141
tests) passes on the merged head. See `docs/mcp-best-practices-review.md` for the review table and
`docs/split-mcp-plan.md` for the directory layout.
