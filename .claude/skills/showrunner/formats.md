# The format playbook

These are moves reality TV does well, adopted for Botchelor (David, 2026-11-27: "add all of these as a byproduct of
the skill... a tool set for the writer or producer"). The **producer** picks from this list when it builds a beat
sheet. The **writer** and **asset builder** use each entry's "words" and "pictures" lines as their brief. The
**editor** checks a shipped format against its "lands when" line.

Every move follows `showrunner`'s rules, which never bend: the engine decides and the show only presents, nothing
spoils before it airs, everything comes from the public record, and nothing is presented as true that isn't. A
format that would need the show to *steer* an outcome (pick a winner, force a breakup) is out. It may only stage
and show what the engine already did, or add a choice the audience or a booker makes.

Before you propose a move, check what already exists (listed under "already there") so you surface it rather
than rebuild it.

---

## 1. The cliffhanger

**What it is.** A night ends just before the answer, and the answer opens the next one.
**Why it works.** An open question is the strongest reason to come back tomorrow.
**Botchelor version.** Cut a night's recap at its highest-tension line, which you find with `lib/story-state.ts`
tensions and `lib/producer.ts` beats. Show it as "Tomorrow: ..." and open the next night's page with a resolve line.
It must never cut before something that has already aired publicly elsewhere.
**Words.** A hold line ("And then she said...") and a resolve line, both templates over the public transcript.
**Pictures.** An end card with the two faces and "To be continued", sized for stories.
**Already there.** The nightly producer beat; `lib/house-kits.ts` has cliffhanger dialogue.
**Lands when.** Every episode and night page ends on an open question. The question appears nowhere above it.

## 2. The interruption ("Can I steal him for a second?")

**What it is.** A rival cuts into a date in progress.
**Why it works.** It is cheap drama because the characters already exist and the rivalry is already there.
**Botchelor version.** The interruption happens only when the story already has the rivalry: a `rivals` or
triangle entry in `lib/story-state.ts`. The engine runs it as a scene beat, and the show never invents a rivalry
the record lacks.
**Words.** The steal line, the reaction and the confessional after it.
**Pictures.** A split card: the date on one side, the interrupter on the other.
**Already there.** Check `lib/situations.ts`, `lib/house-scenes.ts` and `lib/dares.ts` for an interruption-like
beat before adding one.
**Lands when.** A viewer can see who interrupted whom, and why (the rivalry is linked).

## 3. Unequal dates (one-on-one, group, two-on-one)

**What it is.** Dates are unequal on purpose: the one-on-one is a prize, the group date is a fight for time, and
in the two-on-one one of the two goes home on the spot.
**Why it works.** Getting fewer dates becomes the story.
**Botchelor version.** Label the season's dates by type on the season page and the calendar ("one-on-one" is the
prize). A two-on-one is a format week in `lib/season-format.ts`: two suitors, one date, and the engine's own
verdict decides who stays. The show never decides.
**Words.** Date cards ("Tonight's one-on-one goes to..."), the two-on-one tease and the walk-out line.
**Pictures.** A date card per type, and a two-on-one card with both faces and one rose.
**Already there.** `lib/group-dates.ts` (double dates) and the format weeks in `lib/season-format.ts`.
**Lands when.** The season page shows each suitor's date count and the next one-on-one.

## 4. The first impression rose

**What it is.** On night one, the lead gives one suitor an early rose that keeps them safe in the first ceremony.
**Why it works.** Everyone has a target to chase from day one.
**Botchelor version.** It goes to the suitor the lead's first week went best with, according to the engine's own
scores. The audience's vote can't send that suitor home in week 1. Say so on the vote page.
**Words.** The handoff line, the safe badge and the losers' confessionals.
**Pictures.** A first impression card: the lead, the rose, the winner.
**Already there.** Week 1 in `lib/season-format.ts` is "First impressions"; check `lib/beats.ts`, `lib/moves.ts`
and `lib/rules.ts` for an existing rose.
**Lands when.** Week 1's vote page shows who is safe and why.

## 5. Hometowns

**What it is.** Near the end, each remaining suitor's family or best friend meets the lead.
**Why it works.** It brings in a whole new cast for one week, and the family's verdict adds stakes.
**Botchelor version.** The family members are new house characters drawn from the suitor's own bio (hometown,
family lines). They are never real people. Their verdict is an engine beat.
**Words.** The family's lines, the verdict and the drive home.
**Pictures.** A hometown set (the suitor's place, drawn the way show sets are) and a family card.
**Already there.** Week 3 "Hometowns" (`meet_the_parents`) in `lib/season-format.ts`. Surface it before rebuilding it.
**Lands when.** Hometowns week has its own page section and a share card per family.

## 6. The reunion ("The Suitors Tell All")

**What it is.** After the finale, everyone who went home comes back and confronts each other.
**Why it works.** The losers get a last word, and old rivalries get a payoff.
**Botchelor version.** One special episode after the finale. Every exited suitor answers the top audience
questions, which are collected as a vote. The confrontations come from the season's public rivalries.
**Words.** Question cards, answers in each suitor's voice and the host's links between them.
**Pictures.** A reunion poster with every suitor in a row, and a clip per confrontation.
**Already there.** Exits and the confessionals; `lib/ending-detail.ts`.
**Lands when.** The reunion airs the week after the finale with its own page and poster.

## 7. The spinoff for the rejects

**What it is.** The suitors who went home get a second chance at love in a side show.
**Why it works.** Losing doesn't end a character, so their fans stay.
**Botchelor version.** A between-seasons mini-season, or a "Second Chances" shelf where exited suitors date each
other or the audience's characters. It runs on the same engine, the same rules and the same booking.
**Words.** The pitch, the title and each returning suitor's "why I'm back" line.
**Pictures.** Its own poster and logo treatment (the season poster's layout with a new palette).
**Already there.** Exits and the season-cast machinery. This is a new format, so propose it as an M or L bet.
**Lands when.** An exited suitor's page links to their next chance.

## 8. The villain edit

**What it is.** The show frames one cast member as the antagonist.
**Why it works.** Viewers vote harder against someone they love to hate.
**Botchelor version.** Only from the record: the suitor with the most rivals, the most broken claims or the
lowest scores from the others. The framing is in the copy and the cut, never in what the character did, and the
claim it makes is checkable ("most rivals this season: 4"). Never pick the villain by hand, never invent a
misdeed, and never attach it to a user's own character without that owner's opt-in.
**Words.** A villain's confessional style, the other suitors' lines about them and the vote tease.
**Pictures.** A "Who's here for the wrong reasons?" card.
**Already there.** `lib/story-state.ts` rivals; the `villain` tags in `lib/house*.ts`.
**Lands when.** The season page names the season's antagonist with the numbers behind it.

---

**Quick wins.** Moves 1, 3 and 4 need the least new machinery. They mostly surface what the engine already does.
