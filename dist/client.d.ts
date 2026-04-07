/**
 * Gildara API client for the MCP server.
 * All calls go through the public REST API at gildara.io/api/v1.
 */
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
        outputContract?: {
            enabled: boolean;
            format: string;
        };
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
export declare class GildaraClient {
    private apiKey;
    private baseUrl;
    constructor(options: GildaraClientOptions);
    private request;
    /** List all prompts in the user's vault. */
    listPrompts(): Promise<Prompt[]>;
    /** Get a single prompt by ID. */
    getPrompt(promptId: string): Promise<Prompt>;
    /**
     * Resolve a prompt — returns the compiled system prompt with operating
     * contract sections assembled. This is what agents should use.
     */
    resolvePrompt(promptId: string, options?: {
        channel?: "latest" | "stable";
        variables?: Record<string, string>;
    }): Promise<ResolvedPrompt>;
    /**
     * Run a prompt through AI with optional auto-repair.
     * Returns the AI response, validation results, and parsed output.
     */
    runPrompt(promptId: string, options?: {
        variables?: Record<string, string>;
        model?: string;
    }): Promise<RunResult>;
    /** Create a new prompt. */
    createPrompt(data: {
        title: string;
        content: string;
        description?: string;
        category?: string;
        variables?: string[];
    }): Promise<{
        promptId: string;
    }>;
    /** Check API connectivity and key validity. */
    ping(): Promise<{
        ok: boolean;
        userId?: string;
    }>;
}
//# sourceMappingURL=client.d.ts.map