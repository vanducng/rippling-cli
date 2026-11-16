# rippling-cli (`rpl`)

[![ci](https://github.com/vanducng/rippling-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/vanducng/rippling-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/rippling-cli.svg)](https://www.npmjs.com/package/rippling-cli)

Get your Rippling RPass passwords and TOTP codes from the terminal.

> Unofficial. Not affiliated with Rippling. Use it on your own account, within
> your employer's policy.

## Install

Needs Node.js 20+.

```bash
npm install -g rippling-cli
# or
pnpm add -g rippling-cli
# or
bun add -g rippling-cli
```

This gives you the `rpl` command.

## Use

```bash
rpl rpass auth import-extension     # reuse your signed-in RPass browser extension
rpl rpass unlock                    # enter your RPass master password once
rpl rpass list --query github
rpl rpass get github.com --field password
rpl rpass totp github.com
```

`import-extension` finds the RPass extension in Aside, Chrome, or Brave. If more
than one profile is signed in, pick one with `--store <path>`.

For scripts, set `RPL_MASTER_PASSWORD` instead of typing it, or use
`rpl rpass auth token --token <t> --role <id> --company <id>`.

Output is JSON. `--field` prints just the value, for piping. Errors go to stderr
with a `code` and a non-zero exit.

Everything is decrypted locally. The session and key are saved under
`~/.config/rpl` (mode `600`).

## Develop

```bash
npm install
npm test
npm run build
```

## License

MIT
