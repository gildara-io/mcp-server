# Changelog

All notable changes to `@gildara/mcp-server` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## 0.8.0 — 2026-07-21

### Added

- **`get_account_link` tool** — returns the pairing code and `https://gildara.io/link?code=…` URL for linking this agent's vault to a human Gildara account. Previously the link code was printed only to stderr, which Claude Desktop / Cursor hide — the root cause of near-zero account linking (verified 2026-06-04: every auto-provisioned key had `lastUsedAt: null`). Tool responses are the channel users actually see. Checks live linked status first and answers accordingly, including for manually provided (`GILDARA_API_KEY`) keys. stdio-only: N/A on the HTTP MCP server, which authenticates via OAuth against an already-linked human account.
- **One-time link nudge.** When the server starts with an unlinked auto-provisioned key, a one-line notice pointing at `get_account_link` is appended to the first display-only discovery response (`list_prompts`, `search_prompts`, or `list_blueprints`) — never to stderr, never repeated. A best-effort startup check against `GET /api/v1/fleet` disarms the nudge (and remembers it in `~/.gildara/auto-key.json` as `linkedAt`) once the key is linked.

### Fixed

- **Auto-provision response parsing.** `POST /api/v1/provision` wraps its payload in `{ data: … }` (like every `/api/v1/*` route) with the pairing info nested at `data.link.{code,url}`, but the client read `api_key`/`link_code` at the top level — so first-run provisioning failed against current deployments and the link code was never captured or persisted. Both envelope shapes are now accepted, and the link URL is persisted to `~/.gildara/auto-key.json` alongside the code.
- **Machine-consumable tool response integrity.** The account-link nudge no longer mutates arbitrary successful tool responses. In particular, `resolve_prompt` now remains byte-for-byte unchanged so callers can safely pass its output verbatim to a model.

## 0.7.6 — 2026-06-04

### Fixed

- **`repository.url` now points at the live public repo.** The registry listing and `server.json` previously referenced `github.com/gildara/mcp-server` — an unrelated account with no such repo — so the "repository" link 404'd for everyone. It now points at `github.com/gildara-io/mcp-server` (the Gildara org's public repo). Added `repository`, `homepage`, and `bugs` fields to `package.json` so npmjs.com renders working links too (the published 0.7.5 npm package had none).

### Changed

- **Consolidated the registry listing onto the `io.gildara` namespace.** Versions 0.1.1–0.3.0 were published under `io.gildara/mcp-server` (DNS-verified against `gildara.io`), but the 0.7.5 registry submission used a second namespace, `io.github.Gildaraio/mcp-server`, leaving two competing server identities. 0.7.6 returns to `io.gildara/mcp-server` so the registry name matches the `gildara.io` domain and the `@gildara` npm scope; the `io.github.Gildaraio` line is superseded and should be deprecated. `package.json`'s `mcpName` is updated to match (required for the registry's npm-ownership check).

## 0.7.3 – 0.7.5 — 2026-05-13

Registry-submission line — published the MCP-registry listing (`io.github.Gildaraio/mcp-server`) and refined its metadata. No runtime tool changes.

### Changed

- **Repositioned around "operating contracts."** Description is now "Operating contracts for AI agents. Structured instructions compiled into system prompts."
- **Simplified the env-var schema.** `GILDARA_API_KEY` is declared optional (`required: false`) to match the auto-provisioning first-run flow, replacing the earlier required/secret declaration.

## 0.7.2 — 2026-04-22

### Added

- **`list_returned_briefs` tool** — inbox-style triage for the user. Lists briefs whose assigned agents have submitted results (`status=returned`), most recent first, with titles, agent handles, and return timestamps. Pairs with `get_brief_result(brief_id)` for pulling the full result text. Wraps the new `GET /api/v1/briefs?status=returned` REST endpoint.
- **`get_brief_result` tool** (shipped in 0.7.1 line, formally announced here) — fetches the result an agent submitted for a previously-dispatched Brief. Handles the pre-result waiting state explicitly ("not a result yet") so the calling LLM can tell the user instead of erroring.
- **`listBriefs()` client method** — generic list wrapper in `client.ts` with typed query params (`status`, `limit`, `cursor`) and typed response shape. Used internally by `list_returned_briefs`; available for any consumer that imports the client directly.

### Changed

- **`save_brief` tool description** now instructs the calling model NOT to write return-result instructions into the brief `body`. Gildara auto-appends a standardized "Returning your result" footer with the exact POST endpoint, brief_id, required scope, and request shape before freezing the snapshot. Keeps briefs focused on the WORK; the system handles the return contract.

### Fixed

- **Hardcoded version strings resynced.** The `0.7.1` release silently misreported itself as `0.7.0` in install telemetry for four days because `CLIENT_VERSION` (used in the `/api/v1/hello` ping) and the `User-Agent` header had both stayed at `"0.7.0"` while `package.json` moved to `0.7.1`. All four version strings (`package.json`, `CLIENT_VERSION`, `User-Agent`, `new McpServer({ version })`) now read `0.7.2`. Longer-term fix (generating a `version.ts` module at build time) is tracked in the project roadmap under Reliability & Infrastructure.

## 0.7.1 — 2026-04-18

**Editorial-only republish.** No code changes vs. 0.7.0.

### Fixed
- **CHANGELOG consolidation.** The published `0.7.0` tarball shipped with a split CHANGELOG that listed `0.6.1` as a separate release — but `0.6.1` was never actually published to npm (it was prep work that got folded into `0.7.0` before the publish). The `0.7.0` entry below is the consolidated version that accurately describes what shipped.
- **Screenshot filename in the CHANGELOG** now matches what's on GitHub (`4-17-26-mcp-tools-in-claude.png`). The `0.7.0` tarball referenced the undated filename.

If you're on `0.7.0`, upgrading to `0.7.1` is optional — the package contents (code, README, dist) are identical.

## 0.7.0 — 2026-04-17

First npm release since 0.6.0. Consolidates a documentation refresh and a new
`save_brief` tool that were developed in parallel and bundled for a single publish.

### Added

- **`save_brief` tool — dispatch instruction packets to agents via Telegram.** Call with `title`, `body`, and `assignee_agent_slug`; the MCP server creates a Brief (frozen instruction packet), looks up the assignee's registered Telegram bot handle in the **agents registry**, and ships the brief as a `.md` **file attachment** into the user's paired Telegram chat. The Telegram caption `@mention`s the target bot handle so a **single group chat can host an entire fleet** — each agent only picks up briefs addressed to it. Supports `classification` (public/internal/confidential), `notes_for_agent`, and `source_prompt_id` for lineage. Closes the "sketch in chat → agent on another box → result back in chat" loop in a single tool call.
- **Screenshot in the README** of Gildara's tools as they surface in Claude's Connectors settings. Referenced via absolute raw.githubusercontent URL so it renders on both GitHub and npmjs.com.
- **Client `User-Agent`** updated to `gildara-mcp-server/0.7.0`; the version string advertised through the MCP protocol handshake is `0.7.0`.

### Changed

- **README rewritten as a conversion surface.** Top-of-fold now leads with the value proposition, a one-line Claude Desktop config, the "no signup / no API key" close, and the screenshot. Detailed setup for Cursor, Windsurf, Claude Code, and Claude Chat moved below the first section. Maintainer-facing guidance retained in a "Contributing" section at the bottom.
- **Tool-count copy** in the README no longer hardcodes a number — it says "your Gildara tools appear in Claude's tool list" so future tool additions don't require README edits.
- **`prepublishOnly`** hook added to `package.json` — `tsc` runs before every publish so `dist/` can never fall behind `src/`.
- **`CHANGELOG.md`** is now included in the npm package `files` list, so the changelog is visible on the npmjs.com package page.

### Maintainer notes

- `save_brief` requires Gildara backend at v0.5+ (`POST /api/v1/briefs` endpoint and `briefs` / `agents` Firestore collections must be deployed on the target `GILDARA_BASE_URL`). Against older backends the tool returns a structured error.
- End-user prereqs for `save_brief`: one row in the `agents/` Firestore collection with `{ slug, telegramBotHandle }`, and a Telegram chat paired to the user's account via `/connect` in the bot DM.
- Stdio and HTTP MCP surfaces both ship `save_brief` at identical tool name and schema, per the MCP parity contract at [`docs/MCP_INTEGRATION_CONTRACT.md`](https://github.com/anaranillc/promptvault-ai-complete/blob/master/docs/MCP_INTEGRATION_CONTRACT.md).
- Agent-side integration recipe: [`docs/briefs/dogfood-rollout-v0.md`](https://github.com/anaranillc/promptvault-ai-complete/blob/master/docs/briefs/dogfood-rollout-v0.md).
- Version `0.6.1` appears in git history as a documentation-refresh prep step but was never published to npm — those changes are folded into this release.

## 0.6.0 — 2026-04

### Added
- **Auto-provisioning** on first run — the server provisions a free Gildara agent account and caches the API key at `~/.gildara/auto-key.json`. No manual `curl` required.
- **Install telemetry ping** to `/api/v1/hello` so the Gildara backend can attribute npm installs to new-user conversion.
- **Link code** printed to stderr on first-run provisioning so users can pair the auto-provisioned agent with their human Gildara account.
- **`search_prompts` tool** (semantic vector search over your vault).
- **Local-first prompt cache** at `~/.gildara/cache/` — agents stay functional if the Gildara API is briefly unreachable.

### Changed
- `get_prompt` response now includes operating-contract summary fields.

See [GitHub releases](https://github.com/anaranillc/promptvault-ai-complete/releases) for prior history.
