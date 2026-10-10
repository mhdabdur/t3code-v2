/**
 * The Library's artifacts: HTML pages agents published, copied out of their
 * thread so they outlive it, with each re-publish kept as a version.
 *
 * Pages live in the attachment store under a `library` id segment, so the
 * asset route serves them like any HTML render and thread deletion, which only
 * removes ids in that thread's segment, never touches them. The index is a
 * JSON file beside the database rather than a table: the database is shared
 * with upstream T3 Code, whose future migrations must not collide with ours.
 *
 * An artifact is private until it is shared. Sharing gives it a random token,
 * and the HTTP route for that token serves the current version without
 * signing in: the token is the whole permission.
 *
 * @module library/ArtifactLibrary
 */
import * as NodeCrypto from "node:crypto";

import {
  LibraryArtifact,
  LibraryError,
  type LibraryArtifactPublication,
  type LibraryArtifactVersion,
  type ThreadId,
} from "@t3tools/contracts";
import type { HtmlRenderReference } from "@t3tools/shared/htmlRender";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { createAttachmentId } from "../attachmentStore.ts";
import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

const LIBRARY_SEGMENT = "library";

const LibraryIndex = Schema.Struct({ artifacts: Schema.Array(LibraryArtifact) });
type LibraryIndex = typeof LibraryIndex.Type;
const decodeIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(LibraryIndex));
const encodeIndex = Schema.encodeEffect(Schema.fromJsonString(LibraryIndex));

export class ArtifactLibrary extends Context.Service<
  ArtifactLibrary,
  {
    /**
     * Copies a published page into the Library: a new artifact, or a new
     * version of `artifactId` when that artifact exists.
     */
    readonly recordRender: (input: {
      readonly threadId: ThreadId;
      readonly reference: HtmlRenderReference;
      readonly artifactId?: string | undefined;
    }) => Effect.Effect<{ readonly artifactId: string; readonly version: number }, LibraryError>;
    /** Newest change first. */
    readonly list: Effect.Effect<ReadonlyArray<LibraryArtifact>, LibraryError>;
    /** Removes the artifact and every version's page; a missing id is a no-op. */
    readonly remove: (artifactId: string) => Effect.Effect<void, LibraryError>;
    /**
     * Renames, pins, or shares an artifact. Sharing mints the token its public
     * link carries; unsharing drops it, so a link shared earlier stops working
     * for good.
     */
    readonly update: (input: {
      readonly artifactId: string;
      readonly title?: string | undefined;
      readonly pinned?: boolean | undefined;
      readonly shared?: boolean | undefined;
      /** Records where the provider hosts the page; `null` forgets it. */
      readonly publication?: LibraryArtifactPublication | null | undefined;
    }) => Effect.Effect<LibraryArtifact, LibraryError>;
    /** The artifact and the file holding its current version's page. */
    readonly currentPage: (artifactId: string) => Effect.Effect<
      {
        readonly artifact: LibraryArtifact;
        readonly version: LibraryArtifactVersion;
        readonly path: string;
      },
      LibraryError
    >;
    /** A new private artifact holding a copy of the current version. */
    readonly duplicate: (artifactId: string) => Effect.Effect<LibraryArtifact, LibraryError>;
    /** The current page of the public artifact this token belongs to. */
    readonly findShared: (
      shareToken: string,
    ) => Effect.Effect<{ readonly path: string; readonly title: string } | null, LibraryError>;
  }
>()("t3/library/ArtifactLibrary") {}

const libraryError = (message: string) => (cause: unknown) => new LibraryError({ message, cause });

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const indexPath = path.join(config.stateDir, "library", "artifacts.json");
  // Every change reads, edits and rewrites the whole index.
  const lock = yield* Semaphore.make(1);

  const pagePath = (attachmentId: string) =>
    resolveAttachmentRelativePath({
      attachmentsDir: config.attachmentsDir,
      relativePath: `${attachmentId}.html`,
    });

  const readIndex = Effect.gen(function* () {
    const exists = yield* fileSystem.exists(indexPath);
    if (!exists) return { artifacts: [] } satisfies LibraryIndex;
    return yield* decodeIndex(yield* fileSystem.readFileString(indexPath));
  }).pipe(Effect.mapError(libraryError("Could not read the Library.")));

  const writeIndex = (index: LibraryIndex) =>
    encodeIndex(index).pipe(
      Effect.flatMap((contents) => writeFileStringAtomically({ filePath: indexPath, contents })),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError(libraryError("Could not save the Library.")),
    );

  const recordRender: ArtifactLibrary["Service"]["recordRender"] = Effect.fn(
    "ArtifactLibrary.recordRender",
  )(function* (input) {
    const source = pagePath(input.reference.attachmentId);
    const attachmentId = createAttachmentId(LIBRARY_SEGMENT, "html");
    const target = attachmentId === null ? null : pagePath(attachmentId);
    if (source === null || attachmentId === null || target === null) {
      return yield* new LibraryError({ message: "Invalid page id." });
    }
    yield* fileSystem
      .copyFile(source, target)
      .pipe(Effect.mapError(libraryError("Could not copy the page into the Library.")));
    // Where it came from is a label only; a lookup failure must not lose the page.
    const shell = yield* threads
      .getThreadShell(input.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    const now = DateTime.formatIso(yield* DateTime.now);
    return yield* lock
      .withPermits(1)(
        Effect.gen(function* () {
          const index = yield* readIndex;
          const existing = input.artifactId
            ? index.artifacts.find((artifact) => artifact.id === input.artifactId)
            : undefined;
          const version: LibraryArtifactVersion = {
            version: (existing?.versions.at(-1)?.version ?? 0) + 1,
            attachmentId,
            title: input.reference.title,
            height: input.reference.height,
            ...(input.reference.heights ? { heights: input.reference.heights } : {}),
            createdAt: now,
          };
          const artifact: LibraryArtifact = existing
            ? {
                ...existing,
                title: input.reference.title,
                updatedAt: now,
                versions: [...existing.versions, version],
              }
            : {
                id: NodeCrypto.randomUUID(),
                title: input.reference.title,
                projectId: shell?.projectId ?? null,
                threadId: input.threadId,
                threadTitle: shell?.title ?? null,
                providerInstanceId: shell?.providerInstanceId ?? null,
                createdAt: now,
                updatedAt: now,
                pinned: false,
                shareToken: null,
                publication: null,
                versions: [version],
              };
          yield* writeIndex({
            artifacts: [artifact, ...index.artifacts.filter((entry) => entry.id !== artifact.id)],
          });
          return { artifactId: artifact.id, version: version.version };
        }),
      )
      .pipe(
        // The index never names a page it failed to record, so remove the copy.
        Effect.onError(() => fileSystem.remove(target, { force: true }).pipe(Effect.ignore)),
      );
  });

  const list = readIndex.pipe(
    Effect.map((index) =>
      index.artifacts.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    ),
  );

  const remove: ArtifactLibrary["Service"]["remove"] = Effect.fn("ArtifactLibrary.remove")(
    function* (artifactId) {
      const removed = yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const index = yield* readIndex;
          const artifact = index.artifacts.find((entry) => entry.id === artifactId);
          if (!artifact) return null;
          yield* writeIndex({
            artifacts: index.artifacts.filter((entry) => entry.id !== artifactId),
          });
          return artifact;
        }),
      );
      if (!removed) return;
      // The index no longer names these pages; a leftover file is only disk space.
      yield* Effect.forEach(
        removed.versions,
        (version) => {
          const file = pagePath(version.attachmentId);
          return file === null
            ? Effect.void
            : fileSystem.remove(file, { force: true }).pipe(Effect.ignore({ log: true }));
        },
        { discard: true },
      );
    },
  );

  const missing = () => new LibraryError({ message: "This artifact no longer exists." });

  const update: ArtifactLibrary["Service"]["update"] = Effect.fn("ArtifactLibrary.update")(
    function* (input) {
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const index = yield* readIndex;
          const existing = index.artifacts.find((entry) => entry.id === input.artifactId);
          if (!existing) return yield* missing();
          const artifact: LibraryArtifact = {
            ...existing,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
            ...(input.publication === undefined ? {} : { publication: input.publication }),
            ...(input.shared === undefined
              ? {}
              : {
                  shareToken: input.shared
                    ? (existing.shareToken ?? NodeCrypto.randomBytes(24).toString("base64url"))
                    : null,
                }),
          };
          yield* writeIndex({
            artifacts: index.artifacts.map((entry) =>
              entry.id === artifact.id ? artifact : entry,
            ),
          });
          return artifact;
        }),
      );
    },
  );

  const duplicate: ArtifactLibrary["Service"]["duplicate"] = Effect.fn("ArtifactLibrary.duplicate")(
    function* (artifactId) {
      const source = (yield* readIndex).artifacts.find((entry) => entry.id === artifactId);
      const current = source?.versions.at(-1);
      if (!source || !current) return yield* missing();
      const from = pagePath(current.attachmentId);
      const attachmentId = createAttachmentId(LIBRARY_SEGMENT, "html");
      const target = attachmentId === null ? null : pagePath(attachmentId);
      if (from === null || attachmentId === null || target === null) {
        return yield* new LibraryError({ message: "Invalid page id." });
      }
      yield* fileSystem
        .copyFile(from, target)
        .pipe(Effect.mapError(libraryError("Could not copy the page.")));
      const now = DateTime.formatIso(yield* DateTime.now);
      const artifact: LibraryArtifact = {
        ...source,
        id: NodeCrypto.randomUUID(),
        title: `${source.title} copy`,
        createdAt: now,
        updatedAt: now,
        pinned: false,
        shareToken: null,
        publication: null,
        versions: [{ ...current, version: 1, attachmentId, createdAt: now }],
      };
      return yield* lock
        .withPermits(1)(
          Effect.gen(function* () {
            const index = yield* readIndex;
            yield* writeIndex({ artifacts: [artifact, ...index.artifacts] });
            return artifact;
          }),
        )
        .pipe(Effect.onError(() => fileSystem.remove(target, { force: true }).pipe(Effect.ignore)));
    },
  );

  const currentPage: ArtifactLibrary["Service"]["currentPage"] = Effect.fn(
    "ArtifactLibrary.currentPage",
  )(function* (artifactId) {
    const artifact = (yield* readIndex).artifacts.find((entry) => entry.id === artifactId);
    const version = artifact?.versions.at(-1);
    const file = version ? pagePath(version.attachmentId) : null;
    if (!artifact || !version || file === null) return yield* missing();
    return { artifact, version, path: file };
  });

  const findShared: ArtifactLibrary["Service"]["findShared"] = Effect.fn(
    "ArtifactLibrary.findShared",
  )(function* (shareToken) {
    const provided = Buffer.from(shareToken);
    const artifact = (yield* readIndex).artifacts.find((entry) => {
      if (entry.shareToken === null) return false;
      const expected = Buffer.from(entry.shareToken);
      return expected.length === provided.length && NodeCrypto.timingSafeEqual(expected, provided);
    });
    const current = artifact?.versions.at(-1);
    const file = current ? pagePath(current.attachmentId) : null;
    return artifact && file ? { path: file, title: artifact.title } : null;
  });

  return ArtifactLibrary.of({
    recordRender,
    list,
    remove,
    update,
    duplicate,
    currentPage,
    findShared,
  });
});

export const layer = Layer.effect(ArtifactLibrary, make);
