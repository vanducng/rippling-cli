# rippling-cli (`rpl`)

A terminal client for Rippling, starting with **RPass** - pull your password-manager
credentials without opening the browser extension.

> Unofficial. Not affiliated with or endorsed by Rippling. Use against your own
> account, within your employer's policy. Credentials stay on your machine.

## Install

```bash
npm install
npm run build
npm link        # exposes `rpl`
```

## Quick start

```bash
# 1. Auth - reuse the session from the signed-in browser RPass extension
rpl rpass auth import-extension
rpl rpass auth status

# 2. Unlock - derive the master key (prompts, or RPL_MASTER_PASSWORD)
rpl rpass unlock

# 3. Use
rpl rpass list --query github
rpl rpass get github.com --field password
rpl rpass totp github.com
```

## Authentication

Auth (identity) and unlock (decryption) are separate.

- **Browser token (default):** `auth import-extension` reads `access_token`,
  `role_id`, and `company_id` from the extension's local store in Aside / Chrome /
  Brave. No re-login.
- **Direct token (CI):** `auth token --token <t> --role <id> --company <id>`.

Unlock derives the role's master key from your master password via Rippling's
server-salt flow, then caches it (mode `600`) under `$XDG_CONFIG_HOME/rpl`. All
item decryption (user key → company broadcast key → item key → payload) runs
locally with WebCrypto.

## Output contract

Machine commands print one JSON value to stdout; errors print one JSON object to
stderr with a stable `code`, `retryable`, and `next_steps`, and exit non-zero.
`--field` prints the raw value only, for piping.

## Scope

v1 is read-only: `auth`, `unlock`, `list`, `get`, `totp`. No writes, sharing, or
partner/spoof roles. See [GOAL.md](./GOAL.md) for the design and the
reverse-engineered RPass crypto model.

## Develop

```bash
npm run dev -- rpass list   # tsx, no build
npm test                    # crypto self-checks
npm run typecheck
```

## License

MIT
