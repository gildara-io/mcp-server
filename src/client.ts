/**
 * Gildara API client for the MCP server.
 * All calls go through the public REST API at gildara.io/api/v1.
 *
 * Local-first caching: resolved prompts are cached to disk. If the API
 * is unreachable, the cache serves as fallback. This eliminates the
 * single-point-of-failure concern for production agent workflows.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DEFAULT_BASE_URL = "https://gildara.io";

// ── Local cache ─────────────────────────────────────────────────

const CACHE_DIR = join(homedir(), ".gildara", "cache");

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheKey(path: string): string {
  return path.replace(/[^a-zA-Z0-9-]/g, "_");
}

function writeCache(path: string, data: unknown): void {
  try {
    ensureCacheDir();
    const file = join(CACHE_DIR, cacheKey(path) + ".json");
    writeFileSync(file, JSON.stringify({ cachedAt: new Date().toISOString(), data }));
  } catch {
    // Cache write failure is non-critical
  }
}

function readCache<T>(path: string): T | null {
  try {
    const file = join(CACHE_DIR, cacheKey(path) + ".json");
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    return raw.data as T;
  } catch {
    return null;
  }
}

export interface GildaraClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface Prompt {
  promptId: string;
  title: string;
  description: string;
  category: string;
  content?: string;
  variables: string[];
  tags: string[];
  currentVersionId: string;
  isArchived: boolean;
  operatingContract?: {
    enabled: boolean;
    roleMission?: string;
    allowedTools?: string[];
    outputContract?: { enabled: boolean; format: string };
  };
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedPrompt {
  promptId: string;
  title: string;
  channel: string;
  version: string;
  compiled: string;
  raw: string;
  outputContract?: {
    enabled: boolean;
    format: string;
    jsonSchema?: string;
  };
}

export interface RunResult {
  runId: string;
  response: string;
  parsed?: unknown;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  validation?: {
    valid: boolean;
    errors: string[];
    attempts: number;
    repaired: boolean;
  };
}

// Client version — kept in sync with package.json manually. The MCP server
// runs as a bundled .js file at end-user install time, so we can't require()
// package.json without it showing up in the dist output.
const CLIENT_VERSION = "0.8.0";

export class GildaraClient {
  private apiKey: string;
  private baseUrl: string;
  private hasPinged = false;

  constructor(options: GildaraClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  /**
   * Fire-and-forget install telemetry ping. Runs once per client instance
   * (i.e. once per MCP server process / session) after the first successful
   * API call. Gives the server a real "daily active MCP clients" signal
   * independent of npm download stats.
   */
  private sendHelloIfFirstSuccess(): void {
    if (this.hasPinged) return;
    this.hasPinged = true;

    // Don't await; don't block the hot path.
    fetch(`${this.baseUrl}/api/v1/hello`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: "@gildara/mcp-server",
        version: CLIENT_VERSION,
        platform: process.platform,
        nodeVersion: process.version,
      }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      // Silent — telemetry failures must never affect user workflows.
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { cacheable?: boolean },
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
      "User-Agent": "gildara-mcp-server/0.8.0",
    };

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After") || "unknown";
          throw new Error(
            `Gildara API rate limit exceeded (429). Retry after: ${retryAfter}. ` +
            `Consider upgrading your plan for higher limits at https://gildara.io/pricing`,
          );
        }
        const text = await res.text().catch(() => "Unknown error");
        throw new Error(`Gildara API ${method} ${path} failed (${res.status}): ${text}`);
      }

      const json = await res.json();
      const data = json.data ?? json;

      // Cache successful GET responses for offline fallback
      if (options?.cacheable && method === "GET") {
        writeCache(path, data);
      }

      // First successful call per session — send install telemetry ping.
      this.sendHelloIfFirstSuccess();

      return data as T;
    } catch (error) {
      // On network failure, try local cache for GET requests
      if (options?.cacheable && method === "GET") {
        const cached = readCache<T>(path);
        if (cached) {
          console.error(`[Gildara] API unreachable, serving from local cache: ${path}`);
          return cached;
        }
      }
      throw error;
    }
  }

  /** List all prompts in the user's vault. Cached locally for offline fallback. */
  async listPrompts(): Promise<Prompt[]> {
    const result = await this.request<{ items: Prompt[] }>("GET", "/prompts?limit=100", undefined, { cacheable: true });
    return result.items || [];
  }

  /**
   * Semantic search over the user's vault. Uses Gemini embeddings +
   * Firestore vector similarity. Returns prompts ranked by relevance.
   */
  async searchPrompts(
    query: string,
    limit: number = 10,
  ): Promise<{ items: Array<Prompt & { distance?: number }>; mode: "semantic" | "keyword" }> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const result = await this.request<{
      items: Array<Prompt & { distance?: number }>;
      query: string;
      mode?: "semantic" | "keyword";
    }>("GET", `/prompts/search?${params.toString()}`);
    // `mode` is absent on deployments predating the keyword fallback; those
    // only ever served semantic results, so that is the safe assumption.
    return { items: result.items || [], mode: result.mode === "keyword" ? "keyword" : "semantic" };
  }

  /** Get a single prompt by ID. Cached locally for offline fallback. */
  async getPrompt(promptId: string): Promise<Prompt> {
    return this.request<Prompt>("GET", `/prompts/${promptId}`, undefined, { cacheable: true });
  }

  /**
   * Resolve a prompt — returns the compiled system prompt with operating
   * contract sections assembled. This is what agents should use.
   * Cached locally for offline fallback.
   */
  async resolvePrompt(
    promptId: string,
    options?: { channel?: "latest" | "stable"; variables?: Record<string, string> },
  ): Promise<ResolvedPrompt> {
    const params = new URLSearchParams();
    if (options?.channel) params.set("channel", options.channel);
    if (options?.variables) params.set("variables", JSON.stringify(options.variables));
    const qs = params.toString();
    return this.request<ResolvedPrompt>(
      "GET",
      `/prompts/${promptId}/resolve${qs ? `?${qs}` : ""}`,
      undefined,
      { cacheable: true },
    );
  }

  /**
   * Run a prompt through AI with optional auto-repair.
   * Returns the AI response, validation results, and parsed output.
   */
  async runPrompt(
    promptId: string,
    options?: { variables?: Record<string, string>; model?: string },
  ): Promise<RunResult> {
    return this.request<RunResult>("POST", `/prompts/${promptId}/run`, {
      variables: options?.variables || {},
      model: options?.model,
    });
  }

  /** Create a new prompt. */
  async createPrompt(data: {
    title: string;
    content: string;
    description?: string;
    category?: string;
    variables?: string[];
  }): Promise<{ promptId: string }> {
    return this.request<{ promptId: string }>("POST", "/prompts", data);
  }

  /** Append content to an existing prompt (creates a new version). */
  async appendToPrompt(
    promptId: string,
    content: string,
    separator?: string,
  ): Promise<{ promptId: string; versionId: string; versionNumber: number; totalLength: number }> {
    const body: Record<string, string> = { content };
    if (separator) body.separator = separator;
    return this.request<{ promptId: string; versionId: string; versionNumber: number; totalLength: number }>(
      "POST",
      `/prompts/${promptId}/append`,
      body,
    );
  }

  /**
   * Create + dispatch a Brief in one call. The body is frozen verbatim
   * as the agent's instruction packet — what the calling model produces
   * here is what the agent sees. Returns immediately after dispatch; does
   * NOT wait for the agent to acknowledge or execute.
   */
  async saveBrief(input: {
    title: string;
    body: string;
    assigneeAgentSlug: string;
    classification?: 'public' | 'internal' | 'confidential';
    notesForAgent?: string;
    sourcePromptId?: string;
    variables?: Record<string, string>;
  }): Promise<{
    brief_id: string;
    status: string;
    assignee_agent_slug: string;
    dispatch_channel: string;
    deep_link: string;
    dispatched_at: string;
    telegram_ping: { sent: boolean; chatId?: string; reason?: string };
  }> {
    return this.request("POST", "/briefs", {
      title: input.title,
      body: input.body,
      assignee_agent_slug: input.assigneeAgentSlug,
      classification: input.classification,
      notes_for_agent: input.notesForAgent,
      source_prompt_id: input.sourcePromptId,
      variables: input.variables,
    });
  }

  /**
   * Fetch a brief by ID, including the result (if the assigned agent has
   * submitted one). For briefs still in 'dispatched' or 'retrieved' status,
   * the `result` field is null — that's a normal pre-result state, not an
   * error. The calling model should tell the user "no response yet."
   */
  async getBrief(briefId: string): Promise<{
    brief_id: string;
    owner_id: string;
    title: string;
    resolved_snapshot: string;
    assignee_agent_slug: string;
    classification: string;
    notes_for_agent: string;
    source_prompt_id: string | null;
    variables: Record<string, string> | null;
    status: string;
    nonce: string;
    dispatched_at: string;
    retrieved_at: string | null;
    result: string | null;
    result_url: string | null;
    result_submitted_at: string | null;
  }> {
    return this.request("GET", `/briefs/${briefId}`);
  }

  /**
   * List the caller's briefs, filtered + paginated.
   * Status filter supports a single value only (v0 — multi-status → multiple
   * queries, can layer on later). Cursor is the `createdAt` ISO timestamp of
   * the last item from the previous page.
   */
  async listBriefs(params: {
    status?: 'draft' | 'dispatched' | 'retrieved' | 'returned' | 'blocked';
    limit?: number;
    cursor?: string;
  }): Promise<{
    items: Array<{
      brief_id: string;
      title: string;
      assignee_agent_slug: string;
      classification: string;
      status: string;
      source_prompt_id: string | null;
      created_at: string | null;
      dispatched_at: string | null;
      retrieved_at: string | null;
      result_submitted_at: string | null;
    }>;
    cursor: string | null;
    hasMore: boolean;
  }> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.request('GET', `/briefs${suffix}`);
  }

  /**
   * Whether this key's agent account is linked to a human Gildara account.
   * GET /fleet returns `linked: false` for an unlinked agent and the owner's
   * fleet (with `linked: true`) once paired.
   */
  async getFleetStatus(): Promise<{ linked?: boolean; message?: string }> {
    return this.request("GET", "/fleet");
  }

  /** Check API connectivity and key validity. */
  async ping(): Promise<{ ok: boolean; userId?: string }> {
    try {
      await this.listPrompts();
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  }
}
