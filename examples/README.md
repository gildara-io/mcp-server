# Reference agents

Standalone agents that consume Gildara Briefs (Gildara_Briefs v1).

## `gevorg-agent.js` — Codex CLI wrapper

A ~120-line Node.js sketch that:

1. Listens on Telegram for `BRIEF_READY brf_xxx` pings.
2. Filters by `ASSIGNEE_SLUG` so multiple agents in the same chat don't collide.
3. Fetches the brief over REST (which marks it `retrieved`).
4. Pipes `resolved_snapshot` to a local CLI executor (default: `codex --non-interactive`).
5. Posts a one-line completion notice back to the chat.

This is the **dogfood variant** — deliberately stripped of the HMAC pairing flow
(spec §3.9) and the SQLite idempotency ledger. Both restore cleanly when the
deferred features land. The full reference implementation is in the design
packet's section 2.

### Run it

```bash
npm i grammy

GILDARA_API_KEY=pvk_... \
TELEGRAM_TOKEN=... \
ASSIGNEE_SLUG=gevorg \
node gevorg-agent.js
```

### How the slug filter works

The Telegram ping format is fixed:

```
BRIEF_READY brf_a1b2c3d4
To: gevorg
Title: FTO research: polymer substrate
Classification: internal
View: https://gildara.io/briefs/brf_a1b2c3d4
```

When the agent reads this, it GETs the brief, checks
`brief.assignee_agent_slug === ASSIGNEE_SLUG`, and skips otherwise. Two agents
listening to the same chat just need different `ASSIGNEE_SLUG` env vars.

### Adapt to other executors

Replace `runCodex()` with anything that takes stdin and produces stdout — a
different CLI, a local LLM call, a subprocess chain. The Telegram plumbing
and Gildara plumbing don't change.

### What's deferred (intentional v0 cuts)

| Feature | Spec section | Status |
|---|---|---|
| HMAC signature verification | §3.9 | deferred — `nonce` field already on the wire |
| SQLite idempotency ledger | §2 | replaced with in-memory `Set` |
| Result submission (`POST /briefs/{id}/results`) | §3.6 | deferred — preview posted to chat instead |
| Multi-tenant agent registry | §3.9 | replaced by client-side slug filter |

Restore each as the corresponding endpoint ships.
