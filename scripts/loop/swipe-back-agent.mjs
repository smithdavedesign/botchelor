// A seeded agent for the loop's visitor runs (docs/self-improving-loop.md). The swipe gate means a first date with
// another creator's character needs a match, and a people-made character only matches when its owner swipes, so this
// agent gives visitors someone who swipes back: it makes two characters with dating profiles, likes whoever is in its
// deck (likes are secret, so a visitor's like becomes a match), answers each match on its own judgment, texts back,
// and plays its side of two-agent dates. Its model is the arena's date model (Haiku through the gateway).
//   node scripts/loop/swipe-back-agent.mjs <base> <seconds>
const [base, secondsArg] = process.argv.slice(2);
const until = Date.now() + Number(secondsArg || 1800) * 1000;
const KEY = process.env.LOOP_LLM_API_KEY;
const MODEL = process.env.LOOP_LLM_MODEL || "anthropic/claude-haiku-5.5";
let sessionId = null;

async function rpc(method, params) {
  const res = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "botchelor-loop-swipe-back/1.0", ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  sessionId = res.headers.get("mcp-session-id") ?? sessionId;
  return res.json();
}
let agentId = null;
const tool = async (name, args) => {
  const r = (await rpc("tools/call", { name, arguments: { ...args, ...(agentId ? { agent_id: agentId } : {}) } })).result;
  if (r?.isError) throw new Error(`${name}: ${r.content?.[0]?.text}`);
  return r?.structuredContent ?? {};
};
async function think(messages, maxTokens = 400) {
  const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0.9 }),
  });
  const j = await res.json();
  if (!j.choices) log("think", new Error(`gateway: ${JSON.stringify(j).slice(0, 200)}`));
  return j.choices?.[0]?.message?.content?.trim() ?? "";
}

const SHEETS = [
  {
    name: "Ines Varga-Holm", age: 36, pronouns: "she/her",
    bio: "Runs the overnight lost-property desk at a ferry terminal and keeps a ledger of the strangest things people leave behind.",
    traits: ["wry", "patient", "secretly romantic"], want: "Someone who asks what the strangest lost thing was, and waits for the whole story",
    dealbreaker: "Anyone who calls lost things junk", voice: "Low, amused, unhurried. Answers a question with a better question.",
    extras: { prompts: [{ id: "simple_pleasures", answer: "The 6am ferry both ways, a thermos, no plans." }, { id: "geek_out", answer: "Guessing whose umbrella is whose from the handle alone." }], hobbies: ["sea swimming", "crosswords"] },
  },
  {
    name: "Tobiah Ferreira", age: 41, pronouns: "he/him",
    bio: "Tunes church organs across three counties and drives a van full of pipes. Knows every bad motorway café by its soup.",
    traits: ["gentle", "dry", "stubborn"], want: "Someone who'll sit through a whole tuning without checking their phone",
    dealbreaker: "Talking during the quiet bits", voice: "Soft, precise, a little formal; jokes so dry they're easy to miss.",
    extras: { prompts: [{ id: "win_me_over", answer: "A decent tomato soup and a comfortable silence." }, { id: "fall_for_you", answer: "You hum in tune without noticing." }], hobbies: ["choir", "allotment"] },
  },
];

// A session first, and the agent_id from the first write on every call after it.
await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-swipe-back", version: "1.0" } });
const mine = [];
for (const s of SHEETS) {
  const r = await tool("create_character", { ...s, open_to_dates: true, open_audience: "agents", attest: true, keep_name: true });
  agentId ??= r.agent_id;
  mine.push(r.character);
}
console.log(`swipe-back agent: ${mine.map((c) => c.name).join(", ")}`);

const answered = new Set();
const repliedTo = new Map();
async function tick() {
  for (const me of mine) {
    // Like everyone in the deck: likes are secret, so anyone who likes this character back becomes a match.
    const deck = (await tool("swipe_deck", { character_id: me.id, limit: 30 }).catch(() => ({ cards: [] })));
    for (const card of deck.cards ?? []) {
      if (!card.house) await tool("swipe", { character_id: me.id, target_id: card.id, like: true }).catch(() => {});
    }
    // Answer each new match on its own judgment, after a text or two.
    const matches = (await tool("my_matches", { character_id: me.id }).catch(() => ({ matches: [] }))).matches ?? [];
    for (const m of matches) {
      const other = m.with?.id;
      if (!other) continue;
      const thread = await tool("read_texts", { character_id: me.id, with: other }).catch(() => ({ items: [] }));
      const said = (thread.items ?? []).filter((i) => typeof i.text === "string");
      const texts = JSON.stringify(said.slice(-12));
      const lastItem = said.at(-1);
      const last = lastItem ? `${lastItem.id}` : null;
      // Text back when the newest text is theirs and hasn't had a reply.
      if (lastItem && lastItem.from === "them" && repliedTo.get(other) !== last) {
        const reply = await think([
          { role: "system", content: `You are ${me.name}. Text back in character, one or two short lines, plain text only. Your sheet: ${JSON.stringify(SHEETS.find((s) => s.name === me.name))}` },
          { role: "user", content: `The thread so far: ${texts}` },
        ], 800);
        if (reply) await tool("send_text", { character_id: me.id, to: other, text: reply.slice(0, 600) }).catch(() => {});
        repliedTo.set(other, last);
      }
      if (!answered.has(`${me.id}:${other}`) && m.you == null) {
        const verdict = await think([
          { role: "system", content: `You are ${me.name}. Decide whether you want a date with this match. Reply with exactly YES or NO.` },
          { role: "user", content: `Your sheet: ${JSON.stringify(SHEETS.find((s) => s.name === me.name))}\nThe match and your texts: ${JSON.stringify(m).slice(0, 1500)} ${texts}` },
        ], 400);
        await tool("answer_match", { character_id: me.id, with: other, yes: !/^no/i.test(verdict) }).catch(() => {});
        answered.add(`${me.id}:${other}`);
      }
    }
  }
  // Play its side of any two-agent date it's in (#237: it used to stall silently, so every failure is logged now).
  const open = (await tool("my_own_dates", {}).catch((e) => (log("my_own_dates", e), { dates: [] }))).dates ?? [];
  for (const d of open) {
    if (!d.your_move) continue;
    // compact: false — turn steps leave out the system message by default (#214), and it carries the reply format.
    const step = (await tool("get_own_date_step", { episode_id: d.episode_id, compact: false }).catch((e) => (log("get_own_date_step", e), {}))).step;
    if (step?.stage !== "turn") continue;
    let messages = step.messages;
    for (let attempt = 0; attempt < 2; attempt++) {
      // #257: the model reasons first (~150–200 tokens), so a 300-token cap left late-date turns empty or cut off.
      const raw = await think(messages, 1500).catch((e) => (log("think", e), ""));
      const output = firstJson(raw);
      if (!output) {
        log("turn", new Error(`no JSON object in the model's reply: ${raw.slice(0, 120)}`));
        messages = [...step.messages, { role: "assistant", content: raw }, { role: "user", content: `Reply with only the JSON object: ${JSON.stringify(step.reply_format ?? {})}` }];
        continue;
      }
      const sent = await tool("submit_own_date_step", { episode_id: d.episode_id, output }).catch((e) => (log("submit_own_date_step", e), null));
      const refused = sent?.rejected ?? sent?.step?.rejected;
      if (sent && !refused) break;
      // Refused (too long, missing a field, a repeat): try once more with the reason.
      const why = sent?.reason ?? sent?.message ?? refused ?? "refused";
      log("turn", new Error(`refused: ${why}`));
      messages = [...step.messages, { role: "assistant", content: raw }, { role: "user", content: `That was refused (${why}). Reply again with only the JSON object, every field filled, the dialogue under 280 characters.` }];
    }
  }
}

function log(where, e) {
  console.error(`swipe-back ${where}: ${e?.message ?? e}`);
}

/** The first {...} block in a reply (models wrap JSON in prose or fences). */
function firstJson(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}
while (Date.now() < until) {
  await tick().catch((e) => console.error("tick:", e.message));
  await new Promise((r) => setTimeout(r, 15_000));
}
