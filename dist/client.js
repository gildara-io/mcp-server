/**
 * Gildara API client for the MCP server.
 * All calls go through the public REST API at gildara.io/api/v1.
 */
const DEFAULT_BASE_URL = "https://gildara.io";
export class GildaraClient {
    apiKey;
    baseUrl;
    constructor(options) {
        this.apiKey = options.apiKey;
        this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    }
    async request(method, path, body) {
        const url = `${this.baseUrl}/api/v1${path}`;
        const headers = {
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
                throw new Error(`Gildara API rate limit exceeded (429). Retry after: ${retryAfter}. ` +
                    `Consider upgrading your plan for higher limits at https://gildara.io/pricing`);
            }
            const text = await res.text().catch(() => "Unknown error");
            throw new Error(`Gildara API ${method} ${path} failed (${res.status}): ${text}`);
        }
        const json = await res.json();
        return json.data ?? json;
    }
    /** List all prompts in the user's vault. */
    async listPrompts() {
        const result = await this.request("GET", "/prompts?limit=100");
        return result.prompts || [];
    }
    /** Get a single prompt by ID. */
    async getPrompt(promptId) {
        return this.request("GET", `/prompts/${promptId}`);
    }
    /**
     * Resolve a prompt — returns the compiled system prompt with operating
     * contract sections assembled. This is what agents should use.
     */
    async resolvePrompt(promptId, options) {
        const params = new URLSearchParams();
        if (options?.channel)
            params.set("channel", options.channel);
        if (options?.variables)
            params.set("variables", JSON.stringify(options.variables));
        const qs = params.toString();
        return this.request("GET", `/prompts/${promptId}/resolve${qs ? `?${qs}` : ""}`);
    }
    /**
     * Run a prompt through AI with optional auto-repair.
     * Returns the AI response, validation results, and parsed output.
     */
    async runPrompt(promptId, options) {
        return this.request("POST", `/prompts/${promptId}/run`, {
            variables: options?.variables || {},
            model: options?.model,
        });
    }
    /** Create a new prompt. */
    async createPrompt(data) {
        return this.request("POST", "/prompts", data);
    }
    /** Check API connectivity and key validity. */
    async ping() {
        try {
            await this.listPrompts();
            return { ok: true };
        }
        catch (e) {
            return { ok: false };
        }
    }
}
//# sourceMappingURL=client.js.map