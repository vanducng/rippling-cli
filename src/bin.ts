import { Command } from "commander";
import { createInterface } from "node:readline";
import { CliError, loadKeys, loadSession, requireSession, saveKeys, saveSession } from "./config.ts";
import { importFromExtension } from "./extension.ts";
import { RipplingClient, type VaultItem } from "./client.ts";
import { totp } from "./totp.ts";
import pkg from "../package.json" with { type: "json" };

const out = (v: unknown): void => console.log(JSON.stringify(v, null, 2));
const fail = (e: unknown): never => {
  const err =
    e instanceof CliError
      ? e
      : new CliError("UNEXPECTED", e instanceof Error ? e.message : String(e), [], false);
  console.error(JSON.stringify({ error: { code: err.code, message: err.message, retryable: err.retryable, next_steps: err.nextSteps } }, null, 2));
  process.exitCode = 1;
  return undefined as never;
};
const run = (fn: () => Promise<void>): void => void fn().catch(fail);

async function promptHidden(label: string): Promise<string> {
  const env = process.env.RPL_MASTER_PASSWORD;
  if (env) return env;
  if (!process.stdin.isTTY) {
    throw new CliError("NO_PASSWORD", "No TTY to prompt for the master password.", [
      "Set RPL_MASTER_PASSWORD or pass --password",
    ]);
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  // readline echoes typed keys through this private hook; mute everything but the prompt.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
    if (s.includes(label)) process.stderr.write(s);
  };
  try {
    return await new Promise<string>((resolve, reject) => {
      rl.on("close", () => reject(new CliError("NO_PASSWORD", "Prompt closed before a password was entered.")));
      rl.question(`${label}: `, resolve);
    });
  } finally {
    rl.close();
    process.stderr.write("\n");
  }
}

const match = (items: VaultItem[], q: string): VaultItem[] => {
  const needle = q.toLowerCase();
  const exact = items.filter((i) => i.id === q || i.itemId === q);
  if (exact.length) return exact;
  return items.filter((i) =>
    [i.name, i.hostname, i.username].some((f) => f?.toLowerCase().includes(needle)),
  );
};

const loadMasterKey = (): string => {
  const mk = loadKeys().masterKey;
  if (!mk) throw new CliError("LOCKED", "Vault is locked. Run `rpl rpass unlock`.", ["rpl rpass unlock"]);
  return mk;
};

const allItems = async (client: RipplingClient, vault: string, mk: string): Promise<VaultItem[]> => {
  const parts: VaultItem[] = [];
  if (vault !== "personal") parts.push(...(await client.companyItems(mk)));
  if (vault !== "company") parts.push(...(await client.personalItems(mk)));
  return parts;
};

const program = new Command();
program.name("rpl").description("Rippling CLI").version(pkg.version);

const rpass = program.command("rpass").description("RPass password manager");

const auth = rpass.command("auth").description("Authentication");

auth
  .command("import-extension")
  .description("Import the signed-in session from the browser RPass extension")
  .option("--store <path>", "Path to the extension's Local Extension Settings store")
  .action((opts) =>
    run(async () => {
      const { session, storePath } = await importFromExtension(opts.store);
      saveSession(session);
      out({ ok: true, source: storePath, email: session.email, roleId: session.roleId, companyId: session.companyId });
    }),
  );

auth
  .command("token")
  .description("Set a session token directly (CI)")
  .requiredOption("--token <token>")
  .requiredOption("--role <roleId>")
  .requiredOption("--company <companyId>")
  .option("--email <email>")
  .action((opts) =>
    run(async () => {
      saveSession({ token: opts.token, roleId: opts.role, companyId: opts.company, email: opts.email });
      out({ ok: true, roleId: opts.role, companyId: opts.company });
    }),
  );

auth
  .command("status")
  .description("Show the current session")
  .action(() =>
    run(async () => {
      const s = loadSession();
      out(
        s
          ? { authenticated: true, email: s.email, roleId: s.roleId, companyId: s.companyId, expiresAt: s.expiresAt, unlocked: Boolean(loadKeys().masterKey) }
          : { authenticated: false },
      );
    }),
  );

rpass
  .command("unlock")
  .description("Derive and cache the master key")
  .option("--password <password>", "Master password (or set RPL_MASTER_PASSWORD)")
  .action((opts) =>
    run(async () => {
      const client = new RipplingClient(requireSession());
      const password = opts.password ?? (await promptHidden("Master password"));
      if (!password) throw new CliError("NO_PASSWORD", "A master password is required to unlock.");
      const masterKey = await client.deriveMasterKey(password);
      saveKeys({ masterKey });
      out({ ok: true, unlocked: true });
    }),
  );

rpass
  .command("list")
  .description("List vault items")
  .option("--vault <vault>", "company | personal | all", "all")
  .option("--query <text>", "Filter by name/host/username")
  .action((opts) =>
    run(async () => {
      const client = new RipplingClient(requireSession());
      let items = await allItems(client, opts.vault, loadMasterKey());
      if (opts.query) items = match(items, opts.query);
      out(items.map((i) => ({ id: i.id, name: i.name, hostname: i.hostname, username: i.username, vault: i.vault, hasTotp: Boolean(i.totpSeed) })));
    }),
  );

rpass
  .command("get <idOrName>")
  .description("Get one item (secrets included)")
  .option("--field <field>", "username | password | totp | notes")
  .option("--vault <vault>", "company | personal | all", "all")
  .action((idOrName, opts) =>
    run(async () => {
      const client = new RipplingClient(requireSession());
      const found = match(await allItems(client, opts.vault, loadMasterKey()), idOrName);
      if (found.length === 0) throw new CliError("NOT_FOUND", `No item matches "${idOrName}".`);
      if (found.length > 1) {
        throw new CliError("AMBIGUOUS", `Multiple items match "${idOrName}".`, found.map((i) => `rpl rpass get ${i.id}`));
      }
      const item = found[0]!;
      if (opts.field === "totp") {
        if (!item.totpSeed) throw new CliError("NO_TOTP", "Item has no TOTP seed.");
        return void process.stdout.write(`${totp(item.totpSeed).code}\n`);
      }
      if (opts.field) {
        const v = (item as unknown as Record<string, unknown>)[opts.field];
        return void process.stdout.write(`${v ?? ""}\n`);
      }
      out(item);
    }),
  );

rpass
  .command("totp <idOrName>")
  .description("Print the current TOTP code for an item")
  .option("--vault <vault>", "company | personal | all", "all")
  .action((idOrName, opts) =>
    run(async () => {
      const client = new RipplingClient(requireSession());
      const found = match(await allItems(client, opts.vault, loadMasterKey()), idOrName).filter((i) => i.totpSeed);
      if (found.length === 0) throw new CliError("NO_TOTP", `No TOTP item matches "${idOrName}".`);
      const { code, expiresInSeconds } = totp(found[0]!.totpSeed!);
      out({ id: found[0]!.id, name: found[0]!.name, code, expiresInSeconds });
    }),
  );

program.parseAsync(process.argv).catch(fail);
