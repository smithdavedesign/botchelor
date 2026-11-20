#!/usr/bin/env node
/**
 * Registers the /date bot's two global slash commands, /date and /leaderboard (docs/discord.md "The /date bot").
 * Dave runs this by hand, once, and again only when a command's wording changes. Never in tests or CI.
 *
 *   DISCORD_APP_ID=<application id> DISCORD_BOT_TOKEN=<bot token> node scripts/discord/register-commands.mjs
 *   node scripts/discord/register-commands.mjs --dry     prints what it would send, sends nothing, needs no token
 *
 * The token comes from the environment only (paste it from the keychain into this one command), is sent only to
 * discord.com in the Authorization header, and is never printed. It is a bulk overwrite (PUT): these two become the app's
 * whole global command list. New global commands can take up to an hour to show in every server.
 */
const dry = process.argv.includes("--dry");

if (process.env.CI || process.env.VITEST || process.env.NODE_ENV === "test") {
  console.error("register-commands: not in CI or tests. Run it by hand.");
  process.exit(1);
}

// Must match lib/express-create.ts EXPRESS_TEXT_MIN / EXPRESS_TEXT_MAX (the bot checks again either way).
const TEXT_MIN = 8;
const TEXT_MAX = 280;

const GUILD_ONLY = { contexts: [0], integration_types: [0] };
const COMMANDS = [
  {
    name: "date",
    type: 1,
    description: "Send your character on a speed date with this season's cast. The server calls the ending.",
    options: [
      {
        type: 3,
        name: "description",
        description: "Your character in a sentence or two (an adult, your own, PG)",
        required: true,
        min_length: TEXT_MIN,
        max_length: TEXT_MAX,
      },
    ],
    ...GUILD_ONLY,
  },
  { name: "leaderboard", type: 1, description: "This server's best callers this month.", ...GUILD_ONLY },
];

const appId = (process.env.DISCORD_APP_ID ?? "").trim();
if (!/^\d{5,30}$/.test(appId)) {
  console.error("register-commands: set DISCORD_APP_ID to the application's id (Developer Portal → General Information).");
  process.exit(1);
}
const url = `https://discord.com/api/v10/applications/${appId}/commands`;

if (dry) {
  console.log(`PUT ${url}`);
  console.log(JSON.stringify(COMMANDS, null, 2));
  process.exit(0);
}

const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
if (!token || token === "CHANGE_ME") {
  console.error("register-commands: set DISCORD_BOT_TOKEN (Developer Portal → Bot → Reset Token) for this one command.");
  process.exit(1);
}

const res = await fetch(url, {
  method: "PUT",
  headers: { "content-type": "application/json", authorization: `Bot ${token}` },
  body: JSON.stringify(COMMANDS),
  redirect: "error",
  signal: AbortSignal.timeout(15_000),
});
if (!res.ok) {
  // The status and Discord's own error text: never the request, which carries the token.
  const text = (await res.text().catch(() => "")).slice(0, 500);
  console.error(`register-commands: Discord answered HTTP ${res.status}. ${text}`);
  process.exit(1);
}
const saved = await res.json();
console.log(`Registered ${saved.length} global command(s): ${saved.map((c) => `/${c.name}`).join(", ")}.`);
