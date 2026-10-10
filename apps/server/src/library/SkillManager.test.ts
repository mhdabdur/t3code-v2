import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as LibraryAccounts from "./LibraryAccounts.ts";
import * as SkillManager from "./SkillManager.ts";

const instanceId = ProviderInstanceId.make("claudeAgent");

/** A skill manager over a scratch config folder; `refreshed` counts skill-list refreshes. */
const setup = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-manager-" });
  const configDir = path.join(root, "config");
  const skillsDir = path.join(configDir, "skills");
  let refreshed = 0;
  const layer = SkillManager.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(LibraryAccounts.LibraryAccounts)({
          get: () =>
            Effect.succeed({
              instanceId,
              driver: "claudeAgent",
              configDir,
              skillsDir,
              binaryPath: "claude",
              environment: {},
              runCli: () => Effect.succeed(""),
            }),
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          refreshInstance: () =>
            Effect.sync(() => {
              refreshed += 1;
              return [];
            }),
        }),
        Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
          getInstance: () => Effect.succeed(undefined),
        }),
      ),
    ),
  );
  const writeSkill = (folder: string, body = "# skill") =>
    fileSystem
      .makeDirectory(folder, { recursive: true })
      .pipe(Effect.andThen(fileSystem.writeFileString(path.join(folder, "SKILL.md"), body)));
  return { fileSystem, path, root, skillsDir, layer, writeSkill, refreshed: () => refreshed };
});

describe("SkillManager", () => {
  it.effect("writes a skill typed into the app, and refuses to replace one", () =>
    Effect.gen(function* () {
      const { fileSystem, path, skillsDir, layer, refreshed } = yield* setup;
      const source = {
        kind: "text" as const,
        name: "Release Notes!",
        description: 'Use for "what changed": notes',
        body: "Summarise the merged pull requests.",
      };

      const result = yield* Effect.flatMap(SkillManager.SkillManager, (skills) =>
        Effect.gen(function* () {
          const added = yield* skills.add({ instanceId, source });
          const again = yield* skills.add({ instanceId, source }).pipe(Effect.flip);
          return { added, again };
        }),
      ).pipe(Effect.provide(layer));

      expect(result.added).toEqual({ added: ["release-notes"], skipped: [] });
      expect(result.again.message).toContain("already exists");
      expect(
        yield* fileSystem.readFileString(path.join(skillsDir, "release-notes", "SKILL.md")),
      ).toBe(
        '---\nname: release-notes\ndescription: "Use for \\"what changed\\": notes"\n---\n\nSummarise the merged pull requests.\n',
      );
      expect(refreshed()).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("copies every skill in a folder and leaves a taken name alone", () =>
    Effect.gen(function* () {
      const { fileSystem, path, root, skillsDir, layer, writeSkill } = yield* setup;
      const source = path.join(root, "collection");
      yield* writeSkill(path.join(source, "skills", "alpha"), "alpha from source");
      yield* writeSkill(path.join(source, "skills", "beta"), "beta from source");
      yield* fileSystem.writeFileString(path.join(source, "skills", "beta", "notes.txt"), "extra");
      yield* writeSkill(path.join(source, "node_modules", "ignored"));
      yield* writeSkill(path.join(skillsDir, "alpha"), "alpha already here");

      const result = yield* Effect.flatMap(SkillManager.SkillManager, (skills) =>
        skills.add({ instanceId, source: { kind: "folder", path: source } }),
      ).pipe(Effect.provide(layer));

      expect(result).toEqual({ added: ["beta"], skipped: ["alpha"] });
      expect(yield* fileSystem.readFileString(path.join(skillsDir, "alpha", "SKILL.md"))).toBe(
        "alpha already here",
      );
      expect(yield* fileSystem.readFileString(path.join(skillsDir, "beta", "notes.txt"))).toBe(
        "extra",
      );
      expect(yield* fileSystem.exists(path.join(skillsDir, "ignored"))).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("removes only skills in the account's own folder", () =>
    Effect.gen(function* () {
      const { fileSystem, path, root, skillsDir, layer, writeSkill, refreshed } = yield* setup;
      const outside = path.join(root, "elsewhere", "shared");
      yield* writeSkill(outside);
      yield* writeSkill(path.join(skillsDir, "mine"));
      yield* fileSystem.symlink(outside, path.join(skillsDir, "linked"));

      const refused = yield* Effect.flatMap(SkillManager.SkillManager, (skills) =>
        Effect.gen(function* () {
          yield* skills.remove({ instanceId, path: path.join(skillsDir, "mine", "SKILL.md") });
          yield* skills.remove({ instanceId, path: path.join(skillsDir, "linked", "SKILL.md") });
          return yield* Effect.all([
            skills.remove({ instanceId, path: path.join(outside, "SKILL.md") }).pipe(Effect.flip),
            skills
              .remove({ instanceId, path: path.join(skillsDir, "..", "settings.json") })
              .pipe(Effect.flip),
          ]);
        }),
      ).pipe(Effect.provide(layer));

      expect(refused.map((error) => error._tag)).toEqual(["LibraryError", "LibraryError"]);
      expect(yield* fileSystem.readDirectory(skillsDir)).toEqual([]);
      // Removing a linked skill drops the link, not the folder it points at.
      expect(yield* fileSystem.exists(path.join(outside, "SKILL.md"))).toBe(true);
      expect(refreshed()).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("skillRepositoryUrl", () => {
  it("expands GitHub shorthand and leaves addresses alone", () => {
    expect(SkillManager.skillRepositoryUrl("anthropics/skills")).toBe(
      "https://github.com/anthropics/skills.git",
    );
    expect(SkillManager.skillRepositoryUrl("git@github.com:owner/repo.git")).toBe(
      "git@github.com:owner/repo.git",
    );
    expect(SkillManager.skillRepositoryUrl("https://example.com/a/b/c.git")).toBe(
      "https://example.com/a/b/c.git",
    );
  });
});
