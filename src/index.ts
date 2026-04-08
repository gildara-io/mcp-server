#!/usr/bin/env node

/**
 * Gildara MCP Server
 *
 * Exposes your Gildara prompt vault to any MCP-compatible AI tool
 * (Claude Desktop, Cursor, Windsurf, etc.).
 *
 * Setup:
 *   1. npm install -g @gildara/mcp-server
 *   2. Add to your MCP config with your API key
 *   3. Your AI can now list, resolve, run, and create prompts
 *
 * Environment:
 *   GILDARA_API_KEY  — Your Gildara API key (pvk_...)
 *   GILDARA_BASE_URL — Optional: override the API base URL (default: https://gildara.io)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GildaraClient } from "./client.js";

// ── Initialize ───────────────────────────────────────────────────

const apiKey = process.env.GILDARA_API_KEY;
if (!apiKey) {
  console.error(
    "Error: GILDARA_API_KEY environment variable is required.\n" +
    "Get your API key at https://gildara.io/account\n" +
    "Then set it in your MCP configuration.",
  );
  process.exit(1);
}

const client = new GildaraClient({
  apiKey,
  baseUrl: process.env.GILDARA_BASE_URL,
});

const server = new McpServer({
  name: "gildara",
  version: "0.2.0",
});

// ── Tools ────────────────────────────────────────────────────────

server.tool(
  "list_prompts",
  "List all prompts in your Gildara vault. Returns titles, IDs, categories, and whether each has an operating contract enabled.",
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
              : "Your vault is empty. Create prompts at https://gildara.io or use the create_prompt tool.",
          },
        ],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
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
  "list_blueprints",
  "List all available agent blueprint templates. These are pre-built operating contracts for common agent types (code review, legal analysis, triage, etc.) that you can browse and use as starting points.",
  {},
  async () => {
    // Blueprints are static — we embed them rather than fetching from API
    const blueprints = [
      // Domain-specific
      { name: "Senior Engineer Code Review", desc: "Security-biased review focusing on vulnerabilities and scalability" },
      { name: "IP Risk Analysis", desc: "Structured IP risk assessment for software assets" },
      { name: "Contract Redline Checklist", desc: "Red flag checklist for indemnity, termination, liability" },
      { name: "Bug Triage & Priority Score", desc: "Severity/priority scoring for bug reports" },
      { name: "Requirements to User Stories", desc: "INVEST-compliant user story generation" },
      { name: "Product Spec Critique", desc: "Find holes in specs before implementation" },
      { name: "Incident Postmortem Draft", desc: "Blame-free postmortem with timeline and 5 Whys" },
      { name: "Competitive Teardown", desc: "Gap analysis against competitor releases" },
      { name: "Prompt Critic / Linter", desc: "Analyze and improve prompt clarity and reliability" },
      // Operator & launch
      { name: "Failure Mode Audit", desc: "Race conditions, retry storms, partial writes, silent failures" },
      { name: "Prelaunch Security Review", desc: "OWASP-style risks, tenant isolation, billing abuse" },
      { name: "Activation Funnel Diagnosis", desc: "Shortest path to first value, onboarding redesign" },
      { name: "Pricing Architecture Review", desc: "Pricing model, paywalls, expansion levers" },
      { name: "Support Ticket Predictor", desc: "Predict top 25 support issues before launch" },
      // High-demand agent use cases
      { name: "Code to Documentation", desc: "Generate README, API docs, architecture notes from code" },
      { name: "Refactor Planner", desc: "Safe, incremental refactoring plan with rollback steps" },
      { name: "Data Model Review", desc: "Schema review for scalability, query performance, integrity" },
      { name: "API Design Review", desc: "REST/GraphQL consistency, security, developer experience" },
      { name: "Email Sequence Writer", desc: "Multi-email onboarding, nurture, re-engagement sequences" },
      { name: "Landing Page Copywriter", desc: "Conversion-optimized hero, value props, CTAs" },
    ];
    const lines = blueprints.map((b) => `• **${b.name}** — ${b.desc}`);
    return {
      content: [{
        type: "text" as const,
        text: `${blueprints.length} Agent Blueprints available:\n\n${lines.join("\n")}\n\nBrowse and use these at https://gildara.io → Templates → Agent Blueprints`,
      }],
    };
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
