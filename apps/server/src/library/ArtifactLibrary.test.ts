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

  it.effect("serves a shared artifact's current page until sharing stops", () =>
    Effect.gen(function* () {
      const library = yield* ArtifactLibrary.ArtifactLibrary;
      const fileSystem = yield* FileSystem.FileSystem;
      const saved = yield* library.recordRender({
        threadId,
        reference: yield* publish("<p>draft</p>", "Report"),
      });
      expect((yield* library.list)[0]?.shareToken).toBeNull();

      const shared = yield* library.update({ artifactId: saved.artifactId, shared: true });
      const token = shared.shareToken!;
      // Sharing again, or changing something else, keeps the link people already have.
      const renamed = yield* library.update({
        artifactId: saved.artifactId,
        shared: true,
        title: "Final report",
        pinned: true,
      });
      expect(renamed).toMatchObject({ shareToken: token, title: "Final report", pinned: true });

      yield* library.recordRender({
        threadId,
        reference: yield* publish("<p>final</p>", "Final report"),
        artifactId: saved.artifactId,
      });
      const page = yield* library.findShared(token);
      expect(yield* fileSystem.readFileString(page!.path)).toContain("<p>final</p>");
      expect(yield* library.findShared(`${token}x`)).toBeNull();

      yield* library.update({ artifactId: saved.artifactId, shared: false });
      expect(yield* library.findShared(token)).toBeNull();
      // A link from before does not come back with the next share.
      const reshared = yield* library.update({ artifactId: saved.artifactId, shared: true });
      expect(reshared.shareToken).not.toBe(token);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("duplicates the current version into a private artifact of its own", () =>
    Effect.gen(function* () {
      const library = yield* ArtifactLibrary.ArtifactLibrary;
      const fileSystem = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const saved = yield* library.recordRender({
        threadId,
        reference: yield* publish("<p>one</p>", "Chart"),
      });
      yield* library.recordRender({
        threadId,
        reference: yield* publish("<p>two</p>", "Chart"),
        artifactId: saved.artifactId,
      });
      yield* library.update({ artifactId: saved.artifactId, shared: true, pinned: true });

      const copy = yield* library.duplicate(saved.artifactId);

      expect(copy).toMatchObject({ title: "Chart copy", pinned: false, shareToken: null });
      expect(copy.versions.map((version) => version.version)).toEqual([1]);
      // Deleting the original must not take the copy's page with it.
      yield* library.remove(saved.artifactId);
      const page = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: copy.versions[0]!.attachmentId,
      });
      expect(yield* fileSystem.readFileString(page!)).toContain("<p>two</p>");
      expect((yield* library.list).map((artifact) => artifact.id)).toEqual([copy.id]);
    }).pipe(Effect.provide(layerTest)),
  );
});
