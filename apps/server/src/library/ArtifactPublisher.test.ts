import { describe, expect, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  type LibraryArtifact,
  type LibraryArtifactPublication,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ArtifactLibrary from "./ArtifactLibrary.ts";
import * as ArtifactPublisher from "./ArtifactPublisher.ts";
import * as LibraryAccounts from "./LibraryAccounts.ts";

const claude = ProviderInstanceId.make("claudeAgent");
const codex = ProviderInstanceId.make("codex");
const pagePath = "/data/attachments/library-1.html";

// What Claude Code's Artifact tool hands back, as the SDK reports it.
const publishResult = (url: string) => ({
  url,
  artifact_id: "7d08972b",
  audience: "owner",
  seq: 1,
});
const readResult = { read: { code: 200, url: "https://claude.ai/artifact/someone-elses" } };
const deleteResult = (url: string) => ({ artifact_delete: { url, deleted: true } });

const onClaude = (url: string): LibraryArtifactPublication =>
  ({ url, version: 1, publishedAt: "2026-10-10T00:00:00.000Z" }) as LibraryArtifactPublication;

/** A library holding one artifact, and a Claude session that returns `toolResults`. */
const setup = (options: {
  readonly madeBy: ProviderInstanceId | null;
  readonly publication?: LibraryArtifactPublication;
  readonly toolResults: ReadonlyArray<unknown>;
  readonly reply?: string;
}) => {
  const sessions: Array<{
    readonly prompt: string;
    readonly readablePath: string | undefined;
    readonly allow: (call: Record<string, unknown>) => boolean;
  }> = [];
  let artifact = {
    id: "artifact-1",
    title: 'Sales "Q3"',
    providerInstanceId: options.madeBy,
    publication: options.publication ?? null,
  } as LibraryArtifact;
  const layer = ArtifactPublisher.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ArtifactLibrary.ArtifactLibrary)({
          currentPage: () =>
            Effect.succeed({
              artifact,
              version: { version: 3 } as LibraryArtifact["versions"][number],
              path: pagePath,
            }),
          update: (input) =>
            Effect.sync(() => {
              artifact = { ...artifact, publication: input.publication ?? null };
              return artifact;
            }),
        }),
        Layer.mock(LibraryAccounts.LibraryAccounts)({
          get: (instanceId) =>
            Effect.succeed({
              instanceId,
              driver: instanceId === codex ? "codex" : "claudeAgent",
              configDir: "/home/a/.claude",
              skillsDir: "/home/a/.claude/skills",
              binaryPath: "claude",
              environment: {},
              runCli: () => Effect.succeed(""),
            }),
        }),
        Layer.mock(ArtifactPublisher.ClaudeArtifactSession)({
          run: (input) =>
            Effect.sync(() => {
              sessions.push({
                prompt: input.prompt,
                readablePath: input.readablePath,
                allow: input.allow,
              });
              return { toolResults: options.toolResults, reply: options.reply ?? "" };
            }),
        }),
      ),
    ),
  );
  const run = <A>(
    use: (
      publisher: ArtifactPublisher.ArtifactPublisher["Service"],
    ) => Effect.Effect<A, { readonly _tag: string; readonly message: string }>,
  ) => Effect.flatMap(ArtifactPublisher.ArtifactPublisher, use).pipe(Effect.provide(layer));
  return {
    publish: run((publisher) => publisher.publish("artifact-1")),
    unpublish: run((publisher) => publisher.unpublish("artifact-1")),
    sessions,
    current: () => artifact,
  };
};

describe("ArtifactPublisher", () => {
  it.effect("publishes the current version, admitting only that one publish call", () =>
    Effect.gen(function* () {
      const { publish, sessions } = setup({
        madeBy: claude,
        toolResults: [publishResult("https://claude.ai/artifact/new")],
      });

      const artifact = yield* publish;

      expect(artifact.publication).toMatchObject({
        url: "https://claude.ai/artifact/new",
        version: 3,
      });
      expect(sessions).toHaveLength(1);
      const session = sessions[0]!;
      expect(session.readablePath).toBe(pagePath);
      // The title travels as JSON, quotes escaped, and a first publish names no address.
      expect(session.prompt).toContain(
        `{"action":"publish","file_path":"${pagePath}","title":"Sales \\"Q3\\""}`,
      );
      // Claude Code adds fields of its own to the input; they do not matter.
      expect(session.allow({ action: "publish", file_path: pagePath, icon: "chart" })).toBe(true);
      expect(session.allow({ action: "publish", file_path: "/etc/passwd" })).toBe(false);
      expect(
        session.allow({
          action: "publish",
          file_path: pagePath,
          url: "https://claude.ai/artifact/another",
        }),
      ).toBe(false);
      expect(session.allow({ action: "delete", url: "https://claude.ai/artifact/new" })).toBe(
        false,
      );
      expect(session.allow({ action: "share", url: "https://claude.ai/artifact/new" })).toBe(false);
    }),
  );

  it.effect("updates the page already on claude.ai instead of making another", () =>
    Effect.gen(function* () {
      const url = "https://claude.ai/artifact/first";
      const { publish, sessions } = setup({
        madeBy: claude,
        publication: onClaude(url),
        // A read's result names an address too, nested; it must not pass for the publish.
        toolResults: [readResult, publishResult(url)],
      });

      const artifact = yield* publish;

      expect(artifact.publication).toMatchObject({ url, version: 3 });
      const session = sessions[0]!;
      // The live page is read before it is replaced; Claude Code refuses otherwise.
      const read = session.prompt.indexOf(`{"action":"read","url":"${url}"}`);
      expect(read).toBeGreaterThan(-1);
      expect(session.prompt.indexOf('"action":"publish"')).toBeGreaterThan(read);
      expect(session.allow({ action: "read", url })).toBe(true);
      expect(session.allow({ action: "publish", file_path: pagePath, url })).toBe(true);
      // Publishing without the address would make a second page.
      expect(session.allow({ action: "publish", file_path: pagePath })).toBe(false);
      expect(session.allow({ action: "read", url: "https://claude.ai/artifact/other" })).toBe(
        false,
      );
    }),
  );

  it.effect("deletes the page from claude.ai and forgets its address", () =>
    Effect.gen(function* () {
      const url = "https://claude.ai/artifact/first";
      const { unpublish, sessions, current } = setup({
        madeBy: claude,
        publication: onClaude(url),
        toolResults: [deleteResult(url)],
      });

      const artifact = yield* unpublish;

      expect(artifact.publication).toBeNull();
      expect(current().publication).toBeNull();
      const session = sessions[0]!;
      expect(session.readablePath).toBeUndefined();
      expect(session.prompt).toContain(`{"action":"delete","url":"${url}"}`);
      // The confirmation covers this page only.
      expect(session.allow({ action: "delete", url, __artifactAsk: { class: "delete" } })).toBe(
        true,
      );
      expect(session.allow({ action: "delete", url: "https://claude.ai/artifact/other" })).toBe(
        false,
      );
      expect(session.allow({ action: "publish", file_path: pagePath, url })).toBe(false);
    }),
  );

  it.effect("keeps the address when claude.ai did not delete the page", () =>
    Effect.gen(function* () {
      const url = "https://claude.ai/artifact/first";
      const refused = setup({
        madeBy: claude,
        publication: onClaude(url),
        toolResults: ["Error: Deleting an Artifact needs the user's confirmation."],
        reply: "deleted",
      });
      const wrongPage = setup({
        madeBy: claude,
        publication: onClaude(url),
        toolResults: [deleteResult("https://claude.ai/artifact/other")],
      });
      const neverPublished = setup({ madeBy: claude, toolResults: [] });

      const errors = yield* Effect.all([
        Effect.flip(refused.unpublish),
        Effect.flip(wrongPage.unpublish),
        Effect.flip(neverPublished.unpublish),
      ]);

      // The tool's word counts, not the model's "deleted".
      expect(errors[0]?.message).toBe("Deleting an Artifact needs the user's confirmation.");
      expect(refused.current().publication?.url).toBe(url);
      expect(wrongPage.current().publication?.url).toBe(url);
      expect(errors[2]?.message).toContain("not on claude.ai");
      expect(neverPublished.sessions).toEqual([]);
    }),
  );

  it.effect("refuses artifacts no Claude account made, and records no failed publish", () =>
    Effect.gen(function* () {
      const fromCodex = setup({ madeBy: codex, toolResults: [] });
      const unowned = setup({ madeBy: null, toolResults: [] });
      const denied = setup({
        madeBy: claude,
        toolResults: ["Error: This account cannot publish Artifacts."],
        // An address the model only mentions is not a published page.
        reply: "Done: https://claude.ai/artifact/made-up",
      });
      const silent = setup({ madeBy: claude, toolResults: [] });

      const errors = yield* Effect.all([
        Effect.flip(fromCodex.publish),
        Effect.flip(unowned.publish),
        Effect.flip(denied.publish),
        Effect.flip(silent.publish),
      ]);

      expect(errors.map((error) => error._tag)).toEqual(Array(4).fill("LibraryError"));
      expect(errors[0]?.message).toContain("Claude account");
      expect(errors[2]?.message).toBe("This account cannot publish Artifacts.");
      expect(errors[3]?.message).toBe("Claude did not publish the page.");
      expect(denied.current().publication).toBeNull();
      expect(fromCodex.sessions).toEqual([]);
      expect(unowned.sessions).toEqual([]);
    }),
  );
});
