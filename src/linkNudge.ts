export const ACCOUNT_LINK_NUDGE =
  "\nNote: this vault is not linked to a human Gildara account yet — run the get_account_link tool to get the pairing link (unlocks the web UI and sync across your devices).";

// These responses are intended for discovery/display, not to be passed through
// verbatim to another model or machine consumer.
const NUDGE_SAFE_TOOLS = new Set([
  "list_prompts",
  "search_prompts",
  "list_blueprints",
]);

interface ToolContent {
  type: string;
  [key: string]: unknown;
}

export interface ToolResult {
  isError?: boolean;
  content?: ToolContent[];
  [key: string]: unknown;
}

export interface NudgeOutcome<T extends ToolResult> {
  result: T;
  consumed: boolean;
}

/**
 * Add the one-time account-link reminder only to display-only discovery tools.
 *
 * Machine-consumable responses such as `resolve_prompt` must remain exactly
 * unchanged because callers may pass their content verbatim to another model.
 * Calling `get_account_link` consumes the reminder without duplicating it.
 */
export function applyAccountLinkNudge<T extends ToolResult>(
  toolName: string,
  result: T,
): NudgeOutcome<T> {
  if (result.isError || !Array.isArray(result.content)) {
    return { result, consumed: false };
  }

  if (toolName === "get_account_link") {
    return { result, consumed: true };
  }

  if (!NUDGE_SAFE_TOOLS.has(toolName)) {
    return { result, consumed: false };
  }

  return {
    result: {
      ...result,
      content: [
        ...result.content,
        { type: "text", text: ACCOUNT_LINK_NUDGE },
      ],
    },
    consumed: true,
  };
}
