# Goal: `rpl` - a functional Rippling CLI with RPass support

Ship a TypeScript CLI, binary `rpl`, whose first vertical is the RPass password
manager: `rpl rpass <cmd>`. Built as a stable public API per the `cli-ts` skill
(Commander command tree, agent-friendly JSON output, packed-artifact verified).

## What it does

Pull RPass credentials from the terminal instead of the Chrome/Aside extension:

```
rpl rpass auth import-extension   # take the signed-in token from the browser extension store
rpl rpass auth status             # who am I, which role/company, token expiry
rpl rpass unlock                  # derive the master key (stored-key path, no password), or --password
rpl rpass list [--vault company|personal] [--query foo]
rpl rpass get <id|name> [--field password|username|totp] [--json]
rpl rpass totp <id|name>          # live TOTP code
```

## Reverse-engineered facts (RPass 5.2.6, ext id mobhfbcgjoleoljhpkkdhopdiemlocka)

- API base `https://app.rippling.com/api`. Headers: `Authorization: Bearer <token>`,
  `Role: <roleId>`, `Company: <companyId>`, `login-agent: rpass-extension`.
- Resource pattern `{prefix}{suffix}/` with prefix `/rpass/api/`:
  `user_keys`, `company_keys`, `company_vault_items`, `personal_vault_items`,
  `role_settings`, `vault_item_uses`. Account/roles at `/auth_ext/get_rpass_account_info/`.
- Client OAuth id `p2DQzfpGfic3aBA1mOsUi9SzUay0xHdPdKJ2XDiD`.
- Crypto is plain WebCrypto (Node can do it natively):
  - **Master key (v2, current):** `salt = GET role_settings/get_masterkey_salt`;
    `k1 = PBKDF2(pw, hex(salt), 50000, SHA-256)`;
    `resp = POST role_settings/hash_with_server_token {password_hash:k1, version:2}`;
    `masterKey = PBKDF2(pw, hex(resp.password_hash), 50000)`.
    (v0 = `PBKDF2(pw, utf16(email), 10000)`.)
  - **Stored-key unlock (no password):** encrypted MK lives in the extension store;
    `decKey = POST role_settings/get_decryption_key`;
    `masterKey = AES-256-GCM-decrypt(storedMk, iv=5844F1AC2FD465FD, key=decKey)`.
  - **User key:** RSA keypair; `privateKey = AES-GCM-decrypt(encryptedPrivateKey, iv, masterKey)`.
  - **Broadcast (company) key:** `broadcastKey = RSA-OAEP-SHA256 unwrap(encryptedBroadcastKey, privateKey)`.
  - **Item:** `itemKey = AES-GCM-decrypt(item.itemKey, item.itemKeyIv, keyingKey)`
    where keyingKey = broadcastKey (company) or masterKey (personal);
    `plaintext = AES-GCM-decrypt(item.encryptedData, item.iv, itemKey)` → JSON
    `{username,password,totpSeed,totpKey,notes,history}`. PBKDF2/AES inputs are hex;
    plaintext bytes are UTF-16LE. AES-GCM = 12-byte IV, 128-bit tag appended.

## Auth, two ways (as asked)

1. **Browser token (default, zero re-login):** read `access_token`, `refresh_token`,
   `email`, `role_id`, `company_id` from the extension's LevelDB store
   (`Aside/Chrome -> Local Extension Settings/<ext-id>`). `auth import-extension`.
2. **Direct token:** `auth token --token <t> --role <id> --company <id>` for CI.

Unlock (key derivation) is separate from auth: stored-key path needs only the token;
`--password` path needs the master password + two server round trips.

## Done =

- `npm run build` green, packed tarball installs in a temp prefix, every
  `rpl --help` / `rpl rpass --help` / `--version` / success / failure path runs.
- `auth`, `list`, `get`, `totp` work end-to-end against a live signed-in role.
- One self-check on the crypto primitives. JSON on stdout, errors on stderr, stable codes.

## Not in scope v1

Writes (create/edit/delete items), approvals/sharing, partner/spoof roles,
token refresh automation, non-Chromium browsers.
