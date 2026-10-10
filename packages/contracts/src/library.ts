import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/** One saved page of an artifact; `attachmentId` serves it like a thread's HTML render. */
export const LibraryArtifactVersion = Schema.Struct({
  version: PositiveInt,
  attachmentId: TrimmedNonEmptyString,
  title: Schema.String,
  height: Schema.Number,
  heights: Schema.optional(Schema.Array(Schema.Tuple([Schema.Int, Schema.Int]))),
  createdAt: IsoDateTime,
});
export type LibraryArtifactVersion = typeof LibraryArtifactVersion.Type;

/**
 * Where an artifact's page was last sent to its provider's own hosting, such
 * as claude.ai for a Claude account. The provider decides who may open it.
 */
export const LibraryArtifactPublication = Schema.Struct({
  url: TrimmedNonEmptyString,
  /** The artifact version that page shows; a later version is not there yet. */
  version: PositiveInt,
  publishedAt: IsoDateTime,
});
export type LibraryArtifactPublication = typeof LibraryArtifactPublication.Type;

/**
 * A page an agent published, kept apart from its thread so it outlives it.
 * Thread and project fields record where it was made; they may point at
 * something deleted since.
 */
export const LibraryArtifact = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  threadId: Schema.NullOr(ThreadId),
  threadTitle: Schema.NullOr(Schema.String),
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** Pinned artifacts list first. */
  pinned: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /**
   * Set while the artifact is public: `/api/shared/<shareToken>` serves its
   * current version to anyone who can reach the server, without signing in.
   */
  shareToken: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  publication: Schema.NullOr(LibraryArtifactPublication).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  /** Oldest first; the last one is current. */
  versions: Schema.Array(LibraryArtifactVersion),
});
export type LibraryArtifact = typeof LibraryArtifact.Type;

export const LibraryListArtifactsResult = Schema.Struct({
  artifacts: Schema.Array(LibraryArtifact),
});
export type LibraryListArtifactsResult = typeof LibraryListArtifactsResult.Type;

export const LibraryDeleteArtifactInput = Schema.Struct({
  artifactId: TrimmedNonEmptyString,
});
export type LibraryDeleteArtifactInput = typeof LibraryDeleteArtifactInput.Type;

/** Omitted fields keep their value. `shared: true` on a public artifact keeps its link. */
export const LibraryUpdateArtifactInput = Schema.Struct({
  artifactId: TrimmedNonEmptyString,
  title: Schema.optionalKey(TrimmedNonEmptyString),
  pinned: Schema.optionalKey(Schema.Boolean),
  shared: Schema.optionalKey(Schema.Boolean),
  /** `null` forgets the provider link; the page stays with the provider. */
  publication: Schema.optionalKey(Schema.Null),
});
export type LibraryUpdateArtifactInput = typeof LibraryUpdateArtifactInput.Type;

/** Copies the artifact's current version into a new private artifact. */
export const LibraryDuplicateArtifactInput = Schema.Struct({
  artifactId: TrimmedNonEmptyString,
});
export type LibraryDuplicateArtifactInput = typeof LibraryDuplicateArtifactInput.Type;

/** Sends the artifact's current version to the hosting of the account that made it. */
export const LibraryPublishArtifactInput = Schema.Struct({
  artifactId: TrimmedNonEmptyString,
});
export type LibraryPublishArtifactInput = typeof LibraryPublishArtifactInput.Type;

/** Deletes the artifact's page from its provider's hosting for good. */
export const LibraryUnpublishArtifactInput = Schema.Struct({
  artifactId: TrimmedNonEmptyString,
});
export type LibraryUnpublishArtifactInput = typeof LibraryUnpublishArtifactInput.Type;

export const LibraryArtifactResult = Schema.Struct({ artifact: LibraryArtifact });
export type LibraryArtifactResult = typeof LibraryArtifactResult.Type;

/** Where a public artifact is served, relative to the server's HTTP origin. */
export const LIBRARY_SHARED_ROUTE_PREFIX = "/api/shared";

export class LibraryError extends Schema.TaggedError<LibraryError>()("LibraryError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** A plugin installed for one account, read from that account's config folder on this device. */
export const InstalledPlugin = Schema.Struct({
  /** `name@marketplace`, as the provider's own config names it. */
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  marketplace: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
});
export type InstalledPlugin = typeof InstalledPlugin.Type;

export const InstalledPluginGroup = Schema.Struct({
  instanceId: ProviderInstanceId,
  /** The folder the plugins were read from. */
  configDir: Schema.String,
  plugins: Schema.Array(InstalledPlugin),
});
export type InstalledPluginGroup = typeof InstalledPluginGroup.Type;

export const LibraryListPluginsResult = Schema.Struct({
  groups: Schema.Array(InstalledPluginGroup),
});
export type LibraryListPluginsResult = typeof LibraryListPluginsResult.Type;

/** A plugin one of the account's marketplaces offers. */
export const AvailablePlugin = Schema.Struct({
  /** `name@marketplace`; what install and uninstall take. */
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  marketplace: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  installCount: Schema.NullOr(Schema.Number),
  installed: Schema.Boolean,
});
export type AvailablePlugin = typeof AvailablePlugin.Type;

export const LibraryListAvailablePluginsInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  /** Matched against name, marketplace and description; empty lists the most installed. */
  query: Schema.String,
});
export type LibraryListAvailablePluginsInput = typeof LibraryListAvailablePluginsInput.Type;

export const LibraryListAvailablePluginsResult = Schema.Struct({
  /** The best matches only; `total` counts every match. */
  plugins: Schema.Array(AvailablePlugin),
  total: Schema.Number,
  marketplaces: Schema.Array(Schema.String),
});
export type LibraryListAvailablePluginsResult = typeof LibraryListAvailablePluginsResult.Type;

export const LibraryPluginInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  pluginId: TrimmedNonEmptyString,
});
export type LibraryPluginInput = typeof LibraryPluginInput.Type;

export const LibraryAddPluginMarketplaceInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  /** `owner/repo`, a git URL, or a folder on the server's machine. */
  source: TrimmedNonEmptyString,
});
export type LibraryAddPluginMarketplaceInput = typeof LibraryAddPluginMarketplaceInput.Type;

export const LibrarySkillSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("git"), url: TrimmedNonEmptyString }),
  /** A folder on the server's machine: one skill, or a folder of skills. */
  Schema.Struct({ kind: Schema.Literal("folder"), path: TrimmedNonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal("text"),
    name: TrimmedNonEmptyString,
    description: TrimmedNonEmptyString,
    body: Schema.String,
  }),
]);
export type LibrarySkillSource = typeof LibrarySkillSource.Type;

export const LibraryAddSkillInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  source: LibrarySkillSource,
});
export type LibraryAddSkillInput = typeof LibraryAddSkillInput.Type;

export const LibraryAddSkillResult = Schema.Struct({
  /** Skill folders now in the account's skills folder. */
  added: Schema.Array(Schema.String),
  /** Skill folders left alone because one of that name was already there. */
  skipped: Schema.Array(Schema.String),
});
export type LibraryAddSkillResult = typeof LibraryAddSkillResult.Type;

export const LibraryRemoveSkillInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  /** The skill's `path` as the provider reports it. */
  path: TrimmedNonEmptyString,
});
export type LibraryRemoveSkillInput = typeof LibraryRemoveSkillInput.Type;
