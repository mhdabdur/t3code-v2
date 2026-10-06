import * as Schema from "effect/Schema";

import { MessageId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Asks for a likely next prompt after the assistant message `messageId`. */
export const OrchestrationSuggestNextPromptInput = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
});
export type OrchestrationSuggestNextPromptInput = typeof OrchestrationSuggestNextPromptInput.Type;

export const OrchestrationSuggestNextPromptResult = Schema.Struct({
  /** Null when the model had nothing to offer or `messageId` is no longer the latest reply. */
  suggestion: Schema.NullOr(Schema.String),
});
export type OrchestrationSuggestNextPromptResult = typeof OrchestrationSuggestNextPromptResult.Type;

export class OrchestrationSuggestNextPromptError extends Schema.TaggedError<OrchestrationSuggestNextPromptError>()(
  "OrchestrationSuggestNextPromptError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
