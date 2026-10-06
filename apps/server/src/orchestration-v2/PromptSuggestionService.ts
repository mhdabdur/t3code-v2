import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import type {
  OrchestrationSuggestNextPromptInput,
  OrchestrationSuggestNextPromptResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { formatThreadTitleContext } from "../textGeneration/ThreadTitleContext.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

/** Guesses the user's next prompt after an assistant reply, for the composer's ghost text. */
export class PromptSuggestionService extends Context.Service<
  PromptSuggestionService,
  {
    /** Never fails: a suggestion is optional, so any failure is logged and reads as none. */
    readonly suggestNextPrompt: (
      input: OrchestrationSuggestNextPromptInput,
    ) => Effect.Effect<OrchestrationSuggestNextPromptResult>;
  }
>()("t3/orchestration-v2/PromptSuggestionService") {}

const NO_SUGGESTION: OrchestrationSuggestNextPromptResult = { suggestion: null };

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;

  const suggestNextPrompt: PromptSuggestionService["Service"]["suggestNextPrompt"] = Effect.fn(
    "PromptSuggestionService.suggestNextPrompt",
  )(function* (input) {
    return yield* Effect.gen(function* () {
      const projection = yield* threads.getThreadRecords(input.threadId, ["messages"], {
        messageRoles: ["user", "assistant"],
      });
      const messages = projection.messages.filter((message) => !message.streaming);
      // A newer message makes the request stale; the client asks again for that one.
      if (messages.at(-1)?.id !== input.messageId || messages.at(-1)?.role !== "assistant") {
        return NO_SUGGESTION;
      }
      const project = yield* projects.get(projection.thread.projectId);
      if (Option.isNone(project)) return NO_SUGGESTION;

      const settings = resolveProjectSettings(
        yield* serverSettings.getSettings,
        projection.thread.projectId,
      ).settings;
      const result = yield* textGeneration.generatePromptSuggestion({
        cwd: projection.thread.worktreePath ?? project.value.workspaceRoot,
        conversation: formatThreadTitleContext(messages).message,
        modelSelection: settings.textGenerationModelSelection,
      });
      return { suggestion: result.suggestion.length > 0 ? result.suggestion : null };
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Prompt suggestion failed", {
              threadId: input.threadId,
              cause,
            }).pipe(Effect.as(NO_SUGGESTION)),
      ),
    );
  });

  return PromptSuggestionService.of({ suggestNextPrompt });
});

export const layer = Layer.effect(PromptSuggestionService, make);
