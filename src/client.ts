import { CliError, type Session } from "./config.ts";
import { decryptHex, decryptText, pbkdf2Hex, rsaUnwrapHex } from "./crypto.ts";

const API = "https://app.rippling.com/api";
const MK_ITERATIONS = 50000;

const versionOf = (encryptionVersion: unknown): 0 | 1 | 2 => {
  const v = Number(encryptionVersion);
  return v === 0 ? 0 : v === 1 ? 1 : 2;
};

export interface VaultItem {
  id: string;
  itemId?: string;
  name?: string;
  type?: string;
  hostname?: string;
  vault: "company" | "personal";
  username?: string;
  password?: string;
  totpSeed?: string;
  notes?: string;
}

export class RipplingClient {
  constructor(private session: Session) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.session.token}`,
      Role: this.session.roleId,
      Company: this.session.companyId,
      "login-agent": "rpass-extension",
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) {
      throw new CliError("TOKEN_EXPIRED", `Rippling rejected the token (${res.status}).`, [
        "rpl rpass auth import-extension",
      ]);
    }
    if (!res.ok) {
      throw new CliError("API_ERROR", `${method} ${path} failed (${res.status}).`, [], res.status >= 500);
    }
    return (await res.json()) as T;
  }

  // --- master key -----------------------------------------------------------

  /** Derive the role's master key from the master password (v2 server-salt flow). */
  async deriveMasterKey(password: string): Promise<string> {
    const salt = await this.req<string>("GET", "/rpass/api/role_settings/get_masterkey_salt");
    const k1 = await pbkdf2Hex(password, salt, MK_ITERATIONS, true);
    const resp = await this.req<{ password_hash?: string }>(
      "POST",
      "/rpass/api/role_settings/hash_with_server_token",
      { password_hash: k1, version: 2 },
    );
    if (!resp.password_hash) {
      throw new CliError("MK_SERVER_TOKEN", "hash_with_server_token returned no password_hash.");
    }
    return pbkdf2Hex(password, resp.password_hash, MK_ITERATIONS, true);
  }

  /** Server-held key that decrypts the extension's stored master key (no password). */
  getDecryptionKey(): Promise<string> {
    return this.req<string>("POST", "/rpass/api/role_settings/get_decryption_key");
  }

  // --- keys -----------------------------------------------------------------

  private async userPrivateKey(masterKey: string): Promise<{ privateKey: string }> {
    const keys = await this.req<any[]>("GET", `/rpass/api/user_keys/?role=${this.session.roleId}`);
    const uk = keys.find((k) => k.role === this.session.roleId) ?? keys[0];
    if (!uk) throw new CliError("NO_USER_KEY", "No user key for this role.");
    const privateKey = await decryptHex(uk.encryptedPrivateKey, uk.iv, masterKey);
    return { privateKey };
  }

  private async broadcastKey(privateKey: string): Promise<string> {
    const keys = await this.req<any[]>("GET", `/rpass/api/company_keys/?role=${this.session.roleId}`);
    const ck = keys.find((k) => k.role === this.session.roleId) ?? keys[0];
    if (!ck) throw new CliError("NO_BROADCAST_KEY", "No company broadcast key for this role.");
    return rsaUnwrapHex(ck.encryptedBroadcastKey, privateKey);
  }

  // --- items ----------------------------------------------------------------

  private static async decode(item: any, keyingKey: string, vault: VaultItem["vault"]): Promise<VaultItem> {
    const base: VaultItem = {
      id: item.id ?? item.itemId,
      itemId: item.itemId,
      name: item.name,
      type: item.type,
      hostname: item.hostname,
      vault,
    };
    if (item.itemKey === "SEED_ITEM_KEY") {
      const o = JSON.parse(item.encryptedData);
      return { ...base, username: o.username, password: o.password };
    }
    if (versionOf(item.encryptionVersion) < 1) return base; // legacy v0 not supported
    try {
      const itemKey = await decryptHex(item.itemKey, item.itemKeyIv, keyingKey);
      const payload = JSON.parse(await decryptText(item.encryptedData, item.iv, itemKey));
      return {
        ...base,
        username: payload.username,
        password: payload.password,
        totpSeed: payload.totpSeed,
        notes: payload.notes,
      };
    } catch {
      return base;
    }
  }

  async companyItems(masterKey: string): Promise<VaultItem[]> {
    const { privateKey } = await this.userPrivateKey(masterKey);
    const broadcast = await this.broadcastKey(privateKey);
    const items = await this.req<any[]>("GET", "/rpass/api/company_vault_items/");
    return Promise.all(items.map((i) => RipplingClient.decode(i, broadcast, "company")));
  }

  async personalItems(masterKey: string): Promise<VaultItem[]> {
    const items = await this.req<any[]>(
      "GET",
      `/rpass/api/personal_vault_items/?employee=${this.session.roleId}`,
    );
    return Promise.all(items.map((i) => RipplingClient.decode(i, masterKey, "personal")));
  }
}
