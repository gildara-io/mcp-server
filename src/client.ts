/**
 * Gildara API client for the MCP server.
 * All calls go through the public REST API at gildara.io/api/v1.
 */

const DEFAULT_BASE_URL = "https://gildara.io";

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

export class GildaraClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(options: GildaraClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
      "User-Agent": "gildara-mcp-server/0.1.0",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
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
    return json.data ?? json;
  }

  /** List all prompts in the user's vault. */
  async listPrompts(): Promise<Prompt[]> {
    const result = await this.request<{ prompts: Prompt[] }>("GET", "/prompts?limit=100");
    return result.prompts || [];
  }

  /** Get a single prompt by ID. */
  async getPrompt(promptId: string): Promise<Prompt> {
    return this.request<Prompt>("GET", `/prompts/${promptId}`);
  }

  /**
   * Resolve a prompt — returns the compiled system prompt with operating
   * contract sections assembled. This is what agents should use.
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
