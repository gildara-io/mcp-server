# @gildara/mcp-server

MCP server for [Gildara](https://gildara.io) — bring your prompt vault into any AI tool.

## What it does

Connects your Gildara prompt library to Claude Desktop, Cursor, Windsurf, and any MCP-compatible tool. Your AI assistant can:

- **List prompts** — browse your vault
- **Resolve prompts** — get compiled system prompts with operating contracts assembled
- **Run prompts** — execute with auto-repair (JSON schema validation + retry)
- **Create prompts** — save new prompts from your AI session
- **Browse blueprints** — see pre-built agent templates

## Setup

### 1. Get your API key

Go to [gildara.io/account](https://gildara.io/account) and create an API key with the `agent-standard` preset.

### 2. Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "gildara": {
      "command": "npx",
      "args": ["-y", "@gildara/mcp-server"],
      "env": {
        "GILDARA_API_KEY": "pvk_your_key_here"
      }
    }
  }
}
```

### 3. Add to Cursor

Edit `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "gildara": {
      "command": "npx",
      "args": ["-y", "@gildara/mcp-server"],
      "env": {
        "GILDARA_API_KEY": "pvk_your_key_here"
      }
    }
  }
}
```

### 4. Add to Claude Code

```bash
claude mcp add gildara -- npx -y @gildara/mcp-server
```

Then set `GILDARA_API_KEY` in your environment.

## Tools

| Tool | Description |
|------|-------------|
| `list_prompts` | List all prompts in your vault |
| `get_prompt` | Get prompt details and operating contract config |
| `resolve_prompt` | Get compiled system prompt with contract sections |
| `run_prompt` | Run prompt through AI with auto-repair |
| `create_prompt` | Create a new prompt |
| `list_blueprints` | Browse agent blueprint templates |

## Example usage

Once connected, just tell your AI:

> "List my Gildara prompts"
> "Resolve my code-review-agent prompt with the code_diff variable"
> "Run the security-audit prompt against this code"
> "Save this prompt to my Gildara vault"

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GILDARA_API_KEY` | Yes | Your API key (`pvk_...`) |
| `GILDARA_BASE_URL` | No | Override API URL (default: `https://gildara.io`) |

## License

MIT
