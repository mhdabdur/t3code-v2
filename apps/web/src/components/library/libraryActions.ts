import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, LibraryArtifact } from "@t3tools/contracts";
import { useCallback } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { desktopNetworkAccessStateAtom } from "~/state/desktopNetworkAccess";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { resolveShareLink } from "./libraryLogic";

/** The command's value, or `null` after telling the user why it failed. */
export function valueOrToast<A, E>(
  result: AtomCommandResult<A, E>,
  failureTitle: string,
): A | null {
  if (result._tag === "Success") return result.value;
  if (!isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: failureTitle,
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  }
  return null;
}

/**
 * Copies an artifact's public link, making the artifact public first when it
 * is still private. Resolves to whether the artifact changed.
 */
export function useShareArtifact(environmentId: EnvironmentId) {
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  // Only the desktop app knows which of its server's addresses others can reach.
  const networkAccess = useEnvironmentQuery(
    typeof window !== "undefined" && window.desktopBridge ? desktopNetworkAccessStateAtom : null,
  );
  const advertisedEndpoints = networkAccess.data?.advertisedEndpoints;
  const updateArtifact = useAtomCommand(serverEnvironment.updateLibraryArtifact);

  return useCallback(
    async (artifact: LibraryArtifact): Promise<boolean> => {
      let shareToken = artifact.shareToken;
      if (shareToken === null) {
        const updated = valueOrToast(
          await updateArtifact({
            environmentId,
            input: { artifactId: artifact.id, shared: true },
          }),
          "Could not share the artifact",
        );
        shareToken = updated?.artifact.shareToken ?? null;
        if (shareToken === null) return false;
      }
      const link = resolveShareLink({
        shareToken,
        httpBaseUrl,
        advertisedEndpoints: advertisedEndpoints ?? [],
      });
      const copied = link !== null && (await writeTextToClipboard(link.url).catch(() => false));
      toastManager.add(
        !link || !copied
          ? { type: "error", title: "Could not copy the link" }
          : link.localOnly
            ? {
                type: "warning",
                title: "Link copied, but it only opens on this device",
                description:
                  "Turn on Network access or T3 Connect in Settings → Connections so others can reach this server.",
              }
            : {
                type: "success",
                title: "Public link copied",
                description: "Anyone who can reach this server can open it without signing in.",
              },
      );
      return artifact.shareToken === null;
    },
    [advertisedEndpoints, environmentId, httpBaseUrl, updateArtifact],
  );
}
