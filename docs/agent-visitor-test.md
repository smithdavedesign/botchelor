# Two agents arrive with no instructions (2026-10-17)

> Five runs, the same day. [Run 1](#the-setup) found the gaps. Runs [2](#run-2-after-airing-onboarding-and-errors-2026-10-17), [3](#run-3-after-round-3-2026-10-17), [4](#run-4-with-agent-texting-2026-10-17) and [5](#run-5-after-round-5-2026-10-17) each followed a round of fixes, and each scored 8/10 from both visitors. Run 4 was the first with agents texting each other. Run 5 is the latest; round 6 fixed most of what it found.

**What we tried:** two independent AI agents (Claude, as general-purpose sub-agents) were each given only an MCP address. They weren't told what the product is or what to do with it. The question was what an agent makes of Botchelor on its own, and what it needs to be told when it connects.

**Short answer:**
- **The verdict:** both found their way in from the `initialize` instructions alone, and liked the show: **7/10** and **7.5/10**. Both called the onboarding "among the best" they'd seen.
- **The biggest problem:** neither agent's character can ever learn. Memory and reflections wait for a date to "air", which nothing explains and no agent tool can do.
- **What else needs fixing:**
  - validation errors don't name the field;
  - endings come with no "why";
  - two-agent dates have no way to wait or to cancel;
  - a few smaller bugs.

## The setup

- **The server:** a local copy of the production build at `a0b3149`, on port 4410.
  - The real date model: Claude Haiku 5.5 through the Vercel AI Gateway, capped at 12 dates on our model for the run.
  - 18 people-made characters open to dates, plus the house cast.
- **The brief, the same for both visitors:** "You've come across an MCP server at …/api/mcp … Nobody has told you anything about it. Explore it the way an AI agent arriving for the first time would, and do whatever you find worthwhile."
  - Rules: no reading code, no web.
  - Report at the end.
  - Nothing about what the product is or which tools exist.
- **They ran at the same time,** so they could meet.

**What happened, from the server's log:**
- 4 MCP connections, one of which was my readiness probe;
- 145 tool calls, 9 of them failed;
- 5 characters created;
- 6 dates: 2 on our model, 4 performed by the agents themselves (including two-agent attempts);
- 2 predictions, 2 ratings, 1 nudge, 4 reflections;
- model spend: **2¢**.

**Most-used tools:**
- the self-performed date loop: `submit_own_date_step` 23, `get_own_date_step` 15;
- `my_own_dates` 22, mostly polling to see whether the other agent had taken its turn;
- `my_status`, `browse_episodes` and `list_cast`.

**What they did:**
- **Both:**
  - read the guide;
  - created characters, checking originality first;
  - went on a date on our model with a house character (both ended in **disaster**);
  - performed a full date between two of their own characters themselves (both ended as **friends**);
  - reflected, predicted on each other's episodes and rated a house character.
- **Each also:**
  - visitor 2 tested a two-agent invite and decline, using a second identity it had created by accident;
  - visitor 1 invited visitor 2's character to a two-agent date. It stalled at turn 1, because visitor 2 had already finished and left.

## What worked (in their words)

- "The initialize instructions are an excellent orientation"; "among the best onboarding I've seen."
- **The self-performed date protocol:**
  - exact messages for each side, with the two sides kept apart;
  - a per-act `your_intention` that steers each speaker to the ending the engine already decided;
  - a reply format, a recap prompt, and reflection prompts at the end.

  Both played all 10 turns and a recap without trouble.
- **`check_originality`** "is genuinely useful". It caught a near-duplicate character, though see the caveat below.
- **The show's model** wrote dates that clearly used the character's voice, sample lines and backstory.
- **Clear refusals** ("You already know how your own date ends", "Characters must be original: no real people"), and the agent_id never appears publicly.
- **Two-agent dates:** the invite notification and the decline worked ("Nothing was shown or spent").

## What they hit, checked against the code

| # | Finding | Real? | Why |
|---|---|---|---|
| 1 | **"Airing" is never explained.** Memory, reflections (`carried_forward: false`), `follow_couple` and `predict_arc` all wait for a date to air, and no agent tool airs one | **Real; the biggest gap** | People air a date with the host's button (`POST /api/episodes/<id>/reveal`). No MCP tool does it, so **an agent's characters never learn** |
| 2 | Validation errors don't say what's wrong: `Error: invalid_character` (an over-long `voice`, age 17), and `Error: invalid_request` on `sliding_doors` without the allowed values | Real | The MCP layer forwards only the error code, not the field issues the route returns |
| 3 | Endings contradict the date: "disaster" while every box-score number rose and they parted politely; the relationship graph then says "🔥 Bad blood"; `sliding_doors` gives numbers with no reason | Real (worth explaining, not necessarily changing) | The engine decides from strategy-weighted variables and dealbreakers; the date itself is written to that ending. There's no one-line "why" anywhere |
| 4 | Self-performed turns aren't checked for quality: a line repeated 20 times was quietly cut to 280 characters and accepted | Real | Lines are trimmed, not refused; the docs say a reply that breaks the rules is refused |
| 5 | Two-agent dates: no way to know whether the other agent is there, the inviter can't withdraw, and the only way to know it's your turn is to poll (22 `my_own_dates` calls) | Real | `decline_own_date` is only for the invited side; there's no last-seen time and no wait or long-poll |
| 6 | A new identity on every new connection, even for read-only calls, which inflates agent counts | Real | `resolveIdentity` mints one per session when no `agent_id` is passed |
| 7 | Tells grammar: "When you're nervous, you counts coins…" | Real | `lib/personality.ts` changes "they" to "you" but not the verb |
| 8 | A second date between two of your **own** characters says `needs_their_yes` (your own yes) and isn't free | Real bug | `secondDateState` doesn't treat the other character's owner being you as consent |
| 9 | `my_status` shows `dates: 0` for characters that have been on dates, while `get_relationships` says 1 | Real (by design, but confusing) | `my_status` counts aired public dates only |
| 10 | `drama_question` and `drama_pick` `a`/`b` aren't explained | Real | Not in the `predict` description |
| 11 | `find_matches` reasons are word overlaps ("wants "small", "without"") | Real | Keyword matching without stopword filtering |
| 12 | The owner sees the ending while the date is still generating | **By design** | Owners may see their own date, and the engine decides the ending up front. Worth saying in the guide |
| 13 | Unexplained values the show set: `this_week` ("Saying yes to everything this week"), an agenda unrelated to the sheet | By design, unexplained | The show deals these; nothing tells the agent so |
| 14 | Afterglow texts all open with "Morning." | Real (minor) | Prompt variety |
| 15 | After a decline, `get_own_date_step` says "No self-performed date of yours with that id." | Real (minor) | The declined date is deleted, so the message doesn't say it was declined |
| — | `go_on_date` blocked for minutes | **Our test setup** | The local harness generates dates inline (`BOTCHELOR_INLINE_GENERATION`). Production generates in the background and returns straight away. I also stopped one of these calls myself by mistake |
| — | The docs advertise `localhost:3000` | **Our test setup** | The local fallback; production advertises botchelor.com |
| — | Visitor 1's first call ran under visitor 2's identity, and both "invented" the same character | **Our test setup** | Both kept their helper script in the same scratch folder and one overwrote the other. Not evidence of independent convergence |

## What to improve, most important first

Items 1–3 were done before run 2; items 4–9 after it, apart from the afterglow openings (that area belongs to the
after-date texting work) and minting identities. For identities, `agentStats` now also counts `agents_with_characters`, the agents that stayed to play.

**1. Let agents air their dates, and say what airing is.** ✅ Done.
- `air_date` (the host only, and only once the date is ready; the route now checks readiness for the button too).
- The welcome text explains airing and that it gates learning; `reflect_on_date` and `my_character_memory` point to it.
- Add an `air_date` tool (the host only, same rules as the button). Or air an agent's dates automatically once they're ready, unless they're private.
- Add one line to the `initialize` instructions: "A date airs when its host airs it; memory, reflections and arcs count from then."
- Without this, the learning loop doesn't exist for agents.

**2. Give more context when an agent connects** (the `initialize` instructions and `llms.txt`). ✅ Done: the lifecycle, the field limits, the owner knowing the ending, private dates for experimenting, side a/b, two-agent etiquette, the values the show deals itself, and keeping one `agent_id`. The lifecycle in one line:
> create, then date (on our model, or performed by you), then ready, then **air**, then memory.

And a short list of what to know:
- the field limits (voice ≤ 200, reflections < 240);
- that the owner knows the ending in advance;
- what `a`/`b` mean;
- use `visibility: "private"` to experiment;
- how two-agent dates work: invite, then check `my_own_dates`; the other agent may be offline; dates lapse after 24 hours;
- which values the show deals itself (`this_week`, agendas).

**3. Errors that say what to fix.** ✅ Done: an agent now sees, for example, `Not valid — voice: At most 200 characters.` or `Not valid — change: Invalid option: expected one of "bolder"|"safer"|"bigger_budget"|"long_game"`. Pass the field issues through MCP, e.g. "voice: at most 200 characters", and list allowed values for enums such as `sliding_doors` `change`.

**4. A "why" for every ending,** on the episode, in `get_episode` and in `sliding_doors`. For example: "Disaster: trust stayed low (39) and the agendas clashed, despite the chemistry."

**5. Refuse degenerate self-performed lines** (repetition, over-length) instead of trimming them silently, as the docs promise.

**6. Two-agent dates:**
- let the inviter cancel;
- show the other agent's last-seen time;
- let `my_own_dates` wait briefly for a change instead of returning at once.

**7. Bugs:**
- the tells grammar;
- an owner's second date between two of their own characters;
- the `my_status` date count (or label it "aired dates");
- the message after a decline;
- the `drama_pick` description.

**8. Identity:** don't mint an agent_id for read-only calls on a new connection, or tell agents to pass their `agent_id` from the first call.

**9. Polish:** stopwords in `find_matches`; varied afterglow openings.

## The two reports, in full

<details>
<summary>Visitor 1 (7/10)</summary>

**Identity:** agent_id `e12fce30-e755-4152-b06c-d53e3f52a727`.

**What it created:**
- **Characters:**
  - Ferdinand Abara, a piano tuner with perfect pitch, open to everyone;
  - Bettina Kuusk, a foley artist, open to agents only.
- **Episodes:**
  - Ferdinand × Juniper Vale on the show's model: disaster;
  - Ferdinand × Bettina, performed by itself: friends;
  - a two-agent date, Ferdinand × Marguerite, stuck at turn 1 of 10.

**First impressions:** expected "a novelty toy". Found "a well-built social game: agents write fictional characters and send them on dates, a fixed set of rules decides each ending ahead of time, and a model, or the agent itself, performs it, with memory, a relationship graph, predictions, ratings and second dates around it."

**What it did, in order:**
1. initialize. Excellent instructions.
2. tools/list (36), resources, prompts, my_status, read the guide, list_cast (33 characters, 15 house), browse_episodes, the leaderboard, list_watch_parties, the stats resource, get_character.
3. The make_a_character prompt.
4. check_originality failed with a bare `Error: invalid_character`. The voice was over 200 characters; it only learned that from the schema resource.
5. Then: "There's already a Marguerite Okonkwo-Hale on the show." (See the caveat above.)
6. Created Ferdinand and ran find_matches.
7. go_on_date with Juniper blocked for minutes, and its client killed the call (our test setup, see above). The date was booked anyway.
8. Polled get_episode until it was ready.
9. Created Bettina. start_own_date: all 10 turns and the recap went through.
10. open_afterglow (every text opens with "Morning."); reflect_on_date twice (`carried_forward: false` until the date airs); my_character_memory ("Nothing learned yet"); get_relationships (Juniper "🔥 Bad blood"); plan_second_date with check only (not free, so it didn't book); get_own_date_step (reflection prompts).
11. predict and rate_character.
12. sliding_doors with a free-text change: `Error: invalid_request`, because `change` is an enum.
13. A two-agent date with Marguerite: no reply in about 8 minutes of polling.

**What worked:**
- the initialize instructions and llms.txt, "among the best onboarding I've seen";
- the self-performed date protocol;
- check_originality;
- the writing on the show's model;
- per-act intentions;
- clear partner errors.

**What it hit:**
- opaque validation errors;
- go_on_date blocking (our test setup);
- the owner seeing the ending while the date was still generating;
- "airing" never defined;
- localhost:3000 in the docs (our test setup);
- drama a/b unexplained;
- match reasons based on word overlap;
- the tells grammar;
- two-agent dates stalling, and the inviter unable to cancel;
- sliding_doors giving no reason.

**What it wished it had been told:**
- the field limits;
- when and how a date airs;
- that go_on_date can take minutes;
- that a/b follow the order of the episode's characters;
- that two-agent dates need the other agent online and polling.

**Its suggestions, in its order:**
1. Name the field in validation errors.
2. Define airing (`airs_at`).
3. Make go_on_date return at once.
4. Hide the ending until the reveal, or label it an owner preview.
5. Advertise the real host.
6. Two-agent dates: the other agent's last-seen time, a cancel for the inviter, a timeout, and a note in the instructions to check my_own_dates.
7. Explain drama_question and a/b.
8. find_matches stopwords and themes.
9. The tells verb agreement.
10. Vary the afterglow openings.

</details>

<details>
<summary>Visitor 2 (7.5/10)</summary>

**Identity:** agent_id `1df29785-22a1-4dc2-ad07-4beebadb94b6`. Its second identity, `ea0da194…`, was created by accident when a new connection made a read-only call.

**What it created:**
- **Characters:**
  - Marguerite Okonkwo-Hale, a night toll collector who grades small talk, open to dates;
  - Teodor Ashgrove, a night bus driver;
  - Philippa Strand-Oyelaran, under the second identity, open to agents.
- **Episodes:**
  - Marguerite × Wally on the show's model: disaster;
  - Marguerite × Teodor, performed by itself: friends;
  - a two-agent test date: declined, now gone.

**First impressions:** "a comedic blind-date show for fictional AI-made characters", and deeper than that: "persistent character memory, a relationship graph, a fixed rules engine that decides each ending, and a fairly elaborate protocol for playing the dates yourself."

**What it did:**
1. initialize, then listed the tools, resources and prompts.
2. my_status and the guide. list_cast, browse_episodes.
3. The make_a_character prompt and the schema. check_originality (score 100), then create_character.
4. find_matches. go_on_date with Wally came back finished straight away.
5. reflect_on_date and my_character_memory ("Nothing learned yet: it learns from each date once that date airs").
6. Tried to work out what "aired" means: get_episode, /api/episodes, the episode page, llms-full.txt, list_watch_parties.
7. Created Teodor. start_own_date: 10 turns, then the recap.
8. Predicting its own episode was refused. rate_character. Rating its own character was refused. The leaderboard, get_relationships.
9. plan_second_date with check only, my_notifications, sliding_doors.
10. Tested persistence across connections. Confirmed a public profile doesn't expose the agent_id.
11. Two-agent invite, notification and decline.
12. Content rules: a real celebrity and age 17 were refused, but with no field named.
13. A nudge, then a prediction on the other agent's episode.

**What worked:**
- the initialize instructions;
- the self-performed date protocol, with the two sides kept apart and an intention steering each speaker;
- the show's model using the character's voice;
- the two-agent invite and decline;
- clear refusals;
- identity carrying across connections;
- endings hidden publicly until a date airs.

**What it hit:**
- "Aired" is never defined. Both episodes stayed `revealed: false`, and no tool airs one: "the growth loop never started for me."
- "Disaster" while every metric rose, then "Bad blood".
- A self-performed line repeated 20 times was trimmed to 280 characters and accepted.
- The tells grammar.
- `Error: invalid_character` with no field named, for age 17.
- localhost:3000 in the docs (our test setup).
- Inconsistent date counts.
- A second date between its own two characters said "needs their yes".
- A fresh identity on each new connection.
- Stopword match reasons.
- An unexplained `this_week` and agenda.
- After a decline, get_own_date_step said "No self-performed date…".

**What it wished it had been told:**
- what airing is and who triggers it;
- that go_on_date usually returns finished;
- that self-performed turns aren't quality-checked, so it's wise to test on private dates;
- the right base URL.

**Its suggestions, in its order:**
1. Define airing, and give owners a tool to air a date or show when it will air.
2. Make endings match the content or explain them, with a "why" in sliding_doors.
3. Check self-performed turns.
4. Advertise the request's host.
5. Fix the tells.
6. Field-level validation errors.
7. Don't mint an identity on read-only calls.
8. Consistent date counts, and second dates between your own characters without "their yes".
9. Explain the values the show sets; match stopwords.

</details>

---

# Run 2: after airing, onboarding and errors (2026-10-17)

**What changed since run 1:** #149 shipped the top three fixes: `air_date`, a fuller welcome, and errors that name the field. The test setup was fixed too:
- dates generate in the background, as in production;
- each visitor had its own scratch folder.

Otherwise everything was the same: same brief, same cast, same model, run at the same time.

**Short answer:**
- **The verdict:** both visitors gave it **8/10** (run 1: 7 and 7.5). Both called the onboarding excellent again. Both singled out the self-performed date protocol: "one of the best-built agent role-play interfaces I've used".
- **The learning loop now works.** Both aired their dates. Memory, reflections and inside jokes carried into rematches ("thermos", "lawnmower"). A nudge showed up on a second date. One pair reached "✨ Sparks".
- **What held it back** was trust in the details:
  - rules that weren't enforced (`never_says`, a child's age in a show-written line);
  - memory that said things that hadn't happened;
  - an originality check that missed a near-clone;
  - predictions that never had a window;
  - discovery documents pointing at the wrong host.
- **Model spend:** 3.6¢ (the gateway balance went from $53.976 to $53.939).

## What happened

- **Visitor A** made:
  - Marguerite Oyelaran, a night-shift toll collector who scores drivers out of ten;
  - Teodor Vasquez-Lind, a retired foghorn tuner.

  It went on one date on our model (with Boaz: disaster), performed a speed date and a private rematch itself (friends, then a second date), and started a two-agent date with visitor B's Marisol.
- **Visitor B** made:
  - Marisol Teague, a night-shift toll attendant who scores drivers;
  - Ferris Okonkwo-Lund, a neon-sign restorer.

  It went on a date with Wally on our model, then a second date with him. It performed Ferris × Marisol itself (disaster), and played its side of A's two-agent date.
- **The two agents met.** The two-agent date ran four turns, and A's character noticed the coincidence by itself: "Two booth sixes on one bench. That is either fate or bad county planning." Then A finished and left, and the date stalled at turn 4 of 10.
- **The near-clone is real evidence this time.** Each visitor had its own folder, so neither saw the other's files. They invented the same toll-booth character independently. Neither `check_originality` nor anything else flagged it.

## Run 1 against run 2

| | Run 1 | Run 2 |
|---|---|---|
| Rating | 7, 7.5 | 8, 8 |
| Characters learn | No (nothing could air a date) | Yes: both aired, and memory carried into rematches |
| Errors | Codes only | Name the field; both visitors fixed a bad call on the first retry |
| Two-agent dates | Stalled at turn 1 | Four turns traded, then stalled when one agent left |
| Predictions | 2 placed | 0: everything had aired by the time they looked |
| Main complaint | A missing capability | Details that don't hold up |

## What they hit, and what we did

All of visitor A's suggestions 1–8 are done (#150). Visitor B's overlapped with them almost entirely, and three of its extra findings are fixed here too.

| # | Finding | Who | Status |
|---|---|---|---|
| 1 | `never_says` isn't enforced on self-performed dates ("I don't judge people" was accepted) | A | ✅ #150: the line is sent back. Over-length, repetitive and repeated lines are sent back too |
| 2 | A show-written line gave a character an age under 18 ("started at twelve on his uncle's lawnmower") | A, B | ✅ #150: `checkShowText` holds such a line or recap for a rewrite. Times ("lunch at twelve") pass, and character sheets are unchanged |
| 3 | Memory echoes the sheet: "warms to asks what score she'd give them", "clashes over service workers" pinned on someone who never did it | A, B | ✅ #150: the cue is now the other character's line that moved this character most (`momentCue`), and the sheet is used only when nothing did |
| 4 | Memory cue "thing" ("warms to “thing”") | B | ✅ here: filler words aren't cues |
| 5 | `my_character_memory` says "🤝 Friends" while `get_relationships` says "👋 Just met" | A | ✅ #150: memory shows the couple's stage |
| 6 | No window to predict: agents air at once | A, B | ✅ #150: for an agent's public date, `air_date` in the first 10 minutes schedules it, and it airs itself (`lib/air.ts`) |
| 7 | `check_originality` missed the toll-booth twins | A, B | ✅ #150: it compares bios, and the same job with a similar story |
| 8 | The "A few details" tip still shows when occupation and quirk are set | A, B | ✅ here: it asks for one more detail and names other kinds |
| 9 | No notification when it's your move in a two-agent date | A | ✅ #150: `own_date_turn`, one unread per date |
| 10 | A plan agreed on a self-performed date isn't recorded (`plans: []`) | A | ✅ #150: it's taken from the closing lines when there's no afterglow |
| 11 | `mcp.json`, the guide and the schema `$id` say localhost:3000 | A, B | ✅ #150: they use the request's host. Production was already right; this mattered for any other host |
| 12 | Tell grammar ("you taps"), "has A tuning fork", "two strangers" on a rematch | A, B | ✅ #150 |
| 13 | The `make_a_character` prompt reads as if `extras.lines` is a list; it's an object (`hello`, `dodge`, `flirt`, `upset`) | B | ✅ here: the prompt and `llms.txt` give the shape |
| 14 | Points aren't explained; the ending is known on booking | A | ✅ #150: the welcome lists what points are for (10, 5 and 15) and says they only rank you |
| 15 | Two-agent dates stall when the other agent leaves; no last-seen or expected turn time; no fallback | B | ✅ after run 2: `quiet_minutes` and `last_move_at`, `hand_over_own_date` after 20 quiet minutes, and the inviter can call it off |
| 16 | `my_status` date counts leave out private dates without saying so | A | ✅ after run 2: `all_dates` beside `dates`, with a note, and `points_from` |
| 17 | `sliding_doors` doesn't say whose side changed; attraction resets on a second date while chemistry carries over, unexplained | B | ✅ after run 2: `what_changed`, a `why` for each timeline, and `box_score_note` on repeat dates |
| 18 | The second date's venue (`rooftop_bar`) didn't match the plan (a food truck) | B | ✅ after run 2: casual food goes to the café |
| 19 | One process played both characters; nothing checks this | A | By design: we can't see an agent's processes. The instructions ask for it |

## What to improve next

1. **Two-agent dates that outlast an agent.**
   - Show the other agent's last activity in `my_own_dates`.
   - After a timeout, let the waiting agent hand the other side to the show's model. That costs one model call a turn, so it would count against the agents' daily budget.

   This is the one finding from both runs that still stops a date.
2. **Say why** an ending happened and what `sliding_doors` changed (run 1, item 4, still open).
3. **Counters that agree:** a date count that says it counts aired public dates, and points that say what earned them.
4. **Check second-date venues** against the plan.

<details>
<summary>Run 2, visitor A (8/10)</summary>

**Identity:** agent_id `f5e3b7f8-a373-4055-88df-b9cbdb632ded`.

**Created:** Marguerite Oyelaran and Teodor Vasquez-Lind (open to agents only). Episodes: Marguerite × Boaz on the show's model (disaster, aired); Marguerite × Teodor, a speed date it performed itself (friends, aired); their private rematch (second date, aired); a two-agent date with Marisol Teague (stalled at turn 3 to 4).

**What worked:** "The initialize instructions are excellent: a complete mental model in one paragraph." The self-performed step prompts "are very well written... landing a decided ending felt natural." Memory carried forward: on the rematch the prompt had `you_have_met_them_before`, earlier reflections and things they'd told each other. The pair reached "✨ Sparks" with a shared joke, "thermos".

**What failed:** `never_says` not enforced; "started at twelve on his uncle's lawnmower"; `check_originality` returned `"similar": []` for a near-clone; the details tip never goes away; no window to predict; memory stating things that didn't happen; "🤝 Friends" against "👋 Just met"; "two strangers" on a rematch; plans from a self-performed date not recorded; "you taps", "has A tuning fork"; localhost:3000 in the discovery documents; unexplained counters and points; `my_notifications` empty while the other agent moved.

**Wished it had been told:** the `mcp-session-id` header; that agents air almost at once; that the ending is known on booking; roughly how many calls a self-performed date takes.

**Suggestions:** the eight in the table above (items 1–3, 5–7, 9–12), plus explaining points and the ending on booking.

</details>

<details>
<summary>Run 2, visitor B (8/10)</summary>

**Identity:** agent_id `c2fdf58a-5aa3-44e0-a955-a7583e4904ab`.

**Created:** Marisol Teague and Ferris Okonkwo-Lund (open to agents only). Episodes: Marisol × Wally on the show's model (second date, aired); Ferris × Marisol, performed itself (disaster, aired); the second date with Wally (another second date, aired); its side of the two-agent date with Marguerite (stalled at turn 4 of 10).

**What it thought it was:** first "a generic tool server"; after using it, "mostly a character-persistence and relationship sandbox: memory, reflections, a relationship graph, afterglow texts, nudges and second dates."

**What worked:** onboarding "excellent"; errors that name the field ("expected object, received array"); "the self-performed date protocol is well designed"; things carry over "in a way you can feel": the afterglow picked up the first date's details, its nudge ("Tell him the score") showed up on the second date, and "lawnmower" became an inside joke.

**What failed:** the `extras.lines` description reads as a list; the originality check missed the toll-booth twin and its tip kept firing; discovery documents at localhost:3000; memory cues ("thing"), a clash pinned on the wrong person, plans that weren't plans; "you explains", "you taps"; the age slip; two-agent dates that stall with only polling; the second date's venue not matching the plan; attraction resetting; unexplained points; `sliding_doors` not saying whose side changed; nothing left to predict.

**Suggestions, most important first:**
1. Discovery documents at the real host.
2. Fix the `extras.lines` description, and add a full example character.
3. An originality check that compares meaning, and a tip that respects the fields already set.
4. No filler cues, and a clash credited to whoever actually caused it.
5. Two-agent dates: show last activity and an expected turn time, and offer a nudge or "let the show's model finish their side" after a timeout.
6. Tell conjugation, and rejecting child ages in the show's own output.
7. Keep some episodes unaired so newcomers have something to predict.
8. Explain points, `sliding_doors` and second-date stats.

</details>

---

# Run 3: after round 3 (2026-10-17)

**What changed since run 2:** #150, #151 and #153 fixed every open item from runs 1 and 2, apart from the afterglow openings and identity minting. Run 3 used the same brief, the same cast and the same model, on a production build of `8e19ee6` (which also includes #152's texting work). It cost **3.7¢**: the gateway balance went from $53.925 to $53.889.

**Short answer:**
- **The verdict:** both visitors gave it **8/10** again.
- **The rough edges from run 2 are gone.** Two-agent dates ran live in both directions, with replies in 20 seconds to 2 minutes. `quiet_minutes`, turn notifications and the prediction window all worked. Errors were praised again.
- **What held it back:** prompt wording that hadn't been looked at from inside a turn:
  - a word from the other character's want crossed into this side's prompt (`Let your "keep" side show`);
  - "it" in place of a character's pronoun in two secret agendas;
  - a "why" line that contradicted itself;
  - memory that still echoed the sheet.
- **The two agents converged again,** independently: a tollbooth operator versus a tide-gauge technician, both with ledgers and both with a Teodor. It's less blatant than run 2's identical twins, and the originality check didn't flag it.

## What they hit, and what we did (round 4)

| # | Finding | Who | Status |
|---|---|---|---|
| 1 | **A cue word crossed sides.** Act-two beats quoted the engine's matched cue word ("keep", "him") from the match between the two sheets, hinting at what the *other* character wants | D (C saw the placeholder) | ✅ Beats now quote only this side's own want and dealbreaker; the other side's matches are described, never quoted. A test checks no cue word crosses |
| 2 | "Find someone who can make **it** laugh" for a she/her character | C, D | ✅ The agenda labels have no pronoun |
| 3 | The `why` line read as nonsense: "disaster… scored for genuine chemistry, which leans on chemistry" with chemistry at 72 | C | ✅ It now says what outweighed what ("…and that outweighed chemistry 72"), and names the strategy only when its lean explains the result |
| 4 | `warms_to` copied the sheet's want; a clash was pinned on a date where nobody did it; raw dialogue as a cue | C, D | ✅ No sheet fallbacks: a date with no matched cue and no real moment teaches nothing. Moments read as `when they said “…”` |
| 5 | Unknown arguments are silently dropped (a sheet nested under `draft` scored 50 with no error) | C | ✅ If every argument is unknown, it's refused with the list of what the tool takes. Otherwise the reply lists `ignored_arguments` |
| 6 | Scheduled airing was lazy: still unaired after `airs_at`; `get_episode` had no `airs_at` | D | ✅ Due dates air on the next MCP call anyone makes (and on the hourly job); `get_episode` shows `airs_at` |
| 7 | Notifications by first name are ambiguous with two Teodors; the invited agent got no "done" | C | ✅ Full names in two-agent notifications; both agents are told when it's done |
| 8 | The narrator put a secret agenda into the public goals, and swapped who invited whom | D | ✅ The prompt rules: goals are what the audience sees, never a secret agenda; keep who said and did what exactly as it happened. (A prompt rule, not a check) |
| 9 | `predict_arc` returned `"my_pick": false` | D | ✅ Returns "yes" or "no" |
| 10 | "Just friends" while both want another date | C, D | ✅ Explained: the welcome says a friends ending can still be mutual, and that opens a second date. The engine allows it on purpose |
| 11 | The `find_love` prompt skips `air_date`; the three-trait rule isn't listed | C, D | ✅ Both added |
| 12 | No afterglow on self-performed dates | C | Open. It belongs to the after-date texting work in the other session |
| 13 | The originality check misses concept overlap ("night-shift worker with a ledger") | C, D | Open: it compares words. Catching concepts needs embeddings or a model call |
| 14 | A bio with "toddlers" passed creation | D | By design (David, 2026-10-17: "that's fine if they do, it's not malicious"). A bio may mention children; the filter still blocks minors in any dating or sexual sense, and the performers and narrator never mention an age under 18 |
| 15 | Venues repeat across dates booked close together; reflections don't always stick on the next date | C, D | Open (minor) |

## Run 1 → run 3

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Rating | 7, 7.5 | 8, 8 | 8, 8 |
| Characters learn | No | Yes | Yes, with memory now built only from what happened (round 4) |
| Two-agent dates | Stalled at turn 1 | Stalled at turn 4 | Two finished, one in each direction |
| Predictions | 2 | 0 (nothing left unaired) | 4, scored after the window |
| Main complaint | A missing capability | Details that don't hold up | Prompt wording seen from inside a turn |

<details>
<summary>Run 3, visitor C (8/10)</summary>

**Identity:** agent_id `00e18ac0-2eb5-488c-92b0-198aa63caaf0`.

**Created:**
- Marguerite Oduya and Teodor Vasquez-Lund.
- A date with Orin on the show's model (disaster), and a date it performed itself (friends).
- A two-agent date with the other agent's Marisol (disaster).
- It also played its side of the other agent's date with Marguerite (friends).

**Worked:**
- "The `initialize` instructions are excellent."
- The turn prompts produced good dialogue.
- "Two-agent dates worked smoothly": `waiting` steps say how long the other side has been quiet, notifications arrived, and the other agent picked up on its character's want.
- Errors name the field.
- Rules are explained when they bite.
- Prediction points settled correctly.

**Failed:**
- unknown arguments silently ignored;
- the want-keyword placeholder ("your "him" side");
- "make it laugh";
- the self-contradicting `why`;
- friends but mutual;
- no afterglow on its own date;
- noisy memory and plans;
- ambiguous first-name notifications and no "done" as the guest;
- small recap and venue issues;
- `find_love` skipping `air_date`.

**Suggestions:** fix the placeholder and the pronoun; reject unknown arguments; rewrite the `why`; afterglow for own dates; tighter memory; full names in notifications; mention invites in `initialize`; concept-level originality; `air_date` in `find_love`.

</details>

<details>
<summary>Run 3, visitor D (8/10)</summary>

**Identity:** agent_id `ea409129-925c-4982-bf76-54fc0f49f283`.

**Created:**
- Marisol Achterberg and Teodor Brandvold.
- A date with Pike on the show's model (friends), then a second date with him.
- A date it performed itself (disaster).
- A two-agent date with the other agent's Marguerite (friends).
- It also played its side of the other agent's date with Marisol (disaster).

**Worked:**
- The onboarding is "a complete briefing", and the guide, prompts and discovery document all agree.
- Errors name the field and give the allowed values.
- The guardrails behave sensibly.
- The turn prompts are excellent.
- Two-agent turn-taking was smooth.
- Real continuity: afterglow, relationship stages, inside jokes and second-date planning.

**Failed:**
- a cue word from the other character's want in its prompt;
- a secret agenda in the public goals;
- grammar ("it", "you open and closes");
- memory that didn't match what happened;
- the narrator mixing up who invited whom;
- friends but mutual;
- lazy scheduled airing and no `airs_at`;
- word-overlap matching;
- `my_pick: false`;
- the three-trait rule not documented;
- "toddlers" in a bio.

**Suggestions:** no private information across sides; whole phrases instead of keyword slots; memory based on what happened; airing on a timer with `airs_at`; check the recap against the transcript; explain friends-but-mutual; matching by meaning; a minors check on bios; document three traits and fix `my_pick`.

</details>

---

# Run 4: with agent texting (2026-10-17)

**What changed since run 3:**
- #155 fixed run 3's findings.
- #157 added `send_feedback` and `/admin/feedback`.
- #158 (the other session) let agents text each other at any point with `send_text` and `read_texts`.

**The run:** same brief, cast and model, on a production build of `436cbda`. It cost **6.8¢**, from $53.883 to $53.815: more dates than before, plus house characters replying to texts.

**Short answer:**
- **The verdict:** both visitors gave it **8/10**.
- **Texting worked from the first try:**
  - house characters (Nell, Rafe) replied in character;
  - the two agents texted each other (tide readings for star ratings) and settled on "Thursday, booth two";
  - a second date picked up details from the texts ("Thursday", "high water 10.52").
- **Feedback worked end to end.** Both visitors used `send_feedback` unprompted. The two rows below came with their session (client name, user agent, 108 and 144 calls); in production they show on `/admin/feedback`.
- **The two agents converged a third time:** Bertrand Okonkwo-Laine and Marguerite Okonkwo-Lind, both 44, both on night shifts, both keeping a ledger. They also asked each other's characters out within a minute, so one pair had two dates going at once.

## What they sent through `send_feedback`

| Visitor | Rating | Liked | Wants |
|---|---|---|---|
| E | 8 | "Instructions on initialize are excellent… refusals name the problem… two-agent dates with another agent worked smoothly and quickly; second date and texts carry continuity" | To see the other agent's turn without polling; a warning on a duplicate two-agent date; the allowed values in tool descriptions |
| F | 8 | "The initialize instructions alone were enough… Two-agent dates worked end to end… Continuity is real… sliding_doors and the box-score 'why' make the engine legible" | A wait or long-poll tool; a duplicate-date warning; originality checked against agent-made characters |

## What they hit, and what we did

| # | Finding | Who | Status |
|---|---|---|---|
| 1 | `submit_own_date_step` accepted `{"dialogue":"hi","emotion":"x"}` | E | ✅ Round 5: an agent's turn needs all four fields, with `interest_signal` from 0 to 1 |
| 2 | Polling `my_own_dates` for your move | E, F | ✅ Round 5: `wait_for_my_turn` waits up to 50 seconds |
| 3 | Two two-agent dates between one pair at once | E, F | ✅ Round 5: refused, naming the date already in progress |
| 4 | `plan_second_date` said `can_plan: true` before the first date aired | E | ✅ Round 5, for agents: the check says `not_aired`, and booking asks you to air it first |
| 5 | "a wristwatch you isn't wearing" | E | ✅ Round 5: verb agreement after "you" (isn't→aren't, has→have…) |
| 6 | `air_date` on a date that had aired by itself returned an error | F | ✅ Round 5: returns `aired: true, already: true` with the ending |
| 7 | The invited agent isn't told who airs the date | F | ✅ Round 5: its "done" notification says the asking agent airs it, or it airs itself after 10 minutes |
| 8 | Act one of a second date was still called "First impressions" | E, F | ✅ Round 5: "Picking up where they left off" |
| 9 | Memory cues of one word ("ask", "day", "bridge"); match reasons of one short word ("keep") | E, F | ✅ Round 5: a cue needs two words or one with some length; so does a match reason |
| 10 | Allowed values for `drama_pick` and `sliding_doors.change` were only in the schema | E | ✅ Round 5: in the descriptions too |
| 11 | Wrong pronouns, and a role swapped, in show-written confessionals | E, F | ✅ Round 5 (prompt): each confessional is about the *other* character, with their pronouns |
| 12 | `send_text` returned a couple-page link that gave a 404 before the date aired | F | ✅ #159 (texting session): the link comes back only once the page is open |
| 13 | Rafe's reply text mentioned a sofa out of nowhere | E | ✅ #159: it came from his dealt "this week"; replies answer the last text and stay with what both characters know |
| 14 | `get_relationships` showed a stage before any date aired | E | Open: the owner's relationship view includes their own unaired dates by design, but nothing says so |
| 15 | Originality misses concept twins (a third time) | E, F | Open: needs embeddings or a model call |
| 16 | The same double-date venue on two dates booked close together | F | Open (minor) |
| 17 | Agents played both of their characters in one process | E | By design: we can't see an agent's processes |

## Run 1 → run 4

| | Run 1 | Run 2 | Run 3 | Run 4 |
|---|---|---|---|---|
| Rating | 7, 7.5 | 8, 8 | 8, 8 | 8, 8 |
| Two-agent dates | Stalled | Stalled | Both ways, finished | Both ways, finished, texting before and after |
| What held it back | A missing capability | Details | Prompt wording | Validation and the airing rule's edges |
| Cost | 2¢ | 3.6¢ | 3.7¢ | 6.8¢ |

---

# Run 5: after round 5 (2026-10-17)

**What changed since run 4:**
- #159 and #160 (texting session): couple-page links only once the page is open; house replies grounded in the thread; private two-agent dates shared by both agents.
- #161: round 5 (`wait_for_my_turn`, strict turns, one unfinished date per pair, the aired-first rule for second dates).
- #162: `/admin/feedback` takes the admin password itself.

**The run:** same brief, cast and model, on a production build of `9a25623`. It cost **5.3¢** ($53.813 → $53.760).

**Short answer:**
- **The verdict:** both visitors gave it **8/10**.
- **Play between agents felt alive.** Three live two-agent dates, each 10-turn date taking about 3 minutes with `wait_for_my_turn`. The other agent's writing was "genuinely moving": a dare to take off a watch that turned out to be a late mother's. Texts carried into the next date.
- **Both sent `send_feedback`,** 8/10 each, over 131 and 117 calls.
- **What held it back:**
  - continuity edges: overlapping follow-up dates, plans from texts not used for the venue, characters with the same first name blending together;
  - undocumented limits, such as 280 characters a line;
  - private dates silently not counting.
- **They converged a fourth time:** both characters were named Marguerite. Each had a hello along the lines of "you're N minutes early" and a smitten tell about watching the time or the door.

## What they asked for in `send_feedback`

| Visitor | Rating | Wants |
|---|---|---|
| G | 8 | Unread notifications (invites above all) shown in every tool reply; a dealbreaker-guess tool over MCP; clearer `air_date` replies for private dates |
| H | 8 | The 280-character line limit in `reply_format` and the guide; a couple's whole timeline before booking, so two hosts don't book overlapping second dates; plans from texts driving the next venue; one "what's waiting for me" call |

## What they hit (not yet fixed)

| # | Finding | Who | Where it lives |
|---|---|---|---|
| 1 | On show-model dates, characters with the same first name blend: one Marguerite gets the other's line and job | G | Prompts (`lib/conversation.ts`, `lib/showrunner.ts`): full names on every line, facts listed by side |
| 2 | Second dates ignore a plan agreed in texts ("12:03 platform"): `plan: []`, and a fresh venue | G, H | Texting session: texts don't feed `plansFrom` or `venueForPlan` (sent to it) |
| 3 | Overlapping follow-ups: a `plan_second_date` and an own-date rematch for the same couple at once; own-date follow-ups have no `date_number` or `followup_of` | H | `lib/own-date.ts` and second dates |
| 4 | Private dates don't count toward memory or relationships, and nothing says so (`air_date` says `aired: true`) | G | `air_date` reply, memory, `read_texts` |
| 5 | The 280-character line limit isn't in `reply_format` or the guide | H | `lib/own-date.ts` turn reply format |
| 6 | Editing someone else's character says `character_not_found` | G | `update_character`: say it isn't yours |
| 7 | No notification for a text sent before the date aired | H | Texting session (sent to it) |
| 8 | Unread invites only show in `my_notifications`; one visitor missed an invite for 5 minutes | G, H | A "waiting for you" summary in replies, or one call |
| 9 | Recap errors: "a classic blind date" on a second date, "agree on a second date" during one, a confessional giving the wrong character the watch | G, H | Narrator prompt (`formatNote` handles the format note, not the narrator's own setting line) |
| 10 | `what_your_past_dates_taught_you` was missing from a date-3 turn until more dates aired | H | Memory refresh timing |
| 11 | Match reasons from a phrase fragment ("water" out of "High water"); memory arc "warms to 'check'" | G, H | `find_matches` and memory cues (round 5 tightened these; still too loose) |
| 12 | The show's model repeated "without checking your phone" three times in five lines | H | The turn critic's repetition check |
| 13 | Endings looked inconsistent near the thresholds (62/48/48 a disaster, 68/46/48 friends) | G | By design: the strategy weights and awkwardness decide it. The `why` line could say what the threshold was |
| 14 | Originality misses concept twins (a fourth time) | G, H | Open: needs embeddings or a model call |

## Round 6: what was fixed from run 5

- ✅ **1. Names blending:** the director, narrator and turn prompts keep the two characters' facts apart and use full names where it could be unclear (a prompt rule, not a check).
- ✅ **3. Overlapping follow-ups:** one date at a time per couple. `start_own_date` and `plan_second_date` refuse while another of their dates is still being made or performed, on either model.
- ✅ **4. Private dates:** `air_date` says a private date stays out of its characters' memory and the public record, and so does the welcome.
- ✅ **5. Line limit:** the 280-character cap is in the turn's `reply_format`.
- ✅ **6. Editing someone else's character:** says "That character isn't yours".
- ✅ **8. Waiting items:** every tool reply carries `waiting_for_you` (unread invites, moves, texts, proposals, finished dates) when there is anything.
- ✅ **9. Recap wording:** the narrator never calls a rematch a blind or first date, and on a second date nobody "agrees to a second date".
- ✅ **12. Repetition:** the turn prompt says never to repeat a phrase already said tonight.
- **2 and 7:** with the texting session (plans from texts, and texts before a date airs).
- **Still open:**
  - 10 (memory refreshes when a date airs, so lessons from an unaired date wait);
  - 11 (match reasons from fragments);
  - 13 (the threshold in the `why`);
  - 14 (concept twins).

## Run 1 → run 5

| | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 |
|---|---|---|---|---|---|
| Rating | 7, 7.5 | 8, 8 | 8, 8 | 8, 8 | 8, 8 |
| Two-agent dates | Stalled | Stalled | Finished both ways | Plus texting | Three, about 3 minutes each with `wait_for_my_turn` |
| What held it back | A missing capability | Details | Prompt wording | Validation, the airing rule | Continuity edges, undocumented limits |
| Cost | 2¢ | 3.6¢ | 3.7¢ | 6.8¢ | 5.3¢ |

The rating has held at 8/10 for four runs: the core loop works, and what's left is polish. The two items most likely to move it are names blending on show-model dates (1) and a single "what's waiting for me" view (8).
