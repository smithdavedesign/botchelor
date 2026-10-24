// The production house crowd's decisions (docs/house-crowd.md): pure functions, so tests can pin them down. What a
// bot likes, how much it does in a day, when it's awake, which bots go on a date together tonight, and the prompt tests
// (a Thompson-sampling bandit over text styles and lengths, scored by whether the other side wrote back themselves).
import { hash } from "../loop/crowd.mjs";

export const CLIENT_PREFIX = "botchelor-loop-crowd-";

/** A bot's MCP client name from its character's first word ("Unit Marigold-7" → marigold): the house-run label. */
export function clientFor(name) {
  const words = String(name ?? "").trim().split(/\s+/);
  const word = words[0] === "Unit" && words[1] ? words[1] : words[0] ?? "";
  return `${CLIENT_PREFIX}${word.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "") || "bot"}`;
}

/* ---------------------------------------------- caps and hours ---------------------------------------------- */

/** What one bot may do in a day (UTC) and in one run, so the crowd reads as people, not a firehose. */
export const DAILY = { likes: 12, agent_likes: 4, answers: 20, openers: 4, texts: 30 };
export const PER_RUN = { likes: 3, texts: 6 };
/** Bot-vs-bot dates a night, across the crowd (each puts one short recap on the show's model). */
export const NIGHTLY_DATES = 2;
/** The longest a thread goes with the bot talking and nobody answering: then it waits. */
export const MAX_UNANSWERED = 2;

/** The day a count belongs to (UTC). */
export const dayKey = (now) => new Date(now).toISOString().slice(0, 10);

/** A bot's local hour: each one lives a few hours from UTC (between UTC−8 and UTC+1), fixed by its id. */
export function localHour(botId, now) {
  const offset = (hash(`tz:${botId}`) % 10) - 8;
  return (((new Date(now).getUTCHours() + offset) % 24) + 24) % 24;
}

/** Awake 08:00 to just past midnight local: asleep from 01:00 to 08:00, like anyone. Dates in progress are played anyway. */
export const isAwake = (botId, now) => {
  const h = localHour(botId, now);
  return h >= 8 || h < 1;
};

/** Whether `used` (a bot's counts today) leaves room for one more `kind`. */
export const underCap = (used, kind) => (used?.[kind] ?? 0) < DAILY[kind];

/* ---------------------------------------------- swiping ---------------------------------------------- */

/**
 * What a bot does with a deck card: like back anyone who liked it (that's a match), like about half of the outside
 * agents' characters (the agent audience gets someone to talk to), and leave people's characters alone: a person
 * hears from the crowd first only through the welcome experiment (lib/welcome.ts), which keeps that experiment fair.
 * Never another bot (bot pairs are made for the night's dates instead). Returns "like_back", "like" or "skip".
 */
export function swipeDecision(card, botCharacterId) {
  if (!card || card.house_bot || card.house) return "skip";
  if (card.liked_you) return "like_back";
  if (card.run_by === "agent") return hash(`like:${botCharacterId}:${card.id}`) % 2 === 0 ? "like" : "skip";
  return "skip";
}

/* ---------------------------------------------- the prompt tests ---------------------------------------------- */

/**
 * What the bandit tries. An opener is the first text in a new match's thread; a length goes on every other text. Each
 * style is one rule line in the model's prompt (scripts/loop/crowd.mjs replyMessages extra.style).
 */
export const VARIANTS = {
  opener: [
    { id: "question", style: "Open with one specific, curious question about something in their profile or their day. Nothing else." },
    { id: "tease", style: "Open with a light, playful tease about something you two have in common, then leave them an easy way in." },
    { id: "confession", style: "Open by admitting one small, slightly embarrassing thing about your own day, then ask how theirs is going." },
    { id: "callback", style: "Open by picking up one detail from their profile and telling a short story of your own about it (never quote it)." },
  ],
  length: [
    { id: "short", style: "Keep it to one short sentence." },
    { id: "medium", style: "Two or three sentences: answer, add something of your own, and end on a question." },
  ],
};

/** A standard normal draw (Box-Muller), from `rng` (uniform in [0, 1)). */
function normal(rng) {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** A Gamma(shape, 1) draw (Marsaglia and Tsang), for the Beta draws below. */
function gamma(shape, rng) {
  if (shape < 1) return gamma(shape + 1, rng) * Math.pow(Math.max(rng(), 1e-12), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** A Beta(a, b) draw. */
export function betaSample(a, b, rng = Math.random) {
  const x = gamma(a, rng);
  return x / (x + gamma(b, rng));
}

/** Each variant's tally in one dimension from the ledger: { id: { sent, replied, open } }, resolved entries only counted. */
export function tally(ledger, dimension) {
  const out = Object.fromEntries(VARIANTS[dimension].map((v) => [v.id, { sent: 0, replied: 0, open: 0 }]));
  for (const e of ledger) {
    if (e.dimension !== dimension || !out[e.variant]) continue;
    if (e.outcome === null || e.outcome === undefined) out[e.variant].open++;
    else {
      out[e.variant].sent++;
      if (e.outcome === 1) out[e.variant].replied++;
    }
  }
  return out;
}

/** Thompson sampling: each variant's Beta(1 + replied, 1 + unanswered) posterior drawn once; the highest draw goes. */
export function chooseVariant(ledger, dimension, rng = Math.random) {
  const t = tally(ledger, dimension);
  let best = null;
  for (const v of VARIANTS[dimension]) {
    const s = t[v.id];
    const draw = betaSample(1 + s.replied, 1 + (s.sent - s.replied), rng);
    if (!best || draw > best.draw) best = { variant: v, draw };
  }
  return best.variant;
}

/** How likely each variant is the best, by `samples` posterior draws: what the weekly report shows. */
export function probabilityBest(ledger, dimension, { samples = 4000, rng = Math.random } = {}) {
  const t = tally(ledger, dimension);
  const ids = VARIANTS[dimension].map((v) => v.id);
  const wins = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let i = 0; i < samples; i++) {
    let top = null;
    for (const id of ids) {
      const s = t[id];
      const d = betaSample(1 + s.replied, 1 + (s.sent - s.replied), rng);
      if (!top || d > top.d) top = { id, d };
    }
    wins[top.id]++;
  }
  return Object.fromEntries(ids.map((id) => [id, wins[id] / samples]));
}

/** A reply counts within a day; with none after two, the text goes down as unanswered. */
export const REPLY_WINDOW_MS = 24 * 3600_000;
export const GIVE_UP_MS = 48 * 3600_000;

/**
 * Settles a ledger entry against its thread as read now: 1 when the other side wrote back themselves (written_by
 * "them": an agent, or a person with their own key, never a text the show wrote for them) within REPLY_WINDOW_MS of
 * the bot's text, 0 once GIVE_UP_MS has passed with no such reply, else still open (null).
 */
export function settle(entry, thread, now) {
  if (entry.outcome === 0 || entry.outcome === 1) return entry.outcome;
  const sent = Date.parse(entry.sent_at);
  const reply = thread.find((t) => t.from === "them" && t.written_by === "them" && Date.parse(t.at) > sent);
  if (reply && Date.parse(reply.at) - sent <= REPLY_WINDOW_MS) return 1;
  if (reply || now - sent > GIVE_UP_MS) return 0;
  return null;
}

/** Drops settled entries older than `days` (the report reads 90 days at most). */
export const pruneLedger = (ledger, now, days = 120) => ledger.filter((e) => e.outcome === null || e.outcome === undefined || now - Date.parse(e.sent_at) < days * 86_400_000);

/* ---------------------------------------------- the night's dates ---------------------------------------------- */

/**
 * Tonight's bot-vs-bot pairs: a shuffle of the roster fixed by the date, taken two at a time, so every night's pairs
 * differ and a re-run on the same night picks the same ones. `exclude` holds pairs already matched or dated ("lo:hi").
 */
export function nightPairs(roster, day, count = NIGHTLY_DATES, exclude = new Set()) {
  const order = [...roster].sort((a, b) => hash(`${day}:${a.id}`) - hash(`${day}:${b.id}`) || a.id.localeCompare(b.id));
  const pairs = [];
  const used = new Set();
  for (let i = 0; i < order.length && pairs.length < count; i++) {
    if (used.has(order[i].id)) continue;
    for (let j = i + 1; j < order.length; j++) {
      if (used.has(order[j].id)) continue;
      const key = [order[i].id, order[j].id].sort().join(":");
      if (exclude.has(key)) continue;
      pairs.push([order[i], order[j]]);
      used.add(order[i].id);
      used.add(order[j].id);
      break;
    }
  }
  return pairs;
}

/* ---------------------------------------------- fallback lines ---------------------------------------------- */

const HELLOS = [
  "Hi {them}. I'll be honest, I nearly didn't come, and I'm glad I did.",
  "{them}, hello. You look exactly like someone with a good story.",
  "Hello {them}. Shall we pretend we're both very relaxed about this?",
];
const LINES = [
  "So what does a normal Tuesday look like for you?",
  "I've been told I talk too much when I'm nervous. Stop me if I do.",
  "Tell me something you're quietly proud of.",
  "This is nicer than I expected, and I expected nice.",
  "What's the last thing that made you laugh out loud?",
];
const TEXTS = [
  "Hey {them}. Glad we matched. How's your day going?",
  "Still thinking about what you said. In a good way.",
  "Okay, honest question: what are you doing this weekend?",
  "My day was strange. Yours?",
];

/**
 * A bot's scripted pools for the crowd's fallback (scripts/loop/crowd.mjs scriptedTurn / scriptedText): used only when
 * the local model is off or refused twice. A hello and texts chosen by the bot's id, so two bots don't sound the same.
 */
export function fallbackEntry(sheet) {
  const k = hash(sheet.name);
  const rot = (pool, by) => pool.map((_, i) => pool[(i + by) % pool.length]);
  return { sheet, lines: [HELLOS[k % HELLOS.length], ...rot(LINES, k)], texts: rot(TEXTS, k) };
}
