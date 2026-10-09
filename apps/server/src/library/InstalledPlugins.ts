/**
 * The plugins each Claude and Codex account has installed, read from that
 * account's config folder: Claude's `plugins/installed_plugins.json` plus the
 * `enabledPlugins` map in its `settings.json`, and the `[plugins.'name@source']`
 * tables in Codex's `config.toml`. Plugins an account gets online (claude.ai or
 * ChatGPT) leave no trace on disk and are not listed.
 *
 * @module library/InstalledPlugins
 */
import * as NodeOS from "node:os";

import type { InstalledPlugin, InstalledPluginGroup, ProviderDriverKind } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

export class InstalledPlugins extends Context.Service<
  InstalledPlugins,
  {
    /** One group per Claude or Codex account; other providers have no plugins to read. */
    readonly list: Effect.Effect<ReadonlyArray<InstalledPluginGroup>>;
  }
>()("t3/library/InstalledPlugins") {}

const CONFIG_FOLDERS: Readonly<Record<string, { env: string; folder: string }>> = {
  claudeAgent: { env: "CLAUDE_CONFIG_DIR", folder: ".claude" },
  codex: { env: "CODEX_HOME", folder: ".codex" },
};

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
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

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

  const configDirFor = (homePath: string, driver: ProviderDriverKind) => {
    const folder = CONFIG_FOLDERS[String(driver)]!;
    const configured = homePath.trim() || process.env[folder.env]?.trim() || "";
    if (configured.length === 0) return path.join(NodeOS.homedir(), folder.folder);
    return path.resolve(configured.replace(/^~(?=$|\/)/, NodeOS.homedir()));
  };

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
    const settings = yield* serverSettings.getSettings.pipe(Effect.orElseSucceed(() => null));
    const instances = yield* registry.listInstances;
    return yield* Effect.forEach(
      instances.filter((instance) => CONFIG_FOLDERS[String(instance.driverKind)] !== undefined),
      (instance) =>
        Effect.gen(function* () {
          const instanceConfig = asRecord(settings?.providerInstances[instance.instanceId]?.config);
          const legacyConfig = asRecord(
            asRecord(settings?.providers)[instance.driverKind as string],
          );
          const homePath =
            readString(instanceConfig.homePath) ?? readString(legacyConfig.homePath) ?? "";
          const configDir = configDirFor(homePath, instance.driverKind);
          const plugins =
            String(instance.driverKind) === "codex"
              ? yield* codexPlugins(configDir)
              : yield* claudePlugins(configDir);
          return {
            instanceId: instance.instanceId,
            configDir,
            plugins: plugins.toSorted((a, b) => a.name.localeCompare(b.name)),
          } satisfies InstalledPluginGroup;
        }),
    );
  }).pipe(Effect.withSpan("InstalledPlugins.list"));

  return InstalledPlugins.of({ list });
});

export const layer = Layer.effect(InstalledPlugins, make);
