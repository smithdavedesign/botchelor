#!/usr/bin/env node
/**
 * Suggests real people named in the prompts library's next-in-line prompts, for scripts/data/prompt-people.txt
 * (David, 2026-10-25: the word lists let "gal gadot" and "danny devito" through). Asks the local Ollama model, so it's
 * free and nothing leaves the machine; the seed itself never calls a model, it reads the list.
 *   VET_OUT=/tmp/next.json node scripts/build-prompts-library.mjs && node scripts/vet-prompt-people.mjs /tmp/next.json
 * It prints each suggestion with the prompt it came from and writes nothing: most are artists cited for a style,
 * fictional characters or plain descriptions, so a person reads them and adds only the real people to the list.
 */
import { readFileSync } from "node:fs";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.VET_MODEL ?? "qwen2.5:7b";
const FILE = new URL("./data/prompt-people.txt", import.meta.url);
const BATCH = 15;

const SYSTEM =
  "You find real, identifiable people named in image-generation prompts. Real people means celebrities, actors, " +
  "musicians, models, athletes, politicians, royalty, business people, influencers and other public or historical " +
  "figures, whether they are the subject, a comparison (\"looks like X\") or a costume (\"X as Y\"). Do NOT list artists, " +
  "painters, illustrators, photographers or studios cited for a style (\"by greg rutkowski\", \"art by X\", \"in the style " +
  "of X\", \"photographed by X\"), and do NOT list fictional, mythological or religious characters. Answer JSON only: " +
  '{"people": {"<prompt number>": ["full name", …]}}, listing only prompts that name someone.';

async function ask(batch, tries = 3) {
  const user = batch.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, stream: false, format: "json", options: { temperature: 0 }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
  });
  const body = res.ok ? await res.json() : null;
  if (!body?.message) {
    if (tries <= 1) throw new Error(`ollama ${res.status}: ${JSON.stringify(body)?.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 3000));
    return ask(batch, tries - 1);
  }
  try {
    return Object.values(JSON.parse(body.message.content).people ?? {}).flat().map(String);
  } catch {
    return [];
  }
}

const prompts = JSON.parse(readFileSync(process.argv[2], "utf8"));
const existing = readFileSync(FILE, "utf8");
const known = new Set(existing.split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")));
const found = new Map();
for (let i = 0; i < prompts.length; i += BATCH) {
  const batch = prompts.slice(i, i + BATCH);
  for (const raw of await ask(batch)) {
    const name = raw.toLowerCase().replace(/\s+/g, " ").trim();
    // Only names the prompt actually holds (a model can "correct" spelling), and never one already listed.
    if (name.length < 3 || known.has(name) || !batch.some((p) => p.toLowerCase().includes(name))) continue;
    found.set(name, batch.find((p) => p.toLowerCase().includes(name)));
  }
  if ((i / BATCH) % 10 === 0) console.log(`${Math.min(i + BATCH, prompts.length)}/${prompts.length} checked, ${found.size} new names`);
}
for (const [name, prompt] of found) console.log(`${name}\t${prompt.slice(0, 120)}`);
console.log(`${found.size} names suggested; add the real people to scripts/data/prompt-people.txt by hand`);
