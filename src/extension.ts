import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { ClassicLevel } from "classic-level";
import { CliError, type Session } from "./config.ts";

export const RPASS_EXT_ID = "mobhfbcgjoleoljhpkkdhopdiemlocka";

// macOS Chromium profile roots. Each holds `<Profile>/Local Extension Settings/<ext-id>`.
const browserRoots = (): string[] => {
  const app = join(homedir(), "Library", "Application Support");
  return [join(app, "Aside"), join(app, "Google", "Chrome"), join(app, "BraveSoftware", "Brave-Browser")];
};

const findStores = (): string[] => {
  const stores: string[] = [];
  for (const root of browserRoots()) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = join(root, entry.name, "Local Extension Settings", RPASS_EXT_ID);
      if (existsSync(p)) stores.push(p);
    }
  }
  return stores;
};

/** Read the extension's chrome.storage.local (LevelDB) from a snapshot copy. */
async function readStore(storePath: string): Promise<Record<string, unknown>> {
  const tmp = mkdtempSync(join(tmpdir(), "rpl-ext-"));
  try {
    cpSync(storePath, tmp, { recursive: true });
    const db = new ClassicLevel<string, string>(tmp, { createIfMissing: false });
    const out: Record<string, unknown> = {};
    try {
      for await (const [k, v] of db.iterator()) {
        try {
          out[k] = JSON.parse(v);
        } catch {
          out[k] = v;
        }
      }
    } finally {
      await db.close();
    }
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface ExtensionAuth {
  session: Session;
  encryptedMasterKeys?: unknown;
  storePath: string;
}

export async function importFromExtension(storePathArg?: string): Promise<ExtensionAuth> {
  const candidates = storePathArg ? [storePathArg] : findStores();
  if (candidates.length === 0) {
    throw new CliError("EXT_STORE_NOT_FOUND", "No RPass extension store found in Aside/Chrome/Brave.", [
      "Open the browser signed into Rippling, or pass --store <path>",
    ]);
  }
  if (candidates.length > 1 && !storePathArg) {
    throw new CliError(
      "EXT_STORE_AMBIGUOUS",
      `Multiple RPass stores found; pick one with --store:\n  ${candidates.join("\n  ")}`,
      candidates.map((c) => `rpl rpass auth import-extension --store "${c}"`),
    );
  }
  const storePath = candidates[0]!;
  const data = await readStore(storePath);
  const str = (k: string): string | undefined =>
    typeof data[k] === "string" ? (data[k] as string) : undefined;

  const token = str("access_token");
  const roleId = str("role_id");
  const companyId = str("company_id");
  if (!token || !roleId || !companyId) {
    throw new CliError("EXT_NOT_SIGNED_IN", "Extension store has no active session (sign into RPass first).", [
      "Open RPass in the browser and unlock it, then retry",
    ]);
  }
  return {
    session: {
      token,
      refreshToken: str("refresh_token"),
      email: str("email"),
      roleId,
      companyId,
      expiresAt: str("expires_at"),
    },
    encryptedMasterKeys: data["rpass-mk"] ?? data["master_key"],
    storePath,
  };
}
