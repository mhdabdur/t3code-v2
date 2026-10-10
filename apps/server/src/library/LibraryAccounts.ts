/**
 * The Claude and Codex accounts the Library can manage: where each keeps its
 * config folder, and how to run its CLI against that folder. Other providers
 * keep no plugins or skills folder T3 Code knows how to change.
 *
 * @module library/LibraryAccounts
 */
import * as NodeOS from "node:os";

import { LibraryError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { expandHomePath } from "../pathExpansion.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

const DRIVERS = {
  claudeAgent: { env: "CLAUDE_CONFIG_DIR", folder: ".claude", binary: "claude" },
  codex: { env: "CODEX_HOME", folder: ".codex", binary: "codex" },
} as const;

export type LibraryAccountDriver = keyof typeof DRIVERS;

export interface LibraryAccount {
  readonly instanceId: ProviderInstanceId;
  readonly driver: LibraryAccountDriver;
  /** The account's config folder: `~/.claude`, `~/.codex`, or its configured home. */
  readonly configDir: string;
  /** Where the account's own skills live, one folder per skill. */
  readonly skillsDir: string;
  /** Runs the account's CLI against its config folder; a non-zero exit fails with its output. */
  readonly runCli: (
    args: ReadonlyArray<string>,
    options?: { readonly timeout?: Duration.Input },
  ) => Effect.Effect<string, LibraryError>;
  /** The CLI to run: a path, or a name found on the server's `PATH`. */
  readonly binaryPath: string;
  /** What the CLI needs beyond the server's environment to use this config folder. */
  readonly environment: NodeJS.ProcessEnv;
}

export class LibraryAccounts extends Context.Service<
  LibraryAccounts,
  {
    readonly list: Effect.Effect<ReadonlyArray<LibraryAccount>>;
    /** Fails when the instance is not a Claude or Codex account. */
    readonly get: (instanceId: ProviderInstanceId) => Effect.Effect<LibraryAccount, LibraryError>;
  }
>()("t3/library/LibraryAccounts") {}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** The last lines a CLI printed, which is where it says what went wrong. */
function failureDetail(output: ProcessRunner.ProcessRunOutput): string {
  const text = (output.stderr.trim() || output.stdout.trim()).split(/\r?\n/).slice(-6).join("\n");
  return text.length > 0 ? text : `Exited with code ${output.code ?? "unknown"}.`;
}

const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const list: LibraryAccounts["Service"]["list"] = Effect.gen(function* () {
    const settings = yield* serverSettings.getSettings.pipe(Effect.orElseSucceed(() => null));
    const instances = yield* registry.listInstances;
    return instances.flatMap((instance): ReadonlyArray<LibraryAccount> => {
      const driver = String(instance.driverKind);
      if (driver !== "claudeAgent" && driver !== "codex") return [];
      const meta = DRIVERS[driver];
      const instanceConfig = asRecord(settings?.providerInstances[instance.instanceId]?.config);
      const legacyConfig = asRecord(asRecord(settings?.providers)[driver]);
      const read = (key: string) =>
        readString(instanceConfig[key]) ?? readString(legacyConfig[key]);
      const homePath = read("homePath");
      const configured = homePath ?? process.env[meta.env]?.trim() ?? "";
      const configDir =
        configured.length === 0
          ? path.join(NodeOS.homedir(), meta.folder)
          : path.resolve(expandHomePath(configured));
      const command = read("binaryPath") ?? meta.binary;
      // Only a configured home is exported, as when the provider runs: naming
      // the default folder moves where Claude keeps its sign-in.
      const environment: NodeJS.ProcessEnv = homePath ? { [meta.env]: configDir } : {};
      return [
        {
          instanceId: instance.instanceId,
          driver,
          configDir,
          skillsDir: path.join(configDir, "skills"),
          binaryPath: command,
          environment,
          runCli: (args, options) =>
            processRunner
              .run({
                command,
                args,
                timeout: options?.timeout ?? "60 seconds",
                ...(homePath ? { env: environment } : {}),
              })
              .pipe(
                Effect.mapError(
                  (cause) => new LibraryError({ message: `Could not run ${meta.binary}.`, cause }),
                ),
                Effect.flatMap((output) =>
                  output.code === 0
                    ? Effect.succeed(output.stdout)
                    : Effect.fail(new LibraryError({ message: failureDetail(output) })),
                ),
              ),
        },
      ];
    });
  });

  const get: LibraryAccounts["Service"]["get"] = Effect.fn("LibraryAccounts.get")(
    function* (instanceId) {
      const account = (yield* list).find((entry) => entry.instanceId === instanceId);
      if (!account) {
        return yield* new LibraryError({ message: "This is not a Claude or Codex account." });
      }
      return account;
    },
  );

  return LibraryAccounts.of({ list, get });
});

export const layer = Layer.effect(LibraryAccounts, make).pipe(Layer.provide(ProcessRunner.layer));
