/**
 * Adds skills to, and removes them from, a Claude or Codex account's own
 * skills folder: `<config folder>/skills/<name>/SKILL.md`. Skills a plugin or
 * a project brings are not in that folder and are left to their owner.
 *
 * @module library/SkillManager
 */
import {
  LibraryError,
  type LibraryAddSkillInput,
  type LibraryAddSkillResult,
  type LibraryRemoveSkillInput,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { expandHomePath } from "../pathExpansion.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as LibraryAccounts from "./LibraryAccounts.ts";

export class SkillManager extends Context.Service<
  SkillManager,
  {
    /**
     * Copies skills into the account's skills folder. A git repository or a
     * folder may hold one skill or many; a skill whose name is taken is
     * skipped, never overwritten.
     */
    readonly add: (
      input: LibraryAddSkillInput,
    ) => Effect.Effect<LibraryAddSkillResult, LibraryError>;
    /** Deletes the skill's folder; only skills in the account's own folder qualify. */
    readonly remove: (input: LibraryRemoveSkillInput) => Effect.Effect<void, LibraryError>;
  }
>()("t3/library/SkillManager") {}

const SKILL_FILE = "SKILL.md";
// How far below a repository's root a skill folder is looked for.
const MAX_SCAN_DEPTH = 4;
const SKIPPED_FOLDERS = new Set([".git", "node_modules"]);

const libraryError = (message: string) => (cause: unknown) => new LibraryError({ message, cause });

/** A folder name for a skill: lowercase words joined by dashes. */
export function skillFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `owner/repo` is GitHub shorthand; anything else is cloned as given. */
export function skillRepositoryUrl(source: string): string {
  return /^[\w.-]+\/[\w.-]+$/.test(source) ? `https://github.com/${source}.git` : source;
}

/** The folder a clone of `url` is named after. */
function repositoryName(url: string): string {
  const last =
    url
      .replace(/[\\/]+$/, "")
      .split(/[\\/:]/)
      .at(-1) ?? "";
  return skillFolderName(last.replace(/\.git$/, "")) || "skill";
}

export function skillFileContents(input: {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}): string {
  // JSON strings are valid YAML scalars, so any punctuation survives.
  const description = JSON.stringify(input.description.replace(/\s+/g, " ").trim());
  return `---\nname: ${input.name}\ndescription: ${description}\n---\n\n${input.body.trim()}\n`;
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const accounts = yield* LibraryAccounts.LibraryAccounts;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;

  const exists = (file: string) => fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false));

  /** Folders holding a `SKILL.md`, nearest first; a skill's own subfolders are not searched. */
  const findSkillFolders = (root: string, depth = 0): Effect.Effect<ReadonlyArray<string>> =>
    Effect.gen(function* () {
      if (yield* exists(path.join(root, SKILL_FILE))) return [root];
      if (depth >= MAX_SCAN_DEPTH) return [];
      const entries = yield* fileSystem
        .readDirectory(root)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      const nested = yield* Effect.forEach(
        entries.filter((entry) => !SKIPPED_FOLDERS.has(entry)).toSorted(),
        (entry) => findSkillFolders(path.join(root, entry), depth + 1),
      );
      return nested.flat();
    });

  /** The providers' skill lists are snapshots; re-read this account's. */
  const refreshSkills = (instanceId: ProviderInstanceId) =>
    Effect.gen(function* () {
      const instance = yield* providerInstances.getInstance(instanceId);
      yield* instance?.invalidateCaches ?? Effect.void;
      yield* providerRegistry.refreshInstance(instanceId);
    });

  const copyFolders = Effect.fn("SkillManager.copyFolders")(function* (
    skillsDir: string,
    folders: ReadonlyArray<{ readonly from: string; readonly name: string }>,
  ) {
    if (folders.length === 0) {
      return yield* new LibraryError({ message: `No ${SKILL_FILE} was found there.` });
    }
    const added: Array<string> = [];
    const skipped: Array<string> = [];
    for (const folder of folders) {
      const target = path.join(skillsDir, folder.name);
      if (yield* exists(target)) {
        skipped.push(folder.name);
        continue;
      }
      yield* fileSystem
        .copy(folder.from, target)
        .pipe(Effect.mapError(libraryError(`Could not copy the skill "${folder.name}".`)));
      // A repository that is itself one skill brings its history along.
      yield* fileSystem
        .remove(path.join(target, ".git"), { recursive: true, force: true })
        .pipe(Effect.ignore);
      added.push(folder.name);
    }
    return { added, skipped } satisfies LibraryAddSkillResult;
  });

  const add: SkillManager["Service"]["add"] = Effect.fn("SkillManager.add")(function* (input) {
    const account = yield* accounts.get(input.instanceId);
    const { source } = input;
    yield* fileSystem
      .makeDirectory(account.skillsDir, { recursive: true })
      .pipe(Effect.mapError(libraryError("Could not create the skills folder.")));

    const result = yield* Effect.gen(function* () {
      if (source.kind === "text") {
        const name = skillFolderName(source.name);
        if (name.length === 0) {
          return yield* new LibraryError({ message: "Give the skill a name with letters in it." });
        }
        const target = path.join(account.skillsDir, name);
        if (yield* exists(target)) {
          return yield* new LibraryError({ message: `A skill named "${name}" already exists.` });
        }
        yield* fileSystem
          .makeDirectory(target, { recursive: true })
          .pipe(
            Effect.andThen(
              fileSystem.writeFileString(
                path.join(target, SKILL_FILE),
                skillFileContents({ ...source, name }),
              ),
            ),
            Effect.mapError(libraryError("Could not write the skill.")),
          );
        return { added: [name], skipped: [] } satisfies LibraryAddSkillResult;
      }

      if (source.kind === "folder") {
        const root = path.resolve(expandHomePath(source.path));
        const folders = yield* findSkillFolders(root);
        return yield* copyFolders(
          account.skillsDir,
          folders.map((from) => ({ from, name: path.basename(from) })),
        );
      }

      if (source.url.startsWith("-")) {
        return yield* new LibraryError({ message: "That is not a repository address." });
      }
      const url = skillRepositoryUrl(source.url);
      const scratch = yield* fileSystem
        .makeTempDirectoryScoped()
        .pipe(Effect.mapError(libraryError("Could not prepare a folder to clone into.")));
      const checkout = path.join(scratch, repositoryName(url));
      const clone = yield* processRunner
        .run({
          command: "git",
          args: ["clone", "--depth", "1", "--", url, checkout],
          timeout: "2 minutes",
          // A private repository must fail, not wait at a password prompt nobody sees.
          env: { GIT_TERMINAL_PROMPT: "0" },
        })
        .pipe(Effect.mapError(libraryError("Could not run git.")));
      if (clone.code !== 0) {
        return yield* new LibraryError({
          message: clone.stderr.trim().split(/\r?\n/).slice(-3).join("\n") || "git clone failed.",
        });
      }
      const folders = yield* findSkillFolders(checkout);
      return yield* copyFolders(
        account.skillsDir,
        folders.map((from) => ({ from, name: path.basename(from) })),
      );
    }).pipe(Effect.scoped);

    if (result.added.length > 0) yield* refreshSkills(input.instanceId);
    return result;
  });

  const remove: SkillManager["Service"]["remove"] = Effect.fn("SkillManager.remove")(
    function* (input) {
      const account = yield* accounts.get(input.instanceId);
      const relative = path.relative(account.skillsDir, path.resolve(input.path));
      const folder = relative.split(/[\\/]/)[0] ?? "";
      if (
        folder.length === 0 ||
        folder === ".." ||
        folder === SKILL_FILE ||
        path.isAbsolute(relative)
      ) {
        return yield* new LibraryError({
          message: "Only skills in this account's own skills folder can be removed here.",
        });
      }
      // A skill linked in from elsewhere loses its link; the linked folder stays.
      yield* fileSystem
        .remove(path.join(account.skillsDir, folder), { recursive: true })
        .pipe(Effect.mapError(libraryError("Could not remove the skill.")));
      yield* refreshSkills(input.instanceId);
    },
  );

  return SkillManager.of({ add, remove });
});

export const layer = Layer.effect(SkillManager, make).pipe(Layer.provide(ProcessRunner.layer));
