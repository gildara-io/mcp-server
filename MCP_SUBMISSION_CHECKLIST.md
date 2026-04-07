# MCP Server Submission Checklist

Step-by-step guide to listing `@gildara/mcp-server` on all major MCP directories.

---

## Prerequisites (Do These First)

- [ ] **Publish to npm**: `cd mcp-server && npm publish --access public`
  - Requires npm account with `@gildara` org scope
  - Verify: `npx -y @gildara/mcp-server` works from a clean machine
- [ ] **Push to GitHub**: Ensure `github.com/gildara/mcp-server` (or wherever the repo lives) is public
- [ ] **Create GitHub release**: Tag `v0.1.0`, attach built dist artifacts
- [ ] **Build Docker image**: `cd mcp-server && docker build -t gildara/mcp-server:0.1.0 .`
  - Verify: `docker run -e GILDARA_API_KEY=pvk_test gildara/mcp-server:0.1.0`

---

## 1. Official MCP Registry (registry.modelcontextprotocol.io)

**Priority**: Highest — feeds Claude Desktop + Claude Code discovery

- [ ] Clone `https://github.com/modelcontextprotocol/registry`
- [ ] Run `make publisher` to build the `mcp-publisher` CLI
- [ ] Authenticate: `./bin/mcp-publisher auth github` (if using `io.github.{user}` namespace) or verify domain ownership for `io.gildara` namespace
- [ ] Validate manifest: `./bin/mcp-publisher validate server.json`
- [ ] Publish: `./bin/mcp-publisher publish server.json`
- [ ] Verify: Check `https://registry.modelcontextprotocol.io/servers/io.gildara/mcp-server`

**Config file**: `server.json` (already created)

---

## 2. Glama.ai (glama.ai/mcp/servers)

**Priority**: High — required prerequisite for awesome-mcp-servers PR

- [ ] Go to `https://glama.ai/mcp/servers`
- [ ] Click "Add Server"
- [ ] Enter GitHub repo URL
- [ ] Wait for Glama to index and scan the server
- [ ] Claim the server listing (sign in with GitHub)
- [ ] Verify score badge works: `https://glama.ai/mcp/servers/{owner}/{repo}/badges/score.svg`

---

## 3. punkpeye/awesome-mcp-servers (84K stars)

**Priority**: High — #1 community list, top Google result

**Prerequisite**: Must be listed on Glama first (step 2)

- [ ] Fork `https://github.com/punkpeye/awesome-mcp-servers`
- [ ] Add entry to the appropriate category in README.md:
  ```markdown
  - [Gildara](https://github.com/gildara/mcp-server) [<img src="https://glama.ai/mcp/servers/{owner}/{repo}/badges/score.svg" alt="Gildara MCP server" />](https://glama.ai/mcp/servers/{owner}/{repo}) - Connect AI tools to your prompt vault with operating contracts, auto-repair, and variable substitution. :robot:
  ```
- [ ] Include Glama link right after the GitHub link
- [ ] Add at least one emoji tag from their Legend section
- [ ] Open PR with title: "Add Gildara MCP server"
- [ ] PRs without Glama link are auto-closed after 7 days

---

## 4. Docker MCP Registry (Docker Desktop catalog)

**Priority**: High — enterprise reach

- [ ] Fork `https://github.com/docker/mcp-registry`
- [ ] Follow their CONTRIBUTING guide
- [ ] Submit PR with server metadata
  - Docker can build, sign, and publish the image to `mcp/gildara` on Docker Hub
  - Or provide pre-built image `gildara/mcp-server:0.1.0`
- [ ] Approved servers appear in Docker Desktop MCP Toolkit within 24 hours

**Config file**: `Dockerfile` (already created)

---

## 5. Smithery.ai (6K+ servers)

**Priority**: Medium

- [ ] Ensure `smithery.yaml` is committed to repo root (already created, in `mcp-server/`)
- [ ] Option A (CLI): `npx smithery mcp publish {github-url} -n gildara/mcp-server`
- [ ] Option B (Web): Go to `https://smithery.ai/new`, sign in, submit repo URL
- [ ] Verify listing at `https://smithery.ai/server/gildara/mcp-server`

**Config file**: `smithery.yaml` (already created)

---

## 6. Cursor Marketplace (76K+ devs)

**Priority**: Medium — requires plugin packaging

- [ ] Review plugin spec at `https://github.com/cursor/plugins`
- [ ] Package MCP server as a Cursor plugin bundle
- [ ] Publish at `https://cursor.com/marketplace/publish`
- [ ] Users get one-click install from Cursor marketplace

---

## 7. mcp.so (19K+ servers)

**Priority**: Low — easy submit

- [ ] Go to `https://github.com/chatmcp/mcpso`
- [ ] Open a GitHub issue with:
  - Server name: Gildara
  - Description: Connect AI tools to your prompt vault with operating contracts
  - GitHub URL: (repo url)
  - npm package: `@gildara/mcp-server`
- [ ] Or use the Submit button on `https://mcp.so`

---

## 8. PulseMCP (11K+ servers)

**Priority**: Low — easy submit

- [ ] Go to `https://www.pulsemcp.com/use-cases/submit`
- [ ] Fill in the form with server details
- [ ] Appears in their daily-updated directory

---

## 9. mcpservers.org (3K+ servers)

**Priority**: Low — easy submit

- [ ] Go to `https://mcpservers.org/submit`
- [ ] Fill in the form

---

## Post-Submission Tracking

| Directory | Submitted | Listed | URL |
|-----------|-----------|--------|-----|
| Official MCP Registry | | | |
| Glama.ai | | | |
| awesome-mcp-servers | | | |
| Docker MCP Registry | | | |
| Smithery.ai | | | |
| Cursor Marketplace | | | |
| mcp.so | | | |
| PulseMCP | | | |
| mcpservers.org | | | |
