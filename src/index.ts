#!/usr/bin/env node

/**
 * Gildara MCP Server (stdio transport)
 *
 * Exposes your Gildara prompt vault to any MCP-compatible AI tool
 * (Claude Desktop, Cursor, Windsurf, Claude Code CLI, etc.).
 *
 * ⚠️  PARITY REQUIRED with the HTTP MCP server at
 *     app/api/mcp/[transport]/route.ts (which Claude.ai connects to).
 *     If you add, remove, or change a tool here, do the same there in the
 *     same PR. Different tool sets = users silently lose features on one
 *     surface. See docs/MCP_INTEGRATION_CONTRACT.md for the checklist.
 *
 * Setup:
 *   1. Add to your MCP config (no manual API key required — the server
 *      auto-provisions an agent account on first run and caches the key
 *      at ~/.gildara/auto-key.json).
 *   2. Optionally set GILDARA_API_KEY to use an existing key instead.
 *   3. Your AI can now list, search, resolve, run, create, and memory-
 *      append prompts.
 *
 * Environment:
 *   GILDARA_API_KEY  — Optional: existing Gildara API key (pvk_...).
 *                      If unset, the server auto-provisions on first run.
 *   GILDARA_BASE_URL — Optional: override the API base URL
 *                      (default: https://gildara.io)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GildaraClient } from "./client.js";
import { loadOrProvisionKey, AUTO_KEY_FILE } from "./autoProvision.js";

// ── Initialize ───────────────────────────────────────────────────

const baseUrl = (process.env.GILDARA_BASE_URL || "https://gildara.io").replace(/\/$/, "");

let keyRecord;
try {
  keyRecord = await loadOrProvisionKey(baseUrl);
} catch (err: any) {
  console.error(
    "Error: could not obtain a Gildara API key.\n\n" +
    `Reason: ${err?.message || err}\n\n` +
    "Fallback: provision a key manually and set GILDARA_API_KEY in your MCP config:\n" +
    `  curl -X POST ${baseUrl}/api/v1/provision -H "Content-Type: application/json" -d '{"agent_label":"my-agent"}'\n` +
    "Or get one at https://gildara.io/account if you already have an account.",
  );
  process.exit(1);
}

const apiKey = keyRecord.apiKey;

// Surface first-run provisioning prominently so the user can pair the
// agent to their human account. Goes to stderr — stdout is the MCP
// protocol stream and must stay clean.
if (keyRecord.source === "provisioned") {
  console.error(
    `[Gildara] Auto-provisioned a new agent account on first run.\n` +
    `  API key saved to: ${AUTO_KEY_FILE}\n` +
    `  Key prefix: ${apiKey.slice(0, 8)}...\n` +
    (keyRecord.linkCode
      ? `  Link code: ${keyRecord.linkCode}\n` +
        `  Pair this agent with your account at: ${baseUrl.replace(/\/api\/?$/, "")}/link?code=${keyRecord.linkCode}\n`
      : "") +
    `  Tier: free (10 prompts, 20 API calls/day). Upgrade: ${baseUrl}/pricing`,
  );
} else if (keyRecord.source === "file") {
  console.error(`[Gildara] Using cached auto-provisioned key from ${AUTO_KEY_FILE}`);
}

const client = new GildaraClient({
  apiKey,
  baseUrl: process.env.GILDARA_BASE_URL,
});

const server = new McpServer({
  name: "gildara",
  version: "0.7.2",
});

// ── Tools ────────────────────────────────────────────────────────

server.tool(
  "list_prompts",
  "List all prompts in your Gildara vault. Returns titles, IDs, categories, and whether each has an operating contract enabled. Use search_prompts instead when you want to find prompts by topic or concept rather than listing everything.",
  {},
  async () => {
    try {
      const prompts = await client.listPrompts();
      const lines = prompts.map((p) => {
        const contract = p.operatingContract?.enabled ? " ⚡contract" : "";
        return `${p.promptId} — ${p.title} [${p.category}]${contract}`;
      });
      return {
        content: [
          {
            type: "text" as const,
            text: prompts.length > 0
              ? `Found ${prompts.length} prompts:\n\n${lines.join("\n")}`
              : "Your vault is empty. Use the create_prompt tool to add prompts, or browse templates with list_blueprints.",
          },
        ],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  "search_prompts",
  "Search your Gildara vault semantically by meaning, not just keywords. Returns the most relevant prompts for a natural-language query (e.g. 'reviewing code for security issues', 'summarizing customer feedback'). Ranked by vector similarity over title, description, category, tags, and content. Use this first before list_prompts when looking for a prompt that matches a concept.",
  {
    query: z.string().describe("Natural-language search query describing what you're looking for"),
    limit: z.number().int().min(1).max(50).optional().describe("Max results to return (default 10)"),
  },
  async ({ query, limit }) => {
    try {
      const results = await client.searchPrompts(query, limit || 10);
      if (results.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No prompts found matching "${query}". Your vault may be empty, or the new prompts may still be indexing (embeddings generate asynchronously after creation). Try list_prompts to see all prompts.`,
          }],
        };
      }
      const lines = results.map((p, i) => {
        const score = typeof p.distance === "number" ? ` (distance ${p.distance.toFixed(3)})` : "";
        const contract = p.operatingContract?.enabled ? " ⚡contract" : "";
        return `${i + 1}. ${p.promptId} — ${p.title} [${p.category}]${contract}${score}`;
      });
      return {
        content: [{
          type: "text" as const,
          text: `Top ${results.length} prompts matching "${query}":\n\n${lines.join("\n")}\n\nUse get_prompt <id> or resolve_prompt <id> to fetch details.`,
        }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Search error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  "get_prompt",
  "Get details of a specific prompt including its content, variables, tags, and operating contract configuration.",
  { promptId: z.string().describe("The prompt ID to retrieve") },
  async ({ promptId }) => {
    try {
      const prompt = await client.getPrompt(promptId);
      const details = [
        `**${prompt.title}**`,
        `ID: ${prompt.promptId}`,
        `Category: ${prompt.category}`,
        `Description: ${prompt.description || "(none)"}`,
        `Variables: ${prompt.variables.length > 0 ? prompt.variables.join(", ") : "none"}`,
        `Tags: ${prompt.tags.length > 0 ? prompt.tags.join(", ") : "none"}`,
        `Contract: ${prompt.operatingContract?.enabled ? "enabled" : "disabled"}`,
      ];
      if (prompt.operatingContract?.enabled) {
        details.push(`  Role: ${prompt.operatingContract.roleMission || "(not set)"}`);
        details.push(`  Tools: ${prompt.operatingContract.allowedTools?.join(", ") || "none"}`);
        details.push(`  Output: ${prompt.operatingContract.outputContract?.format || "text"}`);
      }
      details.push(`Updated: ${prompt.updatedAt}`);
      return { content: [{ type: "text" as const, text: details.join("\n") }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  "resolve_prompt",
  "Resolve a prompt into its compiled system prompt, with operating contract sections assembled (role, tools, stop conditions, output schema). This is what you should pass as the system prompt to an AI model. Supports variable substitution and channel selection (latest/stable).",
  {
    promptId: z.string().describe("The prompt ID to resolve"),
    channel: z.string().optional().describe("Version channel: 'latest' (default) or 'stable'"),
    variables: z.string().optional().describe("JSON object of variables to substitute, e.g. '{\"code_diff\": \"...\", \"author\": \"Alice\"}'"),
  },
  async ({ promptId, channel, variables }) => {
    try {
      const parsedVars = variables ? JSON.parse(variables) as Record<string, string> : undefined;
      const resolvedChannel = (channel === "stable" ? "stable" : "latest") as "latest" | "stable";
      const resolved = await client.resolvePrompt(promptId, { channel: resolvedChannel, variables: parsedVars });
      const header = [
        `**${resolved.title}** (${resolved.channel} channel, version ${resolved.version})`,
      ];
      if (resolved.outputContract?.enabled) {
        header.push(`Output contract: ${resolved.outputContract.format}${resolved.outputContract.jsonSchema ? " (schema provided)" : ""}`);
      }
      header.push("", "---", "");
      return {
        content: [{ type: "text" as const, text: header.join("\n") + resolved.compiled }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  "run_prompt",
  "Run a prompt through AI with automatic output validation and auto-repair. If the prompt has an output contract (JSON schema), the response is validated and automatically retried with a repair prompt on failure. Returns the AI response, parsed JSON (if applicable), and validation metadata.",
  {
    promptId: z.string().describe("The prompt ID to run"),
    variables: z.string().optional().describe("JSON object of variables, e.g. '{\"key\": \"value\"}'"),
    model: z.string().optional().describe("Model to use (default: gemini-flash-latest)"),
  },
  async ({ promptId, variables, model }) => {
    try {
      const parsedVars = variables ? JSON.parse(variables) as Record<string, string> : undefined;
      const result = await client.runPrompt(promptId, { variables: parsedVars, model });
      const meta = [
        `Run ID: ${result.runId}`,
        `Tokens: ${result.tokensIn} in / ${result.tokensOut} out`,
        `Latency: ${result.latencyMs}ms`,
      ];
      if (result.validation) {
        meta.push(`Validation: ${result.validation.valid ? "✓ valid" : "✗ invalid"}`);
        meta.push(`Attempts: ${result.validation.attempts}`);
        if (result.validation.repaired) meta.push("(auto-repaired)");
        if (result.validation.errors.length > 0) {
          meta.push(`Errors: ${result.validation.errors.join("; ")}`);
        }
      }
      const parts: Array<{ type: "text"; text: string }> = [
        { type: "text" as const, text: meta.join("\n") + "\n\n---\n\n" + result.response },
      ];
      if (result.parsed) {
        parts.push({
          type: "text" as const,
          text: "\n\nParsed output:\n```json\n" + JSON.stringify(result.parsed, null, 2) + "\n```",
        });
      }
      return { content: parts };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  "create_prompt",
  "Create a new prompt in your Gildara vault. Returns the new prompt ID which you can then use with resolve_prompt or run_prompt.",
  {
    title: z.string().describe("Prompt title"),
    content: z.string().describe("The prompt content (supports {{variables}})"),
    description: z.string().optional().describe("Brief description of what this prompt does"),
    category: z.string().optional().describe("Category (e.g. Engineering, Legal, Ops)"),
  },
  async ({ title, content, description, category }) => {
    try {
      const result = await client.createPrompt({ title, content, description, category });
      return {
        content: [{
          type: "text" as const,
          text: `Prompt created!\n\nID: ${result.promptId}\nTitle: ${title}\n\nUse resolve_prompt or run_prompt with this ID.`,
        }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  "append_memory",
  "Append content to an existing prompt or memory. Creates a new version with the appended content added to the end. Use this for accumulating memories, adding context, or building up a prompt incrementally. The category 'memory' is recommended for user context that should be portable across AI tools.",
  {
    promptId: z.string().describe("The prompt ID to append to"),
    content: z.string().describe("Content to append"),
    separator: z.string().optional().describe("Separator between existing and new content (default: newline)"),
  },
  async ({ promptId, content, separator }) => {
    try {
      const result = await client.appendToPrompt(promptId, content, separator);
      return {
        content: [{
          type: "text" as const,
          text: `Appended to ${promptId} (v${result.versionNumber}, ${result.totalLength} chars total)`,
        }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  "list_blueprints",
  "List all available agent blueprint templates. These are pre-built operating contracts for common agent types (code review, legal analysis, triage, etc.) that you can browse and use as starting points. Supports search by keyword or category.",
  {
    query: z.string().optional().describe("Search keyword to filter blueprints"),
    category: z.string().optional().describe("Filter by category (e.g. Engineering, Research, Security)"),
  },
  async ({ query, category }) => {
    try {
      // Fetch live from API — always up to date, no hardcoding
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      const baseUrl = (process.env.GILDARA_BASE_URL || "https://gildara.io").replace(/\/$/, "");
      const url = `${baseUrl}/api/v1/blueprints${params.toString() ? "?" + params.toString() : ""}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`API returned ${resp.status}`);
      const json = await resp.json();
      const items = json.data?.items || [];
      if (items.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: query || category
              ? `No blueprints found matching ${query ? `"${query}"` : ""} ${category ? `in category "${category}"` : ""}. Try a different search or browse all with list_blueprints (no arguments).`
              : "No blueprints available.",
          }],
        };
      }
      const lines = items.map((b: any) =>
        `• **${b.name}** [${b.category}] — ${b.description}${b.variables.length > 0 ? ` (vars: ${b.variables.join(", ")})` : ""}`
      );
      const cats = json.data?.filters?.categories || [];
      return {
        content: [{
          type: "text" as const,
          text: `${items.length} blueprints${query ? ` matching "${query}"` : ""}${category ? ` in ${category}` : ""}:\n\n${lines.join("\n")}\n\n` +
            `Categories: ${cats.join(", ")}\n\n` +
            `Use get_prompt on a blueprint ID to see full content, or create_prompt to save one to your vault.`,
        }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error fetching blueprints: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  "save_brief",
  "Create a Brief in Gildara and dispatch it to a named agent. " +
    "Use this when the user has described a unit of work and wants an agent to execute it — " +
    "phrases like 'send this to [agent]', 'have [agent] do this', 'dispatch this', " +
    "'save a brief for [agent]', or 'queue this up for [agent]'. " +
    "The Brief is created from the conversation content, dispatched immediately, " +
    "and a Telegram ping is sent to the user's connected chat. The agent (running on the user's box) " +
    "filters by assignee_agent_slug and processes only briefs addressed to it. " +
    "Returns the brief_id and a deep link. Does NOT wait for the agent to execute — the result " +
    "arrives asynchronously via the agent's own channels (or the user can check the deep link).\n\n" +
    "Compose the body in the SECOND PERSON addressing the agent (e.g. 'You are running an FTO analysis on...'). " +
    "Include everything the agent needs — it does NOT have access to this conversation. " +
    "End with a clear statement of the expected output. " +
    "Default classification is 'internal'; only set 'confidential' if the user explicitly flags it.\n\n" +
    "Do NOT write return-result instructions in the body — Gildara automatically " +
    "appends a 'Returning your result' footer with the exact POST endpoint, brief_id, " +
    "required scope, and payload shape before the snapshot is frozen. Focus your body " +
    "on the WORK; the system handles the return contract.",
  {
    title: z.string().describe("Short human-readable label, ≤200 chars. Example: 'FTO research: polymer substrate'."),
    body: z.string().describe(
      "The full rendered brief text the agent will execute against. This is the FROZEN snapshot — " +
      "whatever you write here is what the agent sees verbatim. Markdown supported. ≤50,000 chars.",
    ),
    assignee_agent_slug: z.string().describe(
      "Lowercase slug of the agent the user wants this dispatched to (e.g. 'gevorg', 'research-bot'). " +
      "Ask the user if ambiguous.",
    ),
    classification: z.enum(["public", "internal", "confidential"]).optional().describe(
      "Content sensitivity. Defaults to 'internal'. Escalate to 'confidential' only on explicit user signal.",
    ),
    notes_for_agent: z.string().optional().describe(
      "Freeform out-of-band instructions to the agent (e.g. 'dry-run first', 'do not email the client yet'). Not part of the prompt body.",
    ),
    source_prompt_id: z.string().optional().describe(
      "If the brief is derived from a saved Prompt, pass its ID for lineage. Omit for conversation-derived briefs.",
    ),
  },
  async ({ title, body, assignee_agent_slug, classification, notes_for_agent, source_prompt_id }) => {
    try {
      const result = await client.saveBrief({
        title,
        body,
        assigneeAgentSlug: assignee_agent_slug,
        classification,
        notesForAgent: notes_for_agent,
        sourcePromptId: source_prompt_id,
      });
      const lines = [
        `Brief dispatched: ${result.brief_id}`,
        `Assignee: ${result.assignee_agent_slug}`,
        `View: ${result.deep_link}`,
      ];
      if (result.telegram_ping.sent) {
        lines.push(`Telegram ping sent — ${result.assignee_agent_slug}'s agent will pick this up.`);
      } else {
        const reason = result.telegram_ping.reason || 'unknown';
        if (reason === 'no_telegram_chat_connected') {
          lines.push(
            `⚠️ Brief saved but no Telegram chat is connected — the agent won't be notified automatically. ` +
            `Pair Telegram at ${baseUrl}/account, or open the deep link to retrieve manually.`,
          );
        } else {
          lines.push(`⚠️ Telegram ping failed (${reason}). Brief saved; the agent can still GET it directly.`);
        }
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error saving brief: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  "list_returned_briefs",
  "List briefs that have results returned from their agents (status='returned'), " +
    "most recent first. Use when the user asks 'what results are waiting for me?', " +
    "'any agent responses?', 'show me completed briefs', 'what did my agents send back?'. " +
    "Returns summaries (title, agent, returned time) — use get_brief_result(brief_id) " +
    "to fetch the actual result text for a specific brief.",
  {
    limit: z.number().int().min(1).max(50).optional().describe("Max briefs to return (default 20, max 50)"),
  },
  async ({ limit }) => {
    try {
      const pageSize = Math.min(limit || 20, 50);
      const res = await client.listBriefs({ status: 'returned', limit: pageSize });
      const items = res.items || [];
      if (items.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No briefs with returned results. Agents that have completed assigned work will appear here; if you are expecting a response, check the brief's status (it may still be `dispatched` or `retrieved`).",
          }],
        };
      }
      const lines: string[] = [`${items.length} brief${items.length === 1 ? '' : 's'} with returned results:`, ''];
      for (const b of items) {
        const when = typeof b.result_submitted_at === 'string'
          ? b.result_submitted_at.slice(0, 16).replace('T', ' ') + ' UTC'
          : '?';
        lines.push(`• ${b.title || '(untitled)'} — from @${b.assignee_agent_slug || 'unknown'} at ${when}`);
        lines.push(`  ID: ${b.brief_id}`);
      }
      lines.push('');
      lines.push('Use get_brief_result(brief_id) to read any of these in full.');
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error listing briefs: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  "get_brief_result",
  "Fetch the result an agent submitted for a previously-dispatched Brief. " +
    "Use when the user asks 'what did [agent] say about [brief]?', 'show me the result', " +
    "'did gevorg respond yet?', or references a brief_id like 'brf_xxxxxxxx'. " +
    "Typical flow: the user got a Telegram DM saying '📬 Gevorg returned a result for brf_xxx' and " +
    "now wants to see the content. Returns null-equivalent text if the result hasn't arrived yet — " +
    "that's a valid state, not an error.",
  {
    briefId: z.string().describe("Brief ID in format 'brf_xxxxxxxx' (8 hex chars). Ask the user if unclear."),
  },
  async ({ briefId }) => {
    try {
      const d = await client.getBrief(briefId);
      const lines: string[] = [
        `Brief: ${d.title}`,
        `ID: ${d.brief_id}`,
        `Assignee: ${d.assignee_agent_slug}`,
        `Status: ${d.status}`,
        '',
      ];
      if (d.result) {
        lines.push('— Result —');
        lines.push(d.result);
        if (d.result_url) {
          lines.push('');
          lines.push(`Artifact URL: ${d.result_url}`);
        }
        if (d.result_submitted_at) {
          lines.push('');
          lines.push(`Submitted: ${d.result_submitted_at}`);
        }
      } else if (d.status === 'dispatched' || d.status === 'retrieved') {
        lines.push(
          `No result yet. The brief is in status '${d.status}' — the agent has ` +
            `${d.status === 'retrieved' ? 'picked it up but not finished' : 'not picked it up yet'}. ` +
            `Check again later. You'll get a Telegram DM when the agent submits a result.`,
        );
      } else if (d.status === 'blocked') {
        lines.push("The agent marked this brief as blocked (couldn't complete the task). No result was submitted.");
      } else {
        lines.push(`Brief is in status '${d.status}'. No result text available.`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error fetching brief result: ${e.message}` }], isError: true };
    }
  },
);

// ── Start ────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start Gildara MCP server:", error);
  process.exit(1);
});
