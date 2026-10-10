/**
 * The plugins each Claude and Codex account has installed, read from that
 * account's config folder: Claude's `plugins/installed_plugins.json` plus the
 * `enabledPlugins` map in its `settings.json`, and the `[plugins.'name@source']`
 * tables in Codex's `config.toml`. Plugins an account gets online (claude.ai or
 * ChatGPT) leave no trace on disk and are not listed.
 *
 * Installing and removing go through the account's own CLI, which owns the
 * marketplace checkout, the cache and the config edits.
 *
 * @module library/InstalledPlugins
 */
import {
  LibraryError,
  type AvailablePlugin,
  type InstalledPlugin,
  type InstalledPluginGroup,
  type LibraryListAvailablePluginsResult,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as LibraryAccounts from "./LibraryAccounts.ts";

export class InstalledPlugins extends Context.Service<
  InstalledPlugins,
  {
    /** One group per Claude or Codex account; other providers have no plugins to read. */
    readonly list: Effect.Effect<ReadonlyArray<InstalledPluginGroup>>;
    /** What the account's marketplaces offer, best matches for `query` first. */
    readonly available: (input: {
      readonly instanceId: ProviderInstanceId;
      readonly query: string;
    }) => Effect.Effect<LibraryListAvailablePluginsResult, LibraryError>;
    readonly install: (input: PluginTarget) => Effect.Effect<void, LibraryError>;
    readonly uninstall: (input: PluginTarget) => Effect.Effect<void, LibraryError>;
    /** `source` is `owner/repo`, a git URL, or a folder on this machine. */
    readonly addMarketplace: (input: {
      readonly instanceId: ProviderInstanceId;
      readonly source: string;
    }) => Effect.Effect<void, LibraryError>;
  }
>()("t3/library/InstalledPlugins") {}

interface PluginTarget {
  readonly instanceId: ProviderInstanceId;
  readonly pluginId: string;
}

const AVAILABLE_LIMIT = 60;
// Installing clones the plugin's repository, which a slow connection stretches.
const INSTALL_TIMEOUT = "5 minutes";

/** A CLI argument that cannot be read as a flag. */
const isPlainArgument = (value: string) => value.length > 0 && !value.startsWith("-");

/** The `available` and `installed` lists of `claude|codex plugin list --json --available`. */
export function parseAvailablePlugins(json: string): ReadonlyArray<AvailablePlugin> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const root = asRecord(parsed);
  const entries = (value: unknown) => (Array.isArray(value) ? value.map(asRecord) : []);
  const byId = new Map<string, AvailablePlugin>();
  const add = (entry: Record<string, unknown>, installed: boolean) => {
    // Claude names an installed plugin `id`; everything else is `pluginId`.
    const id = readString(entry.pluginId) ?? readString(entry.id);
    if (!id) return;
    const split = splitId(id);
    const known = byId.get(id);
    byId.set(id, {
      id,
      name: readString(entry.name) ?? split.name,
      marketplace: readString(entry.marketplaceName) ?? split.marketplace,
      description: readString(entry.description) ?? known?.description ?? null,
      installCount:
        typeof entry.installCount === "number" ? entry.installCount : (known?.installCount ?? null),
      installed: installed || entry.installed === true || known?.installed === true,
    });
  };
  for (const entry of entries(root.available)) add(entry, false);
  for (const entry of entries(root.installed)) add(entry, true);
  return [...byId.values()];
}

/** Matches of `query`, most installed first, then by name. */
export function searchAvailablePlugins(
  plugins: ReadonlyArray<AvailablePlugin>,
  query: string,
): LibraryListAvailablePluginsResult {
  const needle = query.trim().toLowerCase();
  const matches = plugins
    .filter(
      (plugin) =>
        needle.length === 0 ||
        plugin.name.toLowerCase().includes(needle) ||
        (plugin.marketplace ?? "").toLowerCase().includes(needle) ||
        (plugin.description ?? "").toLowerCase().includes(needle),
    )
    .toSorted(
      (a, b) =>
        Number(b.name.toLowerCase() === needle) - Number(a.name.toLowerCase() === needle) ||
        (b.installCount ?? 0) - (a.installCount ?? 0) ||
        a.name.localeCompare(b.name),
    );
  return {
    plugins: matches.slice(0, AVAILABLE_LIMIT),
    total: matches.length,
    marketplaces: [
      ...new Set(plugins.flatMap((plugin) => (plugin.marketplace ? [plugin.marketplace] : []))),
    ].toSorted(),
  };
}

function splitId(id: string): { name: string; marketplace: string | null } {
  const at = id.lastIndexOf("@");
  return at > 0
    ? { name: id.slice(0, at), marketplace: id.slice(at + 1) }
    : { name: id, marketplace: null };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** `[plugins.'name@source']` tables and their `enabled` flag; Codex writes nothing fancier. */
export function parseCodexPluginTables(
  toml: string,
): ReadonlyArray<{ id: string; enabled: boolean }> {
  const plugins: Array<{ id: string; enabled: boolean }> = [];
  let current: { id: string; enabled: boolean } | null = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      const header = /^\[plugins\.(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_@.-]+))\]$/.exec(line);
      const id = header?.[1] ?? header?.[2] ?? header?.[3];
      current = id ? { id, enabled: true } : null;
      if (current) plugins.push(current);
      continue;
    }
    const enabled = /^enabled\s*=\s*(true|false)\b/.exec(line);
    if (current && enabled) current.enabled = enabled[1] === "true";
  }
  return plugins;
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const accounts = yield* LibraryAccounts.LibraryAccounts;

  const readText = (file: string) =>
    fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => null));
  const readJson = (file: string) =>
    readText(file).pipe(
      Effect.map((text) => {
        if (text === null) return {};
        try {
          return asRecord(JSON.parse(text));
        } catch {
          return {};
        }
      }),
    );
  const describe = (manifest: string) =>
    readJson(manifest).pipe(Effect.map((json) => readString(json.description)));

  const claudePlugins = Effect.fn("InstalledPlugins.claude")(function* (configDir: string) {
    const installed = asRecord(
      (yield* readJson(path.join(configDir, "plugins", "installed_plugins.json"))).plugins,
    );
    const enabled = asRecord(
      (yield* readJson(path.join(configDir, "settings.json"))).enabledPlugins,
    );
    return yield* Effect.forEach(Object.entries(installed), ([id, entries]) =>
      Effect.gen(function* () {
        const entry = asRecord(Array.isArray(entries) ? entries[0] : entries);
        const installPath = readString(entry.installPath);
        return {
          id,
          ...splitId(id),
          version: readString(entry.version),
          description: installPath
            ? yield* describe(path.join(installPath, ".claude-plugin", "plugin.json"))
            : null,
          enabled: enabled[id] !== false,
        } satisfies InstalledPlugin;
      }),
    );
  });

  const codexPlugins = Effect.fn("InstalledPlugins.codex")(function* (configDir: string) {
    const toml = (yield* readText(path.join(configDir, "config.toml"))) ?? "";
    return yield* Effect.forEach(parseCodexPluginTables(toml), (table) =>
      Effect.gen(function* () {
        const { name, marketplace } = splitId(table.id);
        // The cache keeps one folder per installed version; take the newest name.
        const pluginDir = path.join(configDir, "plugins", "cache", marketplace ?? "", name);
        const versions = yield* fileSystem
          .readDirectory(pluginDir)
          .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
        const version = versions.toSorted().at(-1) ?? null;
        return {
          id: table.id,
          name,
          marketplace,
          version,
          description: version
            ? yield* describe(path.join(pluginDir, version, ".codex-plugin", "plugin.json"))
            : null,
          enabled: table.enabled,
        } satisfies InstalledPlugin;
      }),
    );
  });

  const list: InstalledPlugins["Service"]["list"] = Effect.gen(function* () {
    return yield* Effect.forEach(yield* accounts.list, (account) =>
      Effect.gen(function* () {
        const plugins =
          account.driver === "codex"
            ? yield* codexPlugins(account.configDir)
            : yield* claudePlugins(account.configDir);
        return {
          instanceId: account.instanceId,
          configDir: account.configDir,
          plugins: plugins.toSorted((a, b) => a.name.localeCompare(b.name)),
        } satisfies InstalledPluginGroup;
      }),
    );
  }).pipe(Effect.withSpan("InstalledPlugins.list"));

  // Listing a marketplace runs the CLI over thousands of entries; searching as
  // the user types must not run it per keystroke.
  const catalog = yield* Cache.makeWith(
    (instanceId: ProviderInstanceId) =>
      accounts.get(instanceId).pipe(
        Effect.flatMap((account) => account.runCli(["plugin", "list", "--json", "--available"])),
        Effect.map(parseAvailablePlugins),
      ),
    {
      capacity: 16,
      // A failure, such as a CLI that is not installed yet, is retried at once.
      timeToLive: (exit) => (Exit.isSuccess(exit) ? "2 minutes" : "0 millis"),
    },
  );

  const available: InstalledPlugins["Service"]["available"] = Effect.fn(
    "InstalledPlugins.available",
  )(function* (input) {
    return searchAvailablePlugins(yield* Cache.get(catalog, input.instanceId), input.query);
  });

  /** Runs a CLI command that changes what is installed or offered. */
  const change = (
    instanceId: ProviderInstanceId,
    argument: string,
    args: (driver: LibraryAccounts.LibraryAccountDriver) => ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      if (!isPlainArgument(argument)) {
        return yield* new LibraryError({ message: `"${argument}" is not a valid name.` });
      }
      const account = yield* accounts.get(instanceId);
      yield* account.runCli(args(account.driver), { timeout: INSTALL_TIMEOUT });
      yield* Cache.invalidate(catalog, instanceId);
    });

  const install: InstalledPlugins["Service"]["install"] = Effect.fn("InstalledPlugins.install")(
    function* (input) {
      // No `--yes`: a plugin that installs by running a marketplace's own
      // command needs a person at the CLI to read and accept that command.
      yield* change(input.instanceId, input.pluginId, (driver) =>
        driver === "codex"
          ? ["plugin", "add", input.pluginId]
          : ["plugin", "install", input.pluginId],
      );
    },
  );

  const uninstall: InstalledPlugins["Service"]["uninstall"] = Effect.fn(
    "InstalledPlugins.uninstall",
  )(function* (input) {
    yield* change(input.instanceId, input.pluginId, (driver) =>
      driver === "codex"
        ? ["plugin", "remove", input.pluginId]
        : ["plugin", "uninstall", input.pluginId],
    );
  });

  const addMarketplace: InstalledPlugins["Service"]["addMarketplace"] = Effect.fn(
    "InstalledPlugins.addMarketplace",
  )(function* (input) {
    yield* change(input.instanceId, input.source, () => [
      "plugin",
      "marketplace",
      "add",
      input.source,
    ]);
  });

  return InstalledPlugins.of({ list, available, install, uninstall, addMarketplace });
});

export const layer = Layer.effect(InstalledPlugins, make);
