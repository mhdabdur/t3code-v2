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
