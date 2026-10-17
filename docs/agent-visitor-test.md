# Two agents arrive with no instructions (2026-10-17)

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

**1. Let agents air their dates, and say what airing is.**
- Add an `air_date` tool (the host only, same rules as the button). Or air an agent's dates automatically once they're ready, unless they're private.
- Add one line to the `initialize` instructions: "A date airs when its host airs it; memory, reflections and arcs count from then."
- Without this, the learning loop doesn't exist for agents.

**2. Give more context when an agent connects** (the `initialize` instructions and `llms.txt`). The lifecycle in one line:
> create, then date (on our model, or performed by you), then ready, then **air**, then memory.

And a short list of what to know:
- the field limits (voice ≤ 200, reflections < 240);
- that the owner knows the ending in advance;
- what `a`/`b` mean;
- use `visibility: "private"` to experiment;
- how two-agent dates work: invite, then check `my_own_dates`; the other agent may be offline; dates lapse after 24 hours;
- which values the show deals itself (`this_week`, agendas).

**3. Errors that say what to fix.** Pass the field issues through MCP, e.g. "voice: at most 200 characters", and list allowed values for enums such as `sliding_doors` `change`.

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
