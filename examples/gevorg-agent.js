// gevorg-agent.js
// Reference standalone agent that receives Gildara Briefs over Telegram,
// runs them through a local CLI executor (Codex by default), and prints
// the result back to the same Telegram chat.
//
// This is the DOGFOOD VARIANT of the spec's reference agent. It deliberately
// strips two things that are deferred in v0:
//
//   1. HMAC signature verification.  Gildara_Briefs §3.9 (pairing flow with
//      hmac_secret exchange) is not implemented in v0. The brief carries a
//      `nonce` field for forward-compat but no signature to verify yet.
//      When pairing lands, restore the verifySignature() call from the
//      design packet's reference sketch.
//
//   2. SQLite idempotency ledger. Replaced with an in-memory Set — sufficient
//      for a single-process operator. Restore better-sqlite3 if you want
//      cross-restart dedupe.
//
// What this DOES implement:
//   - Listens on Telegram for messages matching `BRIEF_READY brf_xxx`.
//   - Filters by ASSIGNEE_SLUG so multiple agents in one chat don't collide.
//   - Fetches the brief over REST, marking it retrieved on first GET.
//   - Pipes the resolved_snapshot to a local CLI (default: `codex`).
//   - Posts a one-line completion notice back to the same chat. The actual
//     output is left in stdout/stderr — wire up POST /briefs/{id}/results
//     in PR #2 when the spec's §3.6 endpoint exists.
//
// Usage:
//   GILDARA_API_KEY=pvk_... \
//   TELEGRAM_TOKEN=... \
//   ASSIGNEE_SLUG=gevorg \
//   node gevorg-agent.js
//
// Dependencies:
//   npm i grammy

import { Bot } from 'grammy';
import { spawn } from 'node:child_process';

const {
  TELEGRAM_TOKEN,
  GILDARA_API_KEY,
  GILDARA_BASE = 'https://gildara.io/api/v1',
  ASSIGNEE_SLUG,
  CODEX_CMD = 'codex',
} = process.env;

if (!TELEGRAM_TOKEN || !GILDARA_API_KEY || !ASSIGNEE_SLUG) {
  console.error('Missing required env: TELEGRAM_TOKEN, GILDARA_API_KEY, ASSIGNEE_SLUG');
  process.exit(1);
}

// In-memory dedupe ledger: (briefId, nonce) tuple → seen.
// Cheap and correct for a single-process operator. Cross-restart dedupe
// requires SQLite — see the spec's reference for that variant.
const seen = new Set();
const seenKey = (briefId, nonce) => `${briefId}|${nonce}`;

const headers = {
  'X-API-Key': GILDARA_API_KEY,
  'Content-Type': 'application/json',
};

async function getBrief(briefId) {
  const r = await fetch(`${GILDARA_BASE}/briefs/${briefId}`, { headers });
  if (!r.ok) throw new Error(`getBrief ${r.status}: ${await r.text()}`);
  const json = await r.json();
  return json.data;
}

function runCodex(snapshot) {
  return new Promise((resolve) => {
    const child = spawn(CODEX_CMD, ['--non-interactive'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      // Graceful: return whatever we got, even on non-zero exit.
      resolve({ ok: code === 0, output: out, error: err, exit: code });
    });
    child.on('error', (e) => {
      resolve({ ok: false, output: '', error: `spawn failed: ${e.message}`, exit: -1 });
    });
    child.stdin.write(snapshot);
    child.stdin.end();
  });
}

const bot = new Bot(TELEGRAM_TOKEN);

bot.on('message:text', async (ctx) => {
  // Parse `BRIEF_READY brf_xxx` from the first line.
  // The dispatch ping format is part of the public contract — see
  // lib/briefs.ts buildBriefPing() and gildara docs §1.
  const match = ctx.message.text.match(/^BRIEF_READY (brf_[a-z0-9]+)/i);
  if (!match) return;
  const briefId = match[1];

  try {
    const brief = await getBrief(briefId);

    // Slug filter — replaces the spec's pairing/registry feature for v0.
    // If two agents share a chat, each picks up only its own briefs.
    if (brief.assignee_agent_slug !== ASSIGNEE_SLUG) {
      return; // not for me
    }

    // Idempotency check — Telegram occasionally redelivers, and a manual
    // re-fetch shouldn't re-execute the work.
    const key = seenKey(brief.brief_id, brief.nonce);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    await ctx.reply(`Picked up ${briefId} (${brief.title}). Running...`);

    const { ok, output, error, exit } = await runCodex(brief.resolved_snapshot);

    if (ok && output.trim()) {
      // Telegram caps at 4096 chars — truncate the preview, full output is
      // in the agent's stdout. POST /briefs/{id}/results is the right home
      // for the full result; that endpoint lands in PR #2.
      const preview = output.length > 3500 ? output.slice(0, 3500) + '\n...[truncated]' : output;
      await ctx.reply(`Brief ${briefId} complete:\n\n${preview}`);
    } else if (output.trim() || error.trim()) {
      const preview = (output || error).slice(0, 3500);
      await ctx.reply(`Brief ${briefId} partial (exit ${exit}):\n\n${preview}`);
    } else {
      await ctx.reply(`Brief ${briefId} ran but produced no output (exit ${exit}).`);
    }
  } catch (e) {
    await ctx.reply(`Error processing ${briefId}: ${e.message}`);
  }
});

bot.start();
console.log(`Gevorg agent running. Slug: ${ASSIGNEE_SLUG}. Listening for briefs...`);
