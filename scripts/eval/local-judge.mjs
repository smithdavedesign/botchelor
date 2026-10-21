// The eval scripts' judge: a FREE local model through the ai-stack's LiteLLM (OpenAI-compatible, ~/ai-stack/README.md),
// never a paid or cloud one. It reads After Dark text, so nothing may leave this Mac. The safety check is the crowd
// brain's (#544, scripts/loop/crowd.mjs checkLocalAlias), copied here so the eval scripts don't import the loop's arena:
//   - the alias must be served only by Ollama deployments (ollama/ or ollama_chat/, not an Ollama cloud model) at a local
//     api_base, and be in no fallback list in the LiteLLM config (local-coder, for one, ends at paid Claude);
//   - the base URL must be this Mac (127.0.0.1 / localhost);
//   - every request says disable_fallbacks, and every answer's x-litellm-* headers must name a local Ollama deployment
//     (x-litellm-model-api-base is required), no attempted fallback and no cost, or the answer is thrown away and the judge
//     switches itself off for the rest of the run.
// local-uncensored (Dolphin-Mistral 7B, 16k context) reads After Dark scenes; local-qwen3 or local-chat suit dates.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_JUDGE_BASE = "http://127.0.0.1:4000/v1";
export const DEFAULT_LITELLM_CONFIG = join(homedir(), "ai-stack", "litellm", "config.yaml");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

/**
 * Why the judge can't be used, or why it stopped: the run refuses rather than judging on anything else. `fatal` means
 * the judge has switched itself off (an answer came from somewhere that isn't local), so no further call is made.
 */
export class LocalJudgeError extends Error {
  constructor(message, { fatal = false } = {}) {
    super(message);
    this.name = "LocalJudgeError";
    this.fatal = fatal;
  }
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
/** Whether a URL is this Mac (LiteLLM runs in Docker, so its Ollama api_base is host.docker.internal). */
export const isLocalUrl = (url) => LOCAL_HOSTS.has(hostOf(url));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Whether `alias` in a LiteLLM config (the YAML text) is safe to judge with: served only by Ollama on this Mac, with no
 * fallbacks that could reach a cloud or paid provider. Fails closed: anything it can't read is a refusal. (A copy of
 * scripts/loop/crowd.mjs checkLocalAlias, #544.)
 */
export function checkLocalAlias(configText, alias) {
  if (!alias || !/^[\w.:/-]+$/.test(alias)) return { ok: false, reason: `"${alias}" isn't a model alias` };
  const lines = String(configText ?? "")
    .split("\n")
    .map((l) => (/^\s*#/.test(l) ? "" : l.replace(/\s+#.*$/, "")));
  const esc = escapeRe(alias);
  const unquote = (v) => v.trim().replace(/^["']|["']$/g, "");
  // Its deployments in model_list (LiteLLM load-balances between every entry with the same model_name).
  const named = new RegExp(`^\\s*-\\s*model_name:\\s*["']?${esc}["']?\\s*$`);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    if (!named.test(lines[i])) continue;
    const entry = { model: null, api_base: null };
    const indent = lines[i].search(/\S/);
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) continue;
      if (l.search(/\S/) <= indent) break;
      const m = l.match(/^\s*(model|api_base):\s*(.+)$/);
      if (m) entry[m[1]] = unquote(m[2]);
    }
    entries.push(entry);
  }
  if (!entries.length) return { ok: false, reason: `${alias} isn't in the LiteLLM config` };
  for (const e of entries) {
    if (!e.model || !/^ollama(_chat)?\//.test(e.model)) return { ok: false, reason: `${alias} runs ${e.model ?? "an unknown model"}, not a local Ollama model` };
    if (/cloud/i.test(e.model)) return { ok: false, reason: `${alias} runs ${e.model}, an Ollama cloud model` };
    if (!e.api_base || !isLocalUrl(e.api_base)) return { ok: false, reason: `${alias} points at ${e.api_base ?? "no api_base"}, not this Mac` };
  }
  // A fallback list keyed by it (`- local-coder: [...]`, `{"local-coder": [...]}`), in any fallback setting.
  const keyed = new RegExp(`(^|[\\s{,\\[-])["']?${esc}["']?\\s*:\\s*(\\[|$)`);
  if (lines.some((l) => keyed.test(l) && !/model_name:/.test(l))) return { ok: false, reason: `${alias} has fallbacks in the LiteLLM config, which can reach a cloud model` };
  // default_fallbacks applies to every alias.
  const def = lines.find((l) => /^\s*default_fallbacks:/.test(l));
  if (def !== undefined && !/default_fallbacks:\s*\[\s*\]\s*$/.test(def)) return { ok: false, reason: "the LiteLLM config has default_fallbacks for every alias" };
  return { ok: true, reason: null, deployments: entries };
}

/**
 * Whether an answer came from a local deployment, by LiteLLM's response headers: x-litellm-model-api-base must be there
 * and be this Mac, x-litellm-model-name (when sent) an Ollama model, no fallback attempted, and nothing charged.
 */
export function checkLocalResponse(headers) {
  const get = (name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]) ?? null;
  const apiBase = get("x-litellm-model-api-base");
  const served = get("x-litellm-model-name");
  const fellBack = Number(get("x-litellm-attempted-fallbacks") ?? 0);
  const cost = Number(get("x-litellm-response-cost") ?? 0);
  if (!apiBase) return { ok: false, reason: "the answer didn't say which deployment wrote it (no x-litellm-model-api-base header)" };
  if (!isLocalUrl(apiBase)) return { ok: false, reason: `the answer came from ${apiBase}, not this Mac` };
  if (served && (!/^ollama(_chat)?\//.test(served) || /cloud/i.test(served))) return { ok: false, reason: `the answer came from ${served}, not a local Ollama model` };
  if (Number.isFinite(fellBack) && fellBack > 0) return { ok: false, reason: `LiteLLM tried ${fellBack} fallback${fellBack === 1 ? "" : "s"}` };
  if (Number.isFinite(cost) && cost > 0) return { ok: false, reason: `the answer cost $${cost}` };
  return { ok: true, reason: null };
}

/** The LiteLLM key: $LITELLM_MASTER_KEY, else the keychain's litellm-master-key, else ~/ai-stack/litellm/.env. Never printed. */
export function litellmKey(env = process.env) {
  if (env.LITELLM_MASTER_KEY) return env.LITELLM_MASTER_KEY;
  try {
    const k = execFileSync("security", ["find-generic-password", "-s", "litellm-master-key", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (k) return k;
  } catch {
    /* not in the keychain */
  }
  const file = join(homedir(), "ai-stack/litellm/.env");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("LITELLM_MASTER_KEY="));
  return line ? line.slice("LITELLM_MASTER_KEY=".length).trim() || null : null;
}

/**
 * A judge on a verified-local LiteLLM alias: `complete(messages)` resolves to the answer's text. Throws LocalJudgeError
 * when the alias, the base URL, the key or LiteLLM itself isn't right, before anything is sent.
 */
export async function createLocalJudge({
  baseUrl = DEFAULT_JUDGE_BASE,
  key = null,
  model,
  configText = null,
  configPath = DEFAULT_LITELLM_CONFIG,
  fetchImpl = globalThis.fetch,
  probeMs = 5_000,
  timeoutMs = 300_000,
} = {}) {
  const base = String(baseUrl).replace(/\/+$/, "");
  if (!isLocalUrl(base)) throw new LocalJudgeError(`the judge's LiteLLM base (${hostOf(base) || base}) isn't this Mac`);
  let text = configText;
  if (text == null) {
    try {
      text = readFileSync(configPath, "utf8");
    } catch {
      throw new LocalJudgeError(`can't read the LiteLLM config (${configPath}) to check that ${model} is local`);
    }
  }
  const check = checkLocalAlias(text, model);
  if (!check.ok) throw new LocalJudgeError(`judge model refused: ${check.reason}`);
  if (!key) throw new LocalJudgeError("no LiteLLM key ($LITELLM_MASTER_KEY, or the keychain's litellm-master-key)");
  let res;
  try {
    res = await fetchImpl(`${base}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(probeMs) });
  } catch {
    throw new LocalJudgeError(`LiteLLM isn't answering at ${base}: start the ai-stack, or pass --no-judge`);
  }
  if (res.status === 401 || res.status === 403) throw new LocalJudgeError("LiteLLM refused the key");
  if (!res.ok) throw new LocalJudgeError(`LiteLLM isn't answering at ${base} (HTTP ${res.status})`);
  const listed = ((await res.json().catch(() => null))?.data ?? []).map((m) => m?.id);
  if (!listed.includes(model)) throw new LocalJudgeError(`LiteLLM doesn't serve ${model}`);

  let off = null;
  return {
    model,
    /** One completion, checked to have come from a local deployment. */
    async complete(messages, { maxTokens = 700, temperature = 0.2 } = {}) {
      if (off) throw new LocalJudgeError(off, { fatal: true });
      let r;
      try {
        r = await fetchImpl(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false, disable_fallbacks: true }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
        throw new LocalJudgeError(timedOut ? `the judge gave no answer in ${Math.round(timeoutMs / 1000)}s` : `the judge's request failed: ${e?.message ?? e}`);
      }
      if (!r.ok) throw new LocalJudgeError(`LiteLLM answered HTTP ${r.status}`);
      const local = checkLocalResponse(r.headers);
      if (!local.ok) {
        off = `the judge switched itself off: ${local.reason}`;
        throw new LocalJudgeError(off, { fatal: true });
      }
      const body = await r.json().catch(() => null);
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new LocalJudgeError("the judge's answer had no text");
      return content;
    },
  };
}
