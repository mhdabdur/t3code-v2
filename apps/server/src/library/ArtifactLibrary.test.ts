import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as HtmlRender from "../htmlRender/HtmlRender.ts";
import * as PreviewBrowser from "../htmlRender/PreviewBrowser.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ArtifactLibrary from "./ArtifactLibrary.ts";

const threadId = ThreadId.make("thread-library-test");

const layerTest = Layer.mergeAll(
  ArtifactLibrary.layer.pipe(
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(null),
      }),
    ),
  ),
  HtmlRender.layer.pipe(
    Layer.provide(
      Layer.succeed(
        PreviewBrowser.PreviewBrowser,
        PreviewBrowser.PreviewBrowser.of({
          executable: Effect.die("This test has no preview browser."),
          installed: Effect.succeedNone,
        }),
      ),
    ),
  ),
).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-artifact-library-" })),
  Layer.provideMerge(NodeServices.layer),
);

const publish = (html: string, title: string) =>
  Effect.flatMap(HtmlRender.HtmlRender, (render) =>
    render.publish({ threadId, html, title, height: 200 }),
  );

describe("ArtifactLibrary", () => {
  it.effect("keeps each re-publish as a version and outlives the thread's page", () =>
    Effect.gen(function* () {
      const library = yield* ArtifactLibrary.ArtifactLibrary;
      const fileSystem = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;

      const first = yield* publish("<p>v1</p>", "Dashboard");
      const created = yield* library.recordRender({ threadId, reference: first });
      const second = yield* publish("<p>v2</p>", "Dashboard v2");
      const revised = yield* library.recordRender({
        threadId,
        reference: second,
        artifactId: created.artifactId,
      });
      const other = yield* library.recordRender({ threadId, reference: first });

      expect(revised).toEqual({ artifactId: created.artifactId, version: 2 });
      expect(other.artifactId).not.toBe(created.artifactId);

      // Thread deletion removes the thread's own pages; the Library's copies stay.
      for (const reference of [first, second]) {
        const page = resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: reference.attachmentId,
        });
        if (page) yield* fileSystem.remove(page);
      }
      const artifacts = yield* library.list;
      const dashboard = artifacts.find((artifact) => artifact.id === created.artifactId);
      expect(dashboard?.title).toBe("Dashboard v2");
      expect(dashboard?.versions.map((version) => version.version)).toEqual([1, 2]);
      const latest = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: dashboard!.versions[1]!.attachmentId,
      });
      expect(latest).not.toBeNull();
      expect(yield* fileSystem.readFileString(latest!)).toContain("<p>v2</p>");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("deleting an artifact removes it and its pages", () =>
    Effect.gen(function* () {
      const library = yield* ArtifactLibrary.ArtifactLibrary;
      const config = yield* ServerConfig.ServerConfig;
      const saved = yield* library.recordRender({
        threadId,
        reference: yield* publish("<p>gone</p>", "Scratch"),
      });
      const [artifact] = yield* library.list;

      yield* library.remove(saved.artifactId);

      expect(yield* library.list).toEqual([]);
      expect(
        resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: artifact!.versions[0]!.attachmentId,
        }),
      ).toBeNull();
    }).pipe(Effect.provide(layerTest)),
  );
});
