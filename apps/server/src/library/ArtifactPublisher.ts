/**
 * Sends a Library artifact to the hosting of the account that made it, and
 * takes it down again. For a Claude account that is claude.ai: Claude Code's
 * own Artifact tool does the upload and the delete, so a short Claude session
 * is started only to call that tool.
 *
 * The page starts out private to the account; who else may open it is set on
 * claude.ai.
 *
 * @module library/ArtifactPublisher
 */
import * as NodeOS from "node:os";

import { query } from "@anthropic-ai/claude-agent-sdk";
import { LibraryError, type LibraryArtifact } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ArtifactLibrary from "./ArtifactLibrary.ts";
import * as LibraryAccounts from "./LibraryAccounts.ts";

export class ArtifactPublisher extends Context.Service<
  ArtifactPublisher,
  {
    /**
     * Publishes the current version, as a new version of the page already
     * published when there is one. Only artifacts a Claude account made qualify.
     */
    readonly publish: (artifactId: string) => Effect.Effect<LibraryArtifact, LibraryError>;
    /**
     * Deletes the published page for good and forgets its address. The caller
     * is the confirmation Claude Code asks for, so it must have asked the user.
     */
    readonly unpublish: (artifactId: string) => Effect.Effect<LibraryArtifact, LibraryError>;
  }
>()("t3/library/ArtifactPublisher") {}

type ArtifactCall = Readonly<Record<string, unknown>>;

interface ArtifactSessionResult {
  /** What each Artifact call returned: an object on success, the error text otherwise. */
  readonly toolResults: ReadonlyArray<unknown>;
  readonly reply: string;
}

/** A Claude session whose only power is the Artifact calls the caller admits. */
export class ClaudeArtifactSession extends Context.Service<
  ClaudeArtifactSession,
  {
    readonly run: (input: {
      readonly account: LibraryAccounts.LibraryAccount;
      readonly prompt: string;
      /** The one file the Artifact tool may read to publish it. */
      readonly readablePath?: string;
      /** Every Artifact call is put to this; anything it rejects is denied. */
      readonly allow: (call: ArtifactCall) => boolean;
    }) => Effect.Effect<ArtifactSessionResult, LibraryError>;
  }
>()("t3/library/ArtifactPublisher/ClaudeArtifactSession") {}

// The session exists to make a tool call or two, so the cheapest model drives it.
const SESSION_MODEL = "haiku";
const SESSION_TIMEOUT = "3 minutes";

/**
 * What to ask the session for when publishing. An update names the page's
 * address. Claude Code refuses to publish over a version the session has not
 * seen, so the session reads the live page first; the Library's version then
 * replaces it whole.
 */
export function claudePublishPrompt(input: {
  readonly path: string;
  readonly title: string;
  readonly url: string | null;
}): string {
  // JSON keeps a title with quotes or line breaks from reading as instructions.
  const publish = JSON.stringify({
    action: "publish",
    file_path: input.path,
    title: input.title,
    ...(input.url === null ? {} : { url: input.url }),
  });
  const steps =
    input.url === null
      ? `Call the Artifact tool once with exactly this input, adding only the icon a first publish needs: ${publish}.`
      : `Make two Artifact tool calls, in this order. First: ${JSON.stringify({ action: "read", url: input.url })}. Second, exactly this input: ${publish}. The file is the complete new version of the page and replaces what is published; nothing from the published page is merged into it.`;
  return `${steps} Do not read or change the file. Then reply with only the artifact URL.`;
}

export function claudeDeletePrompt(url: string): string {
  return `The user asked to delete their artifact and confirmed it. Call the Artifact tool once with exactly this input: ${JSON.stringify({ action: "delete", url })}. Then reply with only "deleted" or the error.`;
}

/** The Artifact calls a publish may make: the read an update needs, and the publish itself. */
export function isPublishCall(
  call: ArtifactCall,
  input: { readonly path: string; readonly url: string | null },
): boolean {
  if (call.action === "read") return input.url !== null && call.url === input.url;
  return (
    call.action === "publish" && call.file_path === input.path && (call.url ?? null) === input.url
  );
}

function resultRecord(result: unknown): Record<string, unknown> | null {
  return typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
}

/**
 * The published page's address, taken from the Artifact tool's own result and
 * never from what the model says about it.
 */
export function publishedUrl(results: ReadonlyArray<unknown>): string | null {
  for (const result of results) {
    const url = resultRecord(result)?.url;
    if (typeof url === "string" && url.startsWith("https://claude.ai/")) return url;
  }
  return null;
}

export function wasDeleted(results: ReadonlyArray<unknown>, url: string): boolean {
  return results.some((result) => {
    const deleted = resultRecord(resultRecord(result)?.artifact_delete);
    return deleted?.deleted === true && deleted.url === url;
  });
}

/** Why the session did not do what was asked: the tool's last error, or the model's reply. */
export function sessionFailure(session: ArtifactSessionResult, fallback: string): string {
  const error = session.toolResults.findLast(
    (result): result is string => typeof result === "string" && result.trim().length > 0,
  );
  return (error ?? (session.reply.trim() || fallback)).trim().replace(/^Error:\s*/, "");
}

const make = Effect.gen(function* () {
  const library = yield* ArtifactLibrary.ArtifactLibrary;
  const accounts = yield* LibraryAccounts.LibraryAccounts;
  const sessions = yield* ClaudeArtifactSession;

  const claudeAccountFor = Effect.fn("ArtifactPublisher.claudeAccountFor")(function* (
    artifact: LibraryArtifact,
  ) {
    const notClaude = () =>
      new LibraryError({ message: "Only artifacts made by a Claude account can go to claude.ai." });
    if (artifact.providerInstanceId === null) return yield* notClaude();
    const account = yield* accounts
      .get(artifact.providerInstanceId)
      .pipe(Effect.mapError(notClaude));
    if (account.driver !== "claudeAgent") return yield* notClaude();
    return account;
  });

  const publish: ArtifactPublisher["Service"]["publish"] = Effect.fn("ArtifactPublisher.publish")(
    function* (artifactId) {
      const page = yield* library.currentPage(artifactId);
      const account = yield* claudeAccountFor(page.artifact);
      const target = { path: page.path, url: page.artifact.publication?.url ?? null };
      const session = yield* sessions.run({
        account,
        prompt: claudePublishPrompt({ ...target, title: page.artifact.title }),
        readablePath: page.path,
        allow: (call) => isPublishCall(call, target),
      });
      const url = publishedUrl(session.toolResults);
      if (url === null) {
        return yield* new LibraryError({
          message: sessionFailure(session, "Claude did not publish the page."),
        });
      }
      return yield* library.update({
        artifactId,
        publication: {
          url,
          version: page.version.version,
          publishedAt: DateTime.formatIso(yield* DateTime.now),
        },
      });
    },
  );

  const unpublish: ArtifactPublisher["Service"]["unpublish"] = Effect.fn(
    "ArtifactPublisher.unpublish",
  )(function* (artifactId) {
    const { artifact } = yield* library.currentPage(artifactId);
    const url = artifact.publication?.url;
    if (url === undefined) {
      return yield* new LibraryError({ message: "This artifact is not on claude.ai." });
    }
    const account = yield* claudeAccountFor(artifact);
    const session = yield* sessions.run({
      account,
      prompt: claudeDeletePrompt(url),
      allow: (call) => call.action === "delete" && call.url === url,
    });
    if (!wasDeleted(session.toolResults, url)) {
      return yield* new LibraryError({
        message: sessionFailure(session, "Claude did not delete the page."),
      });
    }
    return yield* library.update({ artifactId, publication: null });
  });

  return ArtifactPublisher.of({ publish, unpublish });
});

export const layer = Layer.effect(ArtifactPublisher, make);

/** Runs the session through the Claude Agent SDK, as the account's own Claude Code. */
export const layerClaudeArtifactSession = Layer.succeed(
  ClaudeArtifactSession,
  ClaudeArtifactSession.of({
    run: (input) =>
      Effect.tryPromise({
        try: async (signal) => {
          const abortController = new AbortController();
          signal.addEventListener("abort", () => abortController.abort(), { once: true });
          const toolResults: Array<unknown> = [];
          let reply = "";
          for await (const message of query({
            prompt: input.prompt,
            options: {
              pathToClaudeCodeExecutable: input.account.binaryPath,
              abortController,
              // Away from any project, and with no settings files: no project
              // instructions, no hooks, no MCP servers.
              cwd: NodeOS.tmpdir(),
              settingSources: [],
              mcpServers: {},
              strictMcpConfig: true,
              persistSession: false,
              model: SESSION_MODEL,
              maxTurns: 5,
              // No shell and no edits. Read is listed because the Artifact tool
              // reads the page under Read's rules; the one rule allows that file alone.
              tools: input.readablePath === undefined ? ["Artifact"] : ["Artifact", "Read"],
              allowedTools:
                input.readablePath === undefined
                  ? []
                  : [`Read(/${input.readablePath.replaceAll("\\", "/")})`],
              // Artifact is not pre-approved, so each call, a delete's
              // confirmation included, is decided here.
              canUseTool: async (toolName, toolInput) =>
                toolName === "Artifact" && input.allow(toolInput)
                  ? { behavior: "allow", updatedInput: toolInput }
                  : { behavior: "deny", message: "This session may not make that call." },
              env: {
                ...process.env,
                ...input.account.environment,
                // Claude Code keeps the Artifact tool out of SDK sessions unless asked.
                CLAUDE_CODE_ARTIFACT: "1",
                ENABLE_CLAUDEAI_MCP_SERVERS: "false",
              },
              stderr: () => {},
            },
          })) {
            if (message.type === "user" && message.tool_use_result !== undefined) {
              toolResults.push(message.tool_use_result);
            }
            if (message.type === "result" && message.subtype === "success") reply = message.result;
          }
          return { toolResults, reply };
        },
        catch: (cause) => new LibraryError({ message: "Could not run Claude Code.", cause }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: SESSION_TIMEOUT,
          orElse: () => Effect.fail(new LibraryError({ message: "Claude Code took too long." })),
        }),
      ),
  }),
);
