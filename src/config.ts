import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

export interface Session {
  token: string;
  refreshToken?: string;
  email?: string;
  roleId: string;
  companyId: string;
  expiresAt?: string;
}

export interface Keys {
  masterKey?: string;
}

const dir = (): string => {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const d = join(base, "rpl");
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
};

const authPath = () => join(dir(), "auth.json");
// ponytail: derived master key cached in plaintext (mode 600), same tradeoff the
// extension makes. Add OS-keychain storage if a stored-secret threat model demands it.
const keysPath = () => join(dir(), "keys.json");

const readJson = <T>(p: string): T | undefined =>
  existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : undefined;
const writeJson = (p: string, v: unknown): void =>
  writeFileSync(p, JSON.stringify(v, null, 2), { mode: 0o600 });

export const loadSession = (): Session | undefined => readJson<Session>(authPath());
export const saveSession = (s: Session): void => writeJson(authPath(), s);
export const loadKeys = (): Keys => readJson<Keys>(keysPath()) ?? {};
export const saveKeys = (k: Keys): void => writeJson(keysPath(), k);

export const requireSession = (): Session => {
  const s = loadSession();
  if (!s?.token) {
    throw new CliError("NOT_AUTHENTICATED", "No Rippling session. Run `rpl rpass auth import-extension`.", [
      "rpl rpass auth import-extension",
    ]);
  }
  return s;
};

export class CliError extends Error {
  constructor(
    public code: string,
    message: string,
    public nextSteps: string[] = [],
    public retryable = false,
  ) {
    super(message);
  }
}
