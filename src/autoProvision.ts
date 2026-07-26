/**
 * Auto-provisioning for the Gildara MCP server.
 *
 * Fallback chain for locating an API key at startup:
 *   1. process.env.GILDARA_API_KEY   (always wins if set)
 *   2. ~/.gildara/auto-key.json      (remembered from previous auto-provision)
 *   3. POST /api/v1/provision        (first-run path — self-provisions a new
 *                                     agent account and saves the key locally)
 *
 * The goal is zero-curl onboarding: user drops the server into their Claude
 * config without setting GILDARA_API_KEY and it just works on first run.
 * The linkCode returned from provision is logged to stderr so the human can
 * pair the agent to their own account later at gildara.io/link.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";

const AUTO_KEY_FILE = join(homedir(), ".gildara", "auto-key.json");
const AUTO_KEY_DIR = join(homedir(), ".gildara");

export interface AutoKeyRecord {
  apiKey: string;
  userId?: string;
  linkCode?: string;
  /** Full pairing URL (https://gildara.io/link?code=…) from the provision response. */
  linkUrl?: string;
  /** Set once we observe the key linked to a human account — suppresses the link nudge. */
  linkedAt?: string;
  agentLabel?: string;
  createdAt: string;
  /** Which fallback tier produced this key. */
  source: "env" | "file" | "provisioned";
}

function readAutoKeyFile(): AutoKeyRecord | null {
  if (!existsSync(AUTO_KEY_FILE)) return null;
  try {
    const raw = readFileSync(AUTO_KEY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.apiKey === "string" && parsed.apiKey.startsWith("pvk_")) {
      return { ...parsed, source: "file" } as AutoKeyRecord;
    }
    return null;
  } catch {
    return null;
  }
}

function writeAutoKeyFile(record: AutoKeyRecord): void {
  if (!existsSync(AUTO_KEY_DIR)) {
    mkdirSync(AUTO_KEY_DIR, { recursive: true });
  }
  const payload = JSON.stringify(record, null, 2);
  writeFileSync(AUTO_KEY_FILE, payload, { encoding: "utf-8" });
  // Best-effort: 0600 on POSIX. No-op on Windows (chmod is advisory there).
  if (platform() !== "win32") {
    try {
      chmodSync(AUTO_KEY_FILE, 0o600);
    } catch {
      /* non-fatal */
    }
  }
}

async function provisionNewAccount(baseUrl: string): Promise<AutoKeyRecord> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/provision`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_label: "auto-provisioned-mcp",
      profile: {
        agentMeta: {
          platform: "mcp-auto-provision",
          capabilities: ["prompt-vault"],
        },
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Auto-provision failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  const json = await res.json();
  // The provision endpoint wraps its payload in `{ data: … }` like every
  // /api/v1/* route; older deployments returned the object bare. Accept both
  // — reading only the top level here is why early auto-provisions never
  // captured the link code.
  const data = json?.data ?? json;
  const apiKey = data.api_key || data.apiKey;
  if (typeof apiKey !== "string" || !apiKey.startsWith("pvk_")) {
    throw new Error(
      `Auto-provision returned unexpected payload (no pvk_ key): ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return {
    apiKey,
    userId: data.account_id || data.accountId || data.user_id || data.userId,
    linkCode: data.link?.code || data.link_code || data.linkCode,
    linkUrl: data.link?.url,
    agentLabel: "auto-provisioned-mcp",
    createdAt: new Date().toISOString(),
    source: "provisioned",
  };
}

/**
 * Resolve an API key at MCP server startup, walking the env → file → provision
 * fallback chain. Throws on unrecoverable errors (e.g., provision network
 * failure with no cached key); caller should surface a clean error to stderr
 * and exit.
 */
export async function loadOrProvisionKey(
  baseUrl: string,
): Promise<AutoKeyRecord> {
  // 1. Env always wins.
  const envKey = process.env.GILDARA_API_KEY;
  if (envKey) {
    if (!envKey.startsWith("pvk_")) {
      throw new Error(
        `GILDARA_API_KEY is set but does not look valid (must start with "pvk_"). Got: "${envKey.slice(0, 10)}..."`,
      );
    }
    return {
      apiKey: envKey,
      createdAt: new Date().toISOString(),
      source: "env",
    };
  }

  // 2. Local cache file.
  const cached = readAutoKeyFile();
  if (cached) return cached;

  // 3. First-run auto-provision.
  const record = await provisionNewAccount(baseUrl);
  writeAutoKeyFile(record);
  return record;
}

/**
 * Persist the linked state to the cached key file so future sessions skip the
 * link nudge without a network call. No-op for env-provided keys (nothing on
 * disk to update) or when the file has been removed.
 */
export function markKeyLinked(): void {
  const cached = readAutoKeyFile();
  if (!cached || cached.linkedAt) return;
  writeAutoKeyFile({ ...cached, linkedAt: new Date().toISOString() });
}

export { AUTO_KEY_FILE };
