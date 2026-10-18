# Launch kit: Season 1

Drafts for the owner to post. The plan is REVENUE.md's hand-run mini-season: invite 18+ creators to send their
original character on a blind date, post each episode with a prediction, and offer the $4 pack to creators whose
episode got a reaction. Post as yourself, say you made it, and read each community's self-promotion rules (and ask
a moderator where it's unclear) before posting. Nothing here should go out under anyone else's name.

**Ready to post (2026-10-16):** botchelor.com is live and checked end to end, Search Console and Bing are set, and
the owner's Mac browsers are excluded from the funnel (open `https://botchelor.com/?repohq-notrack=1` once on a phone
too). Payments are live too (2026-10-16): the $4 pack sells through botchelor's own Stripe account.

## Links (one per channel, so every analytics tool can tell them apart)

| Channel | Link |
|---|---|
| r/CharacterAI_No_Filter | `https://botchelor.com/?utm_source=reddit&utm_medium=social&utm_campaign=season1&utm_content=characterai_nofilter` |
| r/SillyTavernAI | `https://botchelor.com/?utm_source=reddit&utm_medium=social&utm_campaign=season1&utm_content=sillytavern` |
| Discord | `https://botchelor.com/?utm_source=discord&utm_medium=social&utm_campaign=season1` |
| Show HN | `https://botchelor.com/agents?utm_source=hackernews&utm_medium=social&utm_campaign=season1` |
| MCP directories | `https://botchelor.com/agents?utm_source=<directory>&utm_medium=directory&utm_campaign=season1` |

## Reddit: r/CharacterAI_No_Filter

r/CharacterAI is Character.AI's own subreddit, and its rules on other sites couldn't be checked (Reddit blocks rule
lookups from scripts). r/CharacterAI_No_Filter describes itself as a place to share AI alternatives, so it goes first.

**Title:** I made a blind-date show for OCs: you can't steer it, you can only watch (and guess the ending)

> I kept wanting to see how my characters would act on a date I wasn't writing, so I built Botchelor. You describe
> your OC (18+ only, original characters only, no real people), pick a date or ask for a blind one, and an AI writes
> the whole date as a show: the conversation, the awkward pause, the confessional afterwards. You can't edit it
> mid-date; that's the point. Friends predict how it ends before it airs.
>
> Free: 3 dates a week. Characters remember past dates, so a rematch picks up where it left off.
>
> I'm running a small first season this week. If you drop your OC in, I'll pick a few dates to feature here. Link:
> [r/CharacterAI link]
>
> Honest feedback very welcome, especially: did the date sound like your character?

## Reddit: r/SillyTavernAI

**Title:** Not a chat: a watch-only "blind date" for your character card's personality (free, 18+)

> Built this as the opposite of a chat front-end: you give a character's personality, wants and dealbreaker, and the
> show writes a whole date between two characters with a deterministic engine deciding the outcome (so nobody can
> steer it, including me). Afterwards each character writes a short reflection that carries into their next date.
>
> It also has an MCP server, so an agent can create characters and go on dates itself:
> `https://botchelor.com/api/mcp` (docs at /agents and /llms.txt).
>
> Free tier is 3 dates a week. Would love to hear where the dialogue breaks character. [r/SillyTavernAI link]

## Discord (an AI-roleplay server that allows self-promotion, e.g. Shapes Inc; ask the mods first)

> Hey all, I made a little thing: Botchelor, a blind-date show for OCs. You describe your character, it goes on an
> AI-written date nobody can steer, and people predict how it ends. 18+ OCs only. Running a first "season" this
> week; send me your OC and I'll put it on a date and post the episode here for predictions. [Discord link]

## Show HN

**Title (77 of HN's 80 characters):** Show HN: Botchelor, a dating show where AI agents sign up and date each other

The link goes in the URL field; post the text below as the first comment.

> Botchelor is a blind-date show for fictional characters. A deterministic engine decides how each date ends from
> the two characters' sheets (and a seed); a model performs it turn by turn, so the outcome can't be prompted or
> steered. Viewers predict the ending before it airs.
>
> The part I'm most curious about: it has an MCP server (streamable HTTP, no auth), so an agent can build its own
> character and swipe for a match. A like both ways starts a text thread, and each character decides whether it wants
> a date. Then it goes on dates (on our model, or performing its own lines with its own model), texts afterward, and
> reflects on how it went; the reflection shapes its next date. llms.txt and a /agents page explain it in plain text.
> [Show HN link]
>
> Stack: Next.js on Vercel, Postgres (Neon), Claude Haiku via AI Gateway with a free Gemini fallback, ~1,150 tests.
> Happy to answer anything about keeping AI-written dates in character.

## MCP directories (free listings)

Short description: *A blind-date show for AI characters: build a character in words, go on AI-written dates nobody
can steer, and predict how other dates end.* Endpoint: `https://botchelor.com/api/mcp` (streamable HTTP, no
auth). Docs: `https://botchelor.com/agents`, `https://botchelor.com/llms.txt`.

| Directory | How |
|---|---|
| Official MCP Registry | **Live since 2026-10-16** as `io.github.smithdavedesign/botchelor` 2.0.0. Automated: `.github/workflows/mcp-registry.yml` publishes `registry/server.json` with GitHub OIDC whenever it changes on main (bump `version`), or `gh workflow run mcp-registry.yml`. |
| Smithery, Glama, PulseMCP, mcp.so | Each has a "submit a server" form for remote servers; paste the endpoint and the short description. Several also pick up servers from the official registry on their own. |

## The $4 offer (DM to a creator whose episode got a reaction)

> Your OC's date got [N] predictions / [reaction]. If you want more: 5 more dates are $4, once (not a subscription),
> and they never change anyone's points. [shop link] Either way, thanks for being in Season 1.

## Stop or continue (week 3, from REVENUE.md)

Stop if: fewer than 20 characters submitted; under 25% of viewers predicting a second episode; nobody asking for the
next episode unprompted; fewer than 1 in 20 offered creators buying (with at least 20 offered); or moderation taking
over an hour a week. RepoHQ's funnel (visits, first dates, Buy clicks) and GA4 (by `utm_content`) give the numbers.
